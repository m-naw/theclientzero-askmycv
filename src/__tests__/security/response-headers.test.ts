/**
 * SDD-5: Central response builder + security headers baseline.
 *
 * Every response the worker emits must carry:
 *   - X-Content-Type-Options: nosniff
 *   - X-Frame-Options: DENY
 *   - Referrer-Policy: no-referrer
 *   - Content-Security-Policy with frame-ancestors 'none'
 *
 * The route-level baseline guards against:
 *   - Clickjacking (someone iframing the chat page on a phishing site).
 *   - MIME sniffing (a misconfigured route returning HTML-looking JSON).
 *   - Referer leaks (the setup/admin pages link out to platform.claude.com
 *     in a new tab — the visitor's host must not ride along).
 *
 * These tests pin the baseline so a future refactor can't silently regress.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env, createExecutionContext, fetchMock, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../worker";
import { hashPassword } from "../../auth/password";
import { TEST_JWKS_KV_KEY } from "../../routes/jwks-source";
import { ADMIN_PASSWORD_HASH_KEY } from "../../types/auth";
import { SETUP_RATE_LIMIT_PREFIX } from "../../abuse/rate-limit";
import type { StoredConfig } from "../../types/config";

const ANTHROPIC_HOST = "https://anthropic-mock-sdd5.test";
const ADMIN_PASSWORD = "correcthorsebatterystaple";

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
  for (const key of [
    "config",
    "setup_window_start",
    TEST_JWKS_KV_KEY,
    ADMIN_PASSWORD_HASH_KEY,
    "cookie_signing_secret",
    `${SETUP_RATE_LIMIT_PREFIX}unknown`,
    `ratelimit:login:unknown`,
    `ratelimit:messages:unknown`,
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

function expectBaselineHeaders(res: Response): void {
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  const csp = res.headers.get("Content-Security-Policy");
  expect(csp).not.toBeNull();
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("default-src 'self'");
}

async function seedConfiguredState(): Promise<void> {
  const hash = await hashPassword(ADMIN_PASSWORD);
  const cfg: StoredConfig = {
    display_name: "Jane Doe",
    headline: "Senior backend engineer",
    cv_markdown: "# Jane Doe\n\n## Experience\n" + "Long enough CV markdown content. ".repeat(20),
    anthropic_api_key: "sk-ant-test-key",
    daily_budget_usd: 5,
    setup_timestamp: Date.now(),
  };
  await getEnv().STATE.put("config", JSON.stringify(cfg));
  await getEnv().STATE.put(ADMIN_PASSWORD_HASH_KEY, hash);
}

describe("SDD-5: security-header baseline on all responses", () => {
  beforeEach(async () => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    try { fetchMock.enableNetConnect(/localhost/); } catch { /* not all versions */ }
    (env as Record<string, string>).ANTHROPIC_BASE_URL = ANTHROPIC_HOST;
    (env as Record<string, string>).ACCESS_JWKS_URL_OVERRIDE = "";
    await clearKv();
  });

  afterEach(async () => {
    fetchMock.deactivate();
    await clearKv();
  });

  it("GET / (chat page when configured) emits baseline headers + frame-ancestors 'none'", async () => {
    await seedConfiguredState();
    const res = await runFetch(new Request("https://example.test/"));
    expect(res.status).toBe(200);
    expectBaselineHeaders(res);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("GET / (unconfigured -> setup instructions) emits baseline headers", async () => {
    const res = await runFetch(new Request("https://example.test/"));
    expect(res.status).toBe(200);
    expectBaselineHeaders(res);
  });

  it("GET /admin (404 not configured) emits baseline headers on a plain-text response", async () => {
    const res = await runFetch(new Request("https://example.test/admin"));
    expect(res.status).toBe(404);
    expectBaselineHeaders(res);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
  });

  it("POST /login with no hash configured emits headers (was bare 401 text)", async () => {
    const res = await runFetch(
      new Request("https://example.test/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "admin_password=anything",
      }),
    );
    expect(res.status).toBe(401);
    expectBaselineHeaders(res);
    // Was bare text; now must declare a content-type explicitly.
    expect(res.headers.get("Content-Type")).toContain("text/plain");
  });

  it("POST /login bad password renders HTML form with headers (was 401)", async () => {
    await seedConfiguredState();
    const res = await runFetch(
      new Request("https://example.test/login", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "CF-Connecting-IP": "203.0.113.5",
        },
        body: "admin_password=wrongpassword",
      }),
    );
    expect(res.status).toBe(401);
    expectBaselineHeaders(res);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("GET /logout 303 redirect preserves Set-Cookie + Location AND emits baseline headers", async () => {
    const res = await runFetch(new Request("https://example.test/logout"));
    expect(res.status).toBe(303);
    expectBaselineHeaders(res);
    expect(res.headers.get("Location")).toBe("/login?logged_out=1");
    expect(res.headers.get("Set-Cookie")).toMatch(/session=/);
  });

  it("POST /chat success: SSE response keeps text/event-stream + baseline headers", async () => {
    await seedConfiguredState();

    // Mock Anthropic SSE upstream.
    const pool = fetchMock.get(ANTHROPIC_HOST);
    pool
      .intercept({ path: /\/v1\/messages.*/, method: "POST" })
      .reply(
        200,
        'data: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\n' +
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n' +
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n' +
          'data: [DONE]\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );

    const res = await runFetch(
      new Request("https://example.test/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Mozilla/5.0",
          "cf-connecting-ip": "198.51.100.10",
        },
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      }),
    );
    expect(res.status).toBe(200);
    expectBaselineHeaders(res);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    // Drain body so the execution context can flush.
    await res.text();
  });

  it("POST /chat error: JSON error response carries baseline headers + application/json", async () => {
    // No config seeded → 503 not configured.
    const res = await runFetch(
      new Request("https://example.test/chat", {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      }),
    );
    expect(res.status).toBe(503);
    expectBaselineHeaders(res);
    expect(res.headers.get("Content-Type")).toContain("application/json");
  });
});
