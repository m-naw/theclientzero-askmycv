/**
 * Integration test: login redirect with next-param round-trip.
 *
 * Scenarios:
 *   (a) GET /admin without session → 303 to /login?next=%2Fadmin
 *   (b) POST /login with valid creds and next=/admin → 303 to /admin + session cookie
 *   (c) POST /login with next=//evil.com → 303 to / (sanitized)
 *   (d) POST /login (no next) → 303 to / after success
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env, createExecutionContext, fetchMock, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../worker";
import { ADMIN_PASSWORD_HASH_KEY } from "../../types/auth";
import { SESSION_COOKIE_NAME } from "../../auth/session";
import { TEST_JWKS_KV_KEY } from "../../routes/jwks-source";

const ANTHROPIC_HOST = "https://anthropic-mock-redirect.test";
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

function mockAnthropicOk(): void {
  const pool = fetchMock.get(ANTHROPIC_HOST);
  pool
    .intercept({ path: /\/v1\/messages.*/, method: "POST" })
    .reply(
      200,
      JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
        model: "claude-haiku-4-5-20251001",
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { headers: { "content-type": "application/json" } },
    )
    .persist();
}

async function runSetup(): Promise<void> {
  mockAnthropicOk();
  const body = new URLSearchParams();
  body.set("display_name", "Test User");
  body.set("headline", "Test headline for redirect tests");
  body.set("anthropic_api_key", "sk-ant-test-key");
  body.set("daily_budget_usd", "5");
  body.set(
    "cv_markdown",
    "# Test User\n\n## Experience\n" +
      "Lots of experience working on various systems across multiple companies. ".repeat(5),
  );
  body.set("admin_password", ADMIN_PASSWORD);

  const res = await runFetch(
    new Request("https://example.test/setup", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }),
  );
  // Ensure setup succeeded before tests run
  if (res.status !== 303) {
    throw new Error(`Setup failed with status ${res.status}`);
  }
}

describe("Login redirect next-param round-trip", () => {
  beforeEach(async () => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    try { fetchMock.enableNetConnect(/localhost/); } catch { /* not all versions */ }

    (env as Record<string, string>).ANTHROPIC_BASE_URL = ANTHROPIC_HOST;
    (env as Record<string, string>).ACCESS_JWKS_URL_OVERRIDE = "";
    await clearKv();
    await runSetup();
  });

  afterEach(async () => {
    fetchMock.deactivate();
    await clearKv();
  });

  it("(a) GET /admin without session → 303 to /login?next=%2Fadmin", async () => {
    const res = await runFetch(
      new Request("https://example.test/admin", { method: "GET" }),
    );

    expect(res.status).toBe(303);
    const location = res.headers.get("Location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("next=");
    expect(location).toContain("%2Fadmin");
  });

  it("(b) POST /login with valid creds and next=/admin → 303 to /admin + session cookie", async () => {
    const body = new URLSearchParams();
    body.set("admin_password", ADMIN_PASSWORD);
    body.set("next", "/admin");

    const res = await runFetch(
      new Request("https://example.test/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      }),
    );

    expect(res.status).toBe(303);
    const location = res.headers.get("Location") ?? "";
    expect(location).toBe("/admin");

    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain(SESSION_COOKIE_NAME);
    expect(setCookie).toContain("HttpOnly");
  });

  it("(c) POST /login with next=//evil.com → 303 to / (sanitized)", async () => {
    const body = new URLSearchParams();
    body.set("admin_password", ADMIN_PASSWORD);
    body.set("next", "//evil.com");

    const res = await runFetch(
      new Request("https://example.test/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      }),
    );

    expect(res.status).toBe(303);
    const location = res.headers.get("Location") ?? "";
    expect(location).toBe("/");
  });

  it("(d) POST /login with no next → 303 to / after success", async () => {
    const body = new URLSearchParams();
    body.set("admin_password", ADMIN_PASSWORD);

    const res = await runFetch(
      new Request("https://example.test/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      }),
    );

    expect(res.status).toBe(303);
    const location = res.headers.get("Location") ?? "";
    expect(location).toBe("/");
  });

  it("GET /login with next=/admin → renders hidden input with value /admin", async () => {
    const res = await runFetch(
      new Request("https://example.test/login?next=%2Fadmin", { method: "GET" }),
    );

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('name="next"');
    expect(html).toContain('value="/admin"');
  });

  it("GET /login with next=//evil → does not render hidden input (sanitized to /)", async () => {
    const res = await runFetch(
      new Request("https://example.test/login?next=%2F%2Fevil.com", { method: "GET" }),
    );

    expect(res.status).toBe(200);
    const html = await res.text();
    // Sanitized to "/" which means no hidden input is rendered
    expect(html).not.toContain('name="next"');
  });
});
