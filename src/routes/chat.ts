/**
 * POST /chat — visitor-facing streaming chat endpoint. Spec §9 F4.
 *
 * No authentication: recruiters must never see a login screen.
 *
 * Pipeline:
 *   1. Parse JSON body; validate `messages` (non-empty array).
 *   2. Cap to last 12 turns; truncate each content to 1500 chars.
 *   3. Load StoredConfig from KV (config). The Anthropic API key is
 *      read ONLY from KV — never embedded in source or env vars.
 *   4. Build the system prompt (CV verbatim + behavioral instructions).
 *   5. Call Anthropic /v1/messages with stream=true.
 *   6. Bridge the upstream SSE chunks to our visitor as text/event-stream.
 *   7. Best-effort: parse usage from message_start/message_delta and
 *      write spend:<UTC-date> to KV. Failures here must not break the
 *      visitor stream.
 */

import type { Env } from "../env";
import { parseStoredConfig, type StoredConfig } from "../types/config";
import { buildSystemPrompt } from "../prompts/system";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;
const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  "x-accel-buffering": "no",
} as const;

const MAX_TURNS = 12;
const MAX_CHARS_PER_MESSAGE = 1500;
const MAX_OUTPUT_TOKENS = 512;
const MODEL = "claude-haiku-4-5-20251001";

// Haiku rates per million tokens (USD). Spec §9 F6.
const INPUT_RATE_USD = 1;
const CACHED_RATE_USD = 0.1;
const OUTPUT_RATE_USD = 5;

const SPEND_TTL_SECONDS = 60 * 60 * 30; // 30 hours — strictly > 24h.

interface IncomingMessage {
  role: string;
  content: string;
}

function errorJson(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });
}

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function costUsd(inputTokens: number, cachedTokens: number, outputTokens: number): number {
  return (
    (inputTokens * INPUT_RATE_USD +
      cachedTokens * CACHED_RATE_USD +
      outputTokens * OUTPUT_RATE_USD) /
    1_000_000
  );
}

async function readConfig(env: Env): Promise<StoredConfig | null> {
  const raw = await env.STATE.get("config");
  if (raw === null) return null;
  try {
    const parsed = parseStoredConfig(JSON.parse(raw));
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

export async function handlePostChat(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  // ----- 1. body parsing + validation -------------------------------
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return errorJson(400, "invalid json body");
  }
  if (parsed === null || typeof parsed !== "object") {
    return errorJson(400, "body must be a json object");
  }
  const body = parsed as { messages?: unknown };
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return errorJson(400, "messages must be a non-empty array");
  }

  // ----- 2. clamp turns + truncate content --------------------------
  const rawMessages = body.messages as unknown[];

  // Reject garbage input: messages where >100 chars and >70% are uppercase
  // letters indicate bot/spam. Check the last (most recent) user message.
  // Spec §9 F4 done_when.
  for (const m of rawMessages) {
    const obj = (m ?? {}) as { content?: unknown };
    const content = typeof obj.content === "string" ? obj.content : "";
    if (content.length > 100) {
      const letters = content.replace(/[^a-zA-Z]/g, "");
      const upperCount = letters.replace(/[^A-Z]/g, "").length;
      if (letters.length > 0 && upperCount / letters.length > 0.7) {
        return errorJson(400, "message rejected: excessive uppercase characters");
      }
    }
  }

  const trimmed = rawMessages.slice(-MAX_TURNS).map((m): IncomingMessage => {
    const obj = (m ?? {}) as { role?: unknown; content?: unknown };
    const role = typeof obj.role === "string" ? obj.role : "user";
    const content = typeof obj.content === "string" ? obj.content : "";
    return {
      role: role === "assistant" ? "assistant" : "user",
      content: content.slice(0, MAX_CHARS_PER_MESSAGE),
    };
  });

  // ----- 3. load config (key is KV-only) ----------------------------
  const cfg = await readConfig(env);
  if (cfg === null) {
    return errorJson(503, "not configured");
  }

  // ----- 4. build system prompt -------------------------------------
  const system = buildSystemPrompt(cfg.cv_markdown);

  // ----- 5. call Anthropic streaming --------------------------------
  const baseUrl =
    env.ANTHROPIC_BASE_URL && env.ANTHROPIC_BASE_URL.length > 0
      ? env.ANTHROPIC_BASE_URL
      : "https://api.anthropic.com";

  const upstream = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.anthropic_api_key,
      "anthropic-version": "2023-06-01",
      accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      stream: true,
      system,
      messages: trimmed,
    }),
  });

  if (!upstream.ok || upstream.body === null) {
    const detail = upstream.body ? await upstream.text().catch(() => "") : "";
    return new Response(
      JSON.stringify({ error: "anthropic upstream error", status: upstream.status, detail }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  // ----- 6/7. bridge SSE + track usage ------------------------------
  const usage = { input: 0, cached: 0, output: 0 };

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      // best-effort usage parse — failures are swallowed.
      try {
        const text = new TextDecoder().decode(chunk);
        for (const line of text.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload.length === 0 || payload === "[DONE]") continue;
          let evt: {
            type?: string;
            message?: { usage?: { input_tokens?: number; cache_read_input_tokens?: number } };
            usage?: { output_tokens?: number; input_tokens?: number; cache_read_input_tokens?: number };
          };
          try {
            evt = JSON.parse(payload);
          } catch {
            continue;
          }
          if (evt.type === "message_start" && evt.message?.usage) {
            usage.input = evt.message.usage.input_tokens ?? 0;
            usage.cached = evt.message.usage.cache_read_input_tokens ?? 0;
          }
          if (evt.type === "message_delta" && evt.usage) {
            if (typeof evt.usage.output_tokens === "number") usage.output = evt.usage.output_tokens;
            if (typeof evt.usage.input_tokens === "number") usage.input = evt.usage.input_tokens;
            if (typeof evt.usage.cache_read_input_tokens === "number") {
              usage.cached = evt.usage.cache_read_input_tokens;
            }
          }
        }
      } catch {
        /* never let usage parsing break the visitor stream */
      }
    },
    async flush() {
      // After the upstream stream completes, persist spend best-effort.
      try {
        const key = `spend:${todayUtcDate()}`;
        const current = await env.STATE.get(key);
        const prev = current === null ? 0 : Number(current);
        const next = (Number.isFinite(prev) ? prev : 0) + costUsd(usage.input, usage.cached, usage.output);
        await env.STATE.put(key, String(next), { expirationTtl: SPEND_TTL_SECONDS });
      } catch {
        /* swallow — visitor stream already delivered */
      }
    },
  });

  const stream = upstream.body.pipeThrough(transform);
  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}
