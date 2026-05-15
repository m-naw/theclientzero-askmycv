/**
 * Acceptance Tests 7, 8, 9 and KV failure tolerance — spec §12.
 * POST /chat anti-abuse guards: bot UA rejection, per-IP rate limit, daily budget cap.
 * Runs inside @cloudflare/vitest-pool-workers (Miniflare).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env, createExecutionContext, fetchMock, waitOnExecutionContext } from "cloudflare:test";
import worker from "../worker";
import type { StoredConfig } from "../types/config";

const ANTHROPIC_HOST = "https://anthropic-mock.test";

interface TestEnv {
  STATE: KVNamespace;
  ANTHROPIC_BASE_URL: string;
  ACCESS_JWKS_URL_OVERRIDE: string;
}

function getEnv(): TestEnv {
  return env as unknown as TestEnv;
}

function baseConfig(): StoredConfig {
  return {
    display_name: "Jane Doe",
    headline: "Engineer",
    cv_markdown:
      "# Jane Doe\n\nSenior backend engineer with experience across distributed systems.",
    anthropic_api_key: "sk-ant-test",
    daily_budget_usd: 5,
    access_email: "owner@test",
    access_aud: "test-aud",
    access_team_domain: "test.cloudflareaccess.com",
    setup_timestamp: Date.now() - 1000,
  };
}

function fakeAnthropicSse(): string {
  const events = [
    `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: { id: "m1", usage: { input_tokens: 10, output_tokens: 0 } },
    })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hello" },
    })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 25 },
    })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
  ];
  return events.join("");
}

interface CapturedRequest {
  body: unknown;
  count: number;
}

function mockAnthropicStream(captured: CapturedRequest, times = 100): void {
  const pool = fetchMock.get(ANTHROPIC_HOST);
  pool
    .intercept({ path: /\/v1\/messages.*/, method: "POST" })
    .reply((opts: { body?: string }) => {
      captured.count += 1;
      try {
        captured.body = JSON.parse(opts.body ?? "{}");
      } catch {
        captured.body = opts.body;
      }
      return {
        statusCode: 200,
        data: fakeAnthropicSse(),
        responseOptions: { headers: { "content-type": "text/event-stream" } },
      };
    })
    .times(times);
}

async function runFetch(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as never, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function drainStream(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  out += dec.decode();
  return out;
}

function chatRequest(
  message: string,
  headers: Record<string, string> = {},
): Request {
  const body = { messages: [{ role: "user", content: message }] };
  return new Request("https://example.test/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function clearKv(): Promise<void> {
  const kv = getEnv().STATE;
  const today = new Date().toISOString().slice(0, 10);
  const hour = new Date().getUTCHours().toString().padStart(2, "0");
  for (const key of [
    "config",
    "setup_window_start",
    `spend:${today}`,
    `ratelimit:10.0.1.1:${today}-${hour}`,
  ]) {
    await kv.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Test 7 — bot UA rejection
// ---------------------------------------------------------------------------

describe("Test 7 — bot UA rejection", () => {
  beforeEach(async () => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    (env as Record<string, string>).ANTHROPIC_BASE_URL = ANTHROPIC_HOST;
    (env as Record<string, string>).ACCESS_JWKS_URL_OVERRIDE = "";
    await clearKv();
    await getEnv().STATE.put("config", JSON.stringify(baseConfig()));
  });

  afterEach(async () => {
    fetchMock.deactivate();
    await clearKv();
  });

  it("rejects curl UA with 403", async () => {
    // No Anthropic mock needed — request is rejected before reaching Anthropic
    const res = await runFetch(
      chatRequest("hello", { "user-agent": "curl/7.68.0" }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects empty string UA with 403", async () => {
    // No Anthropic mock needed — request is rejected before reaching Anthropic
    const res = await runFetch(
      chatRequest("hello", { "user-agent": "" }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects python-requests UA with 403", async () => {
    // No Anthropic mock needed — request is rejected before reaching Anthropic
    const res = await runFetch(
      chatRequest("hello", { "user-agent": "python-requests/2.28.0" }),
    );
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Test 8 — per-IP rate limit
// ---------------------------------------------------------------------------

describe("Test 8 — per-IP rate limit", () => {
  const TEST_IP = "10.0.1.1";

  function getRatelimitKey(): string {
    const today = new Date().toISOString().slice(0, 10);
    const hour = new Date().getUTCHours().toString().padStart(2, "0");
    return `ratelimit:${TEST_IP}:${today}-${hour}`;
  }

  beforeEach(async () => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    (env as Record<string, string>).ANTHROPIC_BASE_URL = ANTHROPIC_HOST;
    (env as Record<string, string>).ACCESS_JWKS_URL_OVERRIDE = "";
    await clearKv();
    await getEnv().STATE.put(
      "config",
      JSON.stringify({ ...baseConfig(), max_msgs_per_hour: 3 }),
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    fetchMock.deactivate();
    await clearKv();
  });

  it("3 requests from same IP succeed (200)", async () => {
    const captured: CapturedRequest = { body: null, count: 0 };
    mockAnthropicStream(captured);

    for (let i = 0; i < 3; i++) {
      const res = await runFetch(
        chatRequest(`msg ${i}`, { "cf-connecting-ip": TEST_IP }),
      );
      expect(res.status).toBe(200);
      await drainStream(res);
    }

    expect(captured.count).toBe(3);
  });

  it("4th request returns 429 after 3 succeed", async () => {
    // No Anthropic mock needed — rate-limited request never reaches Anthropic
    const ratelimitKey = getRatelimitKey();
    await getEnv().STATE.put(ratelimitKey, "3", { expirationTtl: 3600 });

    const res = await runFetch(
      chatRequest("blocked", { "cf-connecting-ip": TEST_IP }),
    );
    expect(res.status).toBe(429);
  });

  it("request succeeds after rate-limit key is cleared", async () => {
    const captured: CapturedRequest = { body: null, count: 0 };
    mockAnthropicStream(captured);

    const ratelimitKey = getRatelimitKey();

    // Prime counter at limit → 429
    await getEnv().STATE.put(ratelimitKey, "3", { expirationTtl: 3600 });
    const res1 = await runFetch(
      chatRequest("blocked", { "cf-connecting-ip": TEST_IP }),
    );
    expect(res1.status).toBe(429);

    // Clear counter → should succeed
    await getEnv().STATE.delete(ratelimitKey);
    const res2 = await runFetch(
      chatRequest("allowed", { "cf-connecting-ip": TEST_IP }),
    );
    expect(res2.status).toBe(200);
    await drainStream(res2);
  });
});

// ---------------------------------------------------------------------------
// Test 9 — daily budget cap
// ---------------------------------------------------------------------------

describe("Test 9 — daily budget cap", () => {
  function getSpendKey(): string {
    return `spend:${new Date().toISOString().slice(0, 10)}`;
  }

  beforeEach(async () => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    (env as Record<string, string>).ANTHROPIC_BASE_URL = ANTHROPIC_HOST;
    (env as Record<string, string>).ACCESS_JWKS_URL_OVERRIDE = "";
    await clearKv();
    await getEnv().STATE.put(
      "config",
      JSON.stringify({ ...baseConfig(), daily_budget_usd: 1 }),
    );
  });

  afterEach(async () => {
    fetchMock.deactivate();
    await clearKv();
  });

  it("returns 503 when spend equals budget; zero Anthropic calls", async () => {
    // No Anthropic mock needed — budget-exceeded request never reaches Anthropic
    const spendKey = getSpendKey();
    await getEnv().STATE.put(spendKey, "1");

    const res = await runFetch(chatRequest("hello"));
    expect(res.status).toBe(503);
  });

  it("returns 200 after spend key is cleared", async () => {
    const captured: CapturedRequest = { body: null, count: 0 };
    mockAnthropicStream(captured);

    const spendKey = getSpendKey();

    // At budget → 503
    await getEnv().STATE.put(spendKey, "1");
    const res1 = await runFetch(chatRequest("over budget"));
    expect(res1.status).toBe(503);

    // Clear spend → 200
    await getEnv().STATE.delete(spendKey);
    const res2 = await runFetch(chatRequest("within budget"));
    expect(res2.status).toBe(200);
    await drainStream(res2);
  });
});

// ---------------------------------------------------------------------------
// KV failure tolerance
// ---------------------------------------------------------------------------

describe("KV failure tolerance", () => {
  beforeEach(async () => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    (env as Record<string, string>).ANTHROPIC_BASE_URL = ANTHROPIC_HOST;
    (env as Record<string, string>).ACCESS_JWKS_URL_OVERRIDE = "";
    await clearKv();
    await getEnv().STATE.put("config", JSON.stringify(baseConfig()));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    fetchMock.deactivate();
    await clearKv();
  });

  it("spend KV write failure does not break visitor 200 stream", async () => {
    const captured: CapturedRequest = { body: null, count: 0 };
    mockAnthropicStream(captured);

    const kv = getEnv().STATE;
    const originalPut = kv.put.bind(kv);

    vi.spyOn(kv, "put").mockImplementation(
      async (key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream, options?: KVNamespacePutOptions): Promise<void> => {
        if (key.startsWith("spend:")) {
          throw new Error("KV write failure simulated");
        }
        return originalPut(key, value as string, options);
      },
    );

    const res = await runFetch(chatRequest("hello"));
    expect(res.status).toBe(200);

    const body = await drainStream(res);
    expect(body).toContain("message_stop");
  });
});
