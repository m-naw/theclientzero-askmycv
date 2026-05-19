/**
 * Integration test: POST /chat fails closed when the rate-limit KV read errors.
 *
 * SDD-6 Fix A. Previously, a KV exception in the rate-limit path returned
 * `rateLimitAllowed = true` (fail-open), letting an attacker who can induce
 * KV errors hammer /chat and drain the Anthropic budget. The new behaviour:
 * KV error → 503 Service Unavailable.
 *
 * We patch the KV namespace's `.get` to throw for ratelimit:* keys, leaving
 * `config` reads intact so the route reaches the rate-limit step.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env, createExecutionContext, fetchMock, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../worker";
import type { StoredConfig } from "../../types/config";

const ANTHROPIC_HOST = "https://anthropic-mock-failclose.test";

interface TestEnv {
  STATE: KVNamespace;
  ANTHROPIC_BASE_URL: string;
  ACCESS_JWKS_URL_OVERRIDE: string;
}

function getEnv(): TestEnv {
  return env as unknown as TestEnv;
}

async function clearKv(): Promise<void> {
  const kv = getEnv().STATE;
  const today = new Date().toISOString().slice(0, 10);
  for (const key of ["config", "setup_window_start", `spend:${today}`]) {
    await kv.delete(key);
  }
}

function baseConfig(): StoredConfig {
  return {
    display_name: "Jane Doe",
    headline: "Engineer",
    cv_markdown:
      "# Jane Doe\n\nSenior backend engineer with experience across distributed systems and developer tooling.",
    anthropic_api_key: "sk-ant-test",
    daily_budget_usd: 5,
    access_email: "owner@test",
    access_aud: "test-aud",
    access_team_domain: "test.cloudflareaccess.com",
    setup_timestamp: Date.now() - 1000,
  };
}

async function runFetch(request: Request, kvOverride?: KVNamespace): Promise<Response> {
  const ctx = createExecutionContext();
  const envForCall = kvOverride
    ? ({ ...(env as Record<string, unknown>), STATE: kvOverride } as never)
    : (env as never);
  const res = await worker.fetch(request, envForCall, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

function chatRequest(): Request {
  return new Request("https://example.test/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36",
      "cf-connecting-ip": "203.0.113.1",
    },
    body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
  });
}

describe("POST /chat — fail-closed on rate-limit KV error (SDD-6 Fix A)", () => {
  beforeEach(async () => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    try { fetchMock.enableNetConnect(/localhost/); } catch { /* */ }
    (env as Record<string, string>).ANTHROPIC_BASE_URL = ANTHROPIC_HOST;
    (env as Record<string, string>).ACCESS_JWKS_URL_OVERRIDE = "";
    await clearKv();
    await getEnv().STATE.put("config", JSON.stringify(baseConfig()));
  });

  afterEach(async () => {
    fetchMock.deactivate();
    await clearKv();
  });

  it("returns 503 (not 200) when KV throws on rate-limit read", async () => {
    const realKv = getEnv().STATE;
    // Wrap STATE so get/put throw for ratelimit:* keys; passthrough otherwise.
    const failingKv: KVNamespace = new Proxy(realKv, {
      get(target, prop, receiver) {
        if (prop === "get") {
          return async (key: string, ...rest: unknown[]) => {
            if (typeof key === "string" && key.startsWith("ratelimit:")) {
              throw new Error("simulated KV outage");
            }
            // @ts-expect-error variadic passthrough
            return target.get(key, ...rest);
          };
        }
        if (prop === "put") {
          return async (key: string, value: string, ...rest: unknown[]) => {
            if (typeof key === "string" && key.startsWith("ratelimit:")) {
              throw new Error("simulated KV outage");
            }
            // @ts-expect-error variadic passthrough
            return target.put(key, value, ...rest);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const res = await runFetch(chatRequest(), failingKv);

    expect(res.status).toBe(503);
    // Must not be a streaming SSE response.
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).not.toContain("text/event-stream");
    expect(ct).toContain("application/json");
    const body = (await res.json()) as { error?: string };
    expect(typeof body.error).toBe("string");
    expect(body.error?.toLowerCase()).toContain("rate limit");
  });
});
