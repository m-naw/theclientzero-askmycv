/**
 * Acceptance Test 6 — spec §12 Test 6:
 * "Public chat works without authentication"
 *
 * Fixtures: config present with valid CV. spend:<today> absent.
 * Anthropic mock returns a streaming response with known token usage.
 *
 * Steps validated:
 * 1. GET / with no JWT, realistic browser UA → HTTP 200, HTML with
 *    display_name and headline.
 * 2. POST /chat with no JWT, realistic browser UA, valid body →
 *    HTTP 200, content-type: text/event-stream.
 * 3. Read response body as stream → at least one SSE event parsed.
 * 4. Captured Anthropic mock request: system field contains cv_markdown.
 * 5. KV spend:<today> is non-zero after the request.
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

/**
 * Fixture config with a substantive CV. Simulates a fully-configured instance
 * as described in Test 6 fixtures: "config is present with valid CV".
 */
function fixtureConfig(): StoredConfig {
  return {
    display_name: "Taylor Kim",
    headline: "Principal Software Engineer",
    cv_markdown: [
      "# Taylor Kim",
      "",
      "Principal software engineer with 12 years building scalable systems.",
      "Led architecture of distributed data pipelines at two unicorn startups.",
      "Open source contributor; maintainer of three widely-used libraries.",
    ].join("\n"),
    anthropic_api_key: "sk-ant-test",
    daily_budget_usd: 5,
    access_email: "owner@test",
    access_aud: "test-aud",
    access_team_domain: "test.cloudflareaccess.com",
    setup_timestamp: Date.now() - 2000,
  };
}

/**
 * Build a synthetic Anthropic SSE stream with a known token usage so we can
 * verify the spend KV key after the request.
 * input_tokens=100, cache_read_input_tokens=20, output_tokens=50.
 */
function fakeAnthropicSse(): string {
  const events = [
    `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: {
        id: "msg_test6",
        usage: { input_tokens: 100, cache_read_input_tokens: 20, output_tokens: 0 },
      },
    })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "I am [cv] a principal software engineer." },
    })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: " I have 12 years of experience [cv]." },
    })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 50 },
    })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
  ];
  return events.join("");
}

interface CapturedRequest {
  body: unknown;
  count: number;
}

function mockAnthropicStream(captured: CapturedRequest): void {
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
    });
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

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

describe("Acceptance Test 6 — public chat works without authentication (spec §12)", () => {
  beforeEach(async () => {
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
    // Fixture: config present, spend absent (as per spec §12 Test 6)
    await getEnv().STATE.put("config", JSON.stringify(fixtureConfig()));
  });

  afterEach(async () => {
    fetchMock.deactivate();
    await clearKv();
  });

  it("step 1: GET / with no JWT and browser UA returns 200 with display_name and headline in HTML", async () => {
    const req = new Request("https://example.test/", {
      method: "GET",
      headers: { "user-agent": BROWSER_UA },
    });
    const res = await runFetch(req);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(fixtureConfig().display_name);
    expect(html).toContain(fixtureConfig().headline);
  });

  it("step 2: POST /chat with no JWT, browser UA, and valid body returns 200 with content-type text/event-stream", async () => {
    const captured: CapturedRequest = { body: null, count: 0 };
    mockAnthropicStream(captured);

    const req = new Request("https://example.test/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": BROWSER_UA,
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "Hi" }] }),
    });
    const res = await runFetch(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/event-stream");
    await drainStream(res);
  });

  it("step 3: streaming response body contains at least one parsed SSE event", async () => {
    const captured: CapturedRequest = { body: null, count: 0 };
    mockAnthropicStream(captured);

    const req = new Request("https://example.test/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": BROWSER_UA,
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "Hi" }] }),
    });
    const res = await runFetch(req);
    expect(res.status).toBe(200);
    const body = await drainStream(res);

    // At least one SSE event line — must start with "data: "
    const dataLines = body.split("\n").filter((l) => l.startsWith("data: "));
    expect(dataLines.length).toBeGreaterThanOrEqual(1);
  });

  it("step 4: Anthropic request system field contains cv_markdown verbatim", async () => {
    const captured: CapturedRequest = { body: null, count: 0 };
    mockAnthropicStream(captured);

    const req = new Request("https://example.test/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": BROWSER_UA,
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "Hi" }] }),
    });
    const res = await runFetch(req);
    expect(res.status).toBe(200);
    await drainStream(res);

    expect(captured.count).toBe(1);
    const sent = captured.body as { system?: Array<{ text: string }> | string };
    const flat =
      typeof sent.system === "string"
        ? sent.system
        : (sent.system ?? []).map((b) => b.text).join("\n");
    expect(flat).toContain(fixtureConfig().cv_markdown);
  });

  it("step 5: KV spend:<today> is non-zero after successful chat request", async () => {
    const captured: CapturedRequest = { body: null, count: 0 };
    mockAnthropicStream(captured);

    const req = new Request("https://example.test/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": BROWSER_UA,
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "Hi" }] }),
    });
    const res = await runFetch(req);
    expect(res.status).toBe(200);
    await drainStream(res);

    const today = new Date().toISOString().slice(0, 10);
    const spend = await getEnv().STATE.get(`spend:${today}`);
    expect(spend).not.toBeNull();
    expect(Number(spend)).toBeGreaterThan(0);
  });
});
