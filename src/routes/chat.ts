/**
 * POST /chat — visitor-facing streaming chat endpoint. Spec §9 F4, F6, F7.
 *
 * No authentication: recruiters must never see a login screen.
 *
 * Pipeline:
 *   0. Anti-abuse guards (before body parsing):
 *      a. Content-Length > 100 KiB → 413
 *      b. Bot user-agent → 403
 *   1. Parse JSON body; validate `messages` (non-empty array).
 *   2. Garbage input check (>100 chars, >70% uppercase) → 400.
 *   3. Per-IP rate limit (CF-Connecting-IP, max_msgs_per_hour) → 429.
 *   4. Daily budget pre-flight: read spend:<today>; if >= daily_budget_usd → 503.
 *   5. Cap to last 12 turns; truncate each content to 1500 chars.
 *   6. Load StoredConfig from KV (config). The Anthropic API key is
 *      read ONLY from KV — never embedded in source or env vars.
 *   7. Build the system prompt (CV verbatim + behavioral instructions).
 *   8. Call Anthropic /v1/messages with stream=true.
 *   9. Bridge the upstream SSE chunks to our visitor as text/event-stream.
 *  10. Best-effort: parse usage from message_start/message_delta, compute
 *      cost, and write spend:<UTC-date> to KV (awaited in stream flush). Failures
 *      here must not break the visitor stream.
 */

import type { Env } from "../env";
import { getAnthropicTimeoutMs } from "../env";
import {
  parseStoredConfig,
  type StoredConfig,
  DEFAULT_MAX_MSGS_PER_HOUR,
  DEFAULT_MODEL,
} from "../types/config";
import { buildSystemPrompt } from "../prompts/system";
import { isBotUserAgent } from "../abuse/ua";
import { isGarbageInput } from "../abuse/input-guard";
import { checkAndIncrement } from "../abuse/rate-limit";
import { utcDateKey, readSpend, addSpend } from "../budget/spend";
import { computeCostUsd } from "../pricing/index";
// F11: consume the captured Anthropic credit-error realShape fixture from G1.
// The fixture is the authoritative body shape for credit-exhaustion responses;
// matching the canonical message exactly (plus loose substring) keeps detection
// resilient to upstream wording drift.
import creditErrorShape from "../../references/anthropic-messages-error.json";
import { jsonResponse, sseResponse } from "../lib/response";

const CREDIT_ERROR_MESSAGE: string = creditErrorShape.error.message;
/**
 * SSE-specific headers that must accompany the streaming response.
 * sseResponse() sets Content-Type=text/event-stream and the security baseline;
 * we add cache + buffering hints here.
 */
const SSE_EXTRA_HEADERS = {
  "cache-control": "no-cache, no-transform",
  "x-accel-buffering": "no",
} as const;

const MAX_TURNS = 12;
const MAX_CHARS_PER_MESSAGE = 1500;
const MAX_OUTPUT_TOKENS = 512;
const MAX_BODY_BYTES = 100 * 1024; // 100 KiB

interface IncomingMessage {
  role: string;
  content: string;
}

function errorJson(status: number, error: string, extraHeaders?: Record<string, string>): Response {
  return jsonResponse({ error }, { status, headers: extraHeaders });
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

/** Seconds until next UTC midnight from now. */
function secondsUntilMidnight(): number {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const nextMidnight = new Date(`${today}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000;
  return Math.max(1, Math.ceil((nextMidnight - now.getTime()) / 1000));
}

export async function handlePostChat(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  // ----- 0a. Content-Length guard (spec §9 F7) -----------------------
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > MAX_BODY_BYTES) {
    return errorJson(413, "request body too large");
  }

  // ----- 0b. Bot user-agent check (spec §9 F7) -----------------------
  const ua = request.headers.get("user-agent");
  if (isBotUserAgent(ua)) {
    return errorJson(403, "forbidden: automated clients not allowed");
  }

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

  const rawMessages = body.messages as unknown[];

  // ----- 2. Garbage input check (spec §9 F7 / F4) -------------------
  for (const m of rawMessages) {
    const obj = (m ?? {}) as { content?: unknown };
    const content = typeof obj.content === "string" ? obj.content : "";
    if (isGarbageInput(content)) {
      return errorJson(400, "message rejected: excessive uppercase characters");
    }
  }

  // ----- 3. load config (key is KV-only) ----------------------------
  const cfg = await readConfig(env);
  if (cfg === null) {
    return errorJson(503, "not configured");
  }

  // ----- 4. Per-IP rate limit (spec §9 F7) --------------------------
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const limit = cfg.max_msgs_per_hour ?? DEFAULT_MAX_MSGS_PER_HOUR;
  // KV outage hardening: if rate-limit bookkeeping (KV put) fails, fail-open
  // by allowing the request rather than crashing the worker. This keeps the
  // visitor-facing /chat endpoint resilient to transient KV failures.
  let rateLimitAllowed = true;
  try {
    const { allowed } = await checkAndIncrement(env.STATE, ip, limit, new Date());
    rateLimitAllowed = allowed;
  } catch {
    // KV write failure — fail open. The rate limit window resets at the next
    // hour boundary regardless, so a brief loss of bookkeeping is acceptable.
    rateLimitAllowed = true;
  }
  if (!rateLimitAllowed) {
    return errorJson(429, "rate limit exceeded", {
      "retry-after": String(secondsUntilMidnight()),
    });
  }

  // ----- 5. Daily budget pre-flight (spec §9 F6) --------------------
  const spendKey = utcDateKey(new Date());
  const currentSpend = await readSpend(env.STATE, spendKey);
  if (currentSpend >= cfg.daily_budget_usd) {
    return errorJson(503, "daily budget exceeded", {
      "retry-after": String(secondsUntilMidnight()),
    });
  }

  // ----- 6. clamp turns + truncate content --------------------------
  const trimmed = rawMessages.slice(-MAX_TURNS).map((m): IncomingMessage => {
    const obj = (m ?? {}) as { role?: unknown; content?: unknown };
    const role = typeof obj.role === "string" ? obj.role : "user";
    const content = typeof obj.content === "string" ? obj.content : "";
    return {
      role: role === "assistant" ? "assistant" : "user",
      content: content.slice(0, MAX_CHARS_PER_MESSAGE),
    };
  });

  // ----- 7. build system prompt -------------------------------------
  const system = buildSystemPrompt(cfg.cv_markdown);
  const model = cfg.model ?? DEFAULT_MODEL;

  // ----- 8. call Anthropic streaming --------------------------------
  const baseUrl =
    env.ANTHROPIC_BASE_URL && env.ANTHROPIC_BASE_URL.length > 0
      ? env.ANTHROPIC_BASE_URL
      : "https://api.anthropic.com";

  const timeoutMs = getAnthropicTimeoutMs(env);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": cfg.anthropic_api_key,
        "anthropic-version": "2023-06-01",
        accept: "text/event-stream",
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        stream: true,
        system,
        messages: trimmed,
      }),
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeoutId);
    // AbortError means the timeout fired; any other error is also upstream unavailable.
    return jsonResponse({ error: "upstream_unavailable" }, { status: 502 });
  }

  clearTimeout(timeoutId);

  if (!upstream.ok || upstream.body === null) {
    // F11: distinguish Anthropic insufficient-credit response from generic
    // upstream failures so the chat UI can surface a credit-specific notice.
    // Captured shape: references/anthropic-messages-error.json (HTTP 400,
    // invalid_request_error, message contains "credit").
    let reason: string | undefined;
    try {
      const text = await upstream.text();
      if (text.length > 0) {
        const parsed: unknown = JSON.parse(text);
        const msg =
          (parsed as { error?: { message?: unknown } } | null)?.error?.message;
        if (
          typeof msg === "string" &&
          (msg === CREDIT_ERROR_MESSAGE || msg.toLowerCase().includes("credit"))
        ) {
          reason = "credits";
        }
      }
    } catch {
      /* unparseable upstream body — fall through to generic */
    }
    const body = reason
      ? { error: "upstream_unavailable", reason }
      : { error: "upstream_unavailable" };
    return jsonResponse(body, { status: 502 });
  }

  // ----- 9/10. bridge SSE + track usage (spec §9 F6) ----------------
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
      // Use await so the TransformStream infrastructure keeps the execution context
      // alive until the KV write completes. Failures are swallowed.
      try {
        const cost = computeCostUsd({
          model,
          inputTokens: usage.input,
          cachedInputTokens: usage.cached,
          outputTokens: usage.output,
        });
        await addSpend(env.STATE, spendKey, cost);
      } catch {
        /* swallow — visitor stream already delivered */
      }
    },
  });

  const stream = upstream.body.pipeThrough(transform);
  return sseResponse(stream, { status: 200, headers: SSE_EXTRA_HEADERS });
}
