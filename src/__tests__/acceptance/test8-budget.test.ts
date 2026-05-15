/**
 * Acceptance Test 8 — spec §12 Test 8:
 * "Daily budget cap: when spend >= daily_budget_usd, /chat returns 503"
 *
 * Fixtures: config with daily_budget_usd=1. KV spend:<today> pre-seeded at 1.0.
 *
 * Steps validated:
 * 1. POST /chat returns 503 when spend >= daily_budget_usd.
 * 2. Response has Retry-After header = seconds until next UTC midnight.
 * 3. Anthropic mock receives 0 calls.
 *
 * Runs inside @cloudflare/vitest-pool-workers (Miniflare).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env, createExecutionContext, fetchMock, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../worker";
import type { StoredConfig } from "../../types/config";

const ANTHROPIC_HOST = "https://anthropic-mock.test";

interface TestEnv {
  STATE: KVNamespace;
  ANTHROPIC_BASE_URL: string;
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
    `ratelimit:10.1.2.3:${today}-${hour}`,
  ]) {
    await kv.delete(key);
  }
}

function fixtureConfig(budgetUsd = 1): StoredConfig {
  return {
    display_name: "Budget Test User",
    headline: "Test Engineer",
    cv_markdown:
      "# Budget Test User\n\nSoftware engineer with expertise in cloud cost optimization and infrastructure management.",
    anthropic_api_key: "sk-ant-test",
    daily_budget_usd: budgetUsd,
    access_email: "owner@test",
    access_aud: "test-aud",
    access_team_domain: "test.cloudflareaccess.com",
    setup_timestamp: Date.now() - 2000,
  };
}

function fakeAnthropicSse(): string {
  return `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`;
}

/** Global counter — incremented inside the mock reply; shared across all tests in this file. */
let globalAnthropicCallCount = 0;

function setupAnthropicMock(): void {
  const pool = fetchMock.get(ANTHROPIC_HOST);
  pool
    .intercept({ path: /\/v1\/messages.*/, method: "POST" })
    .reply((_opts: { body?: string }) => {
      globalAnthropicCallCount += 1;
      return {
        statusCode: 200,
        data: fakeAnthropicSse(),
        responseOptions: { headers: { "content-type": "text/event-stream" } },
      };
    });
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
      "cf-connecting-ip": "10.1.2.3",
    },
    body: JSON.stringify({ messages: [{ role: "user", content: "Hi" }] }),
  });
}

describe("Acceptance Test 8 — daily budget cap (spec §12)", () => {
  beforeEach(async () => {
    globalAnthropicCallCount = 0;
    fetchMock.activate();
    fetchMock.disableNetConnect();
    try {
      fetchMock.enableNetConnect(/localhost/);
    } catch {
      /* no-op */
    }
    (env as Record<string, string>).ANTHROPIC_BASE_URL = ANTHROPIC_HOST;
    (env as Record<string, string>).ACCESS_JWKS_URL_OVERRIDE = "";
    await clearKv();
    setupAnthropicMock();
  });

  afterEach(async () => {
    fetchMock.deactivate();
    await clearKv();
  });

  it("returns 503 when seeded spend equals daily_budget_usd; Anthropic receives 0 calls", async () => {
    const countBefore = globalAnthropicCallCount;
    const budget = 1;
    await getEnv().STATE.put("config", JSON.stringify(fixtureConfig(budget)));
    const today = new Date().toISOString().slice(0, 10);
    await getEnv().STATE.put(`spend:${today}`, String(budget));

    const res = await runFetch(chatRequest());
    expect(res.status).toBe(503);
    expect(globalAnthropicCallCount).toBe(countBefore);
  });

  it("returns 503 when seeded spend exceeds daily_budget_usd; Anthropic receives 0 calls", async () => {
    const countBefore = globalAnthropicCallCount;
    const budget = 1;
    await getEnv().STATE.put("config", JSON.stringify(fixtureConfig(budget)));
    const today = new Date().toISOString().slice(0, 10);
    await getEnv().STATE.put(`spend:${today}`, String(budget + 0.5));

    const res = await runFetch(chatRequest());
    expect(res.status).toBe(503);
    expect(globalAnthropicCallCount).toBe(countBefore);
  });

  it("503 response has Retry-After header with positive integer seconds until UTC midnight", async () => {
    const budget = 1;
    await getEnv().STATE.put("config", JSON.stringify(fixtureConfig(budget)));
    const today = new Date().toISOString().slice(0, 10);
    await getEnv().STATE.put(`spend:${today}`, String(budget));

    const before = Date.now();
    const res = await runFetch(chatRequest());
    const after = Date.now();

    expect(res.status).toBe(503);
    const retryAfter = res.headers.get("retry-after");
    expect(retryAfter).not.toBeNull();

    const seconds = Number(retryAfter);
    expect(Number.isInteger(seconds)).toBe(true);
    expect(seconds).toBeGreaterThan(0);

    // Should be <= seconds until next UTC midnight
    const nowMs = (before + after) / 2;
    const nextMidnightMs =
      new Date(new Date(nowMs).toISOString().slice(0, 10) + "T00:00:00Z").getTime() +
      24 * 60 * 60 * 1000;
    const maxSeconds = Math.ceil((nextMidnightMs - nowMs) / 1000);
    expect(seconds).toBeLessThanOrEqual(maxSeconds);
  });

  it("allows requests when spend is below the budget", async () => {
    const countBefore = globalAnthropicCallCount;
    const budget = 5;
    await getEnv().STATE.put("config", JSON.stringify(fixtureConfig(budget)));
    const today = new Date().toISOString().slice(0, 10);
    await getEnv().STATE.put(`spend:${today}`, "0.01");

    const res = await runFetch(chatRequest());
    expect(res.status).toBe(200);
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
    }
    expect(globalAnthropicCallCount).toBe(countBefore + 1);
  });
});
