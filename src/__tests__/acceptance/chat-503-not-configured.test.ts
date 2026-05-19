/**
 * Acceptance Test — spec §12:
 * "POST /chat with empty KV returns HTTP 503 and JSON {error: 'not configured'}"
 *
 * Steps validated:
 * 1. With no config in KV, POST /chat returns HTTP 503.
 * 2. Response body parses as JSON with shape { error: "not configured" }.
 *
 * Runs inside @cloudflare/vitest-pool-workers (Miniflare).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../worker";

interface TestEnv {
  STATE: KVNamespace;
}

function getEnv(): TestEnv {
  return env as unknown as TestEnv;
}

async function clearKv(): Promise<void> {
  const kv = getEnv().STATE;
  const today = new Date().toISOString().slice(0, 10);
  const hour = new Date().getUTCHours().toString().padStart(2, "0");
  for (const key of [
    "config",
    "setup_window_start",
    `spend:${today}`,
    `ratelimit:10.99.0.2:${today}-${hour}`,
  ]) {
    await kv.delete(key);
  }
}

async function runFetch(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as never, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

function chatRequest(): Request {
  return new Request("https://example.test/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "cf-connecting-ip": "10.99.0.2",
    },
    body: JSON.stringify({ messages: [{ role: "user", content: "Hi" }] }),
  });
}

describe("Acceptance — POST /chat 503 not-configured (spec §12)", () => {
  beforeEach(async () => {
    (env as Record<string, string>).ACCESS_JWKS_URL_OVERRIDE = "";
    await clearKv();
  });

  afterEach(async () => {
    await clearKv();
  });

  it("POST /chat with empty KV returns HTTP 503", async () => {
    const res = await runFetch(chatRequest());
    expect(res.status).toBe(503);
  });

  it("POST /chat with empty KV returns JSON body with error 'not configured'", async () => {
    const res = await runFetch(chatRequest());
    const body = (await res.json()) as { error?: unknown };
    expect(body).toHaveProperty("error");
    expect(body.error).toBe("not configured");
  });
});
