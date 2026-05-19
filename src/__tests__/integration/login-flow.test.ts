/**
 * Integration test: login flow.
 *
 * Verifies password login form at GET /login, POST /login authentication,
 * and redirect behaviour after setup.
 *
 * Scenarios:
 *   (a) GET /login after setup → 200 HTML containing 'name="admin_password"'
 *   (b) POST /login correct password → 303 Location /
 *   (c) GET / with returned session cookie → 200 chat UI
 *   (d) POST /login wrong password → 401 or re-render with error
 *   (e) POST /setup success → 303 Location pointing to / (not /admin)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env, createExecutionContext, fetchMock, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../worker";
import { TEST_JWKS_KV_KEY } from "../../routes/jwks-source";
import { ADMIN_PASSWORD_HASH_KEY } from "../../types/auth";
import { SESSION_COOKIE_NAME } from "../../auth/session";

const ANTHROPIC_HOST = "https://anthropic-mock-login.test";

const ADMIN_PASSWORD = "correcthorsebatterystaple";
const WRONG_PASSWORD = "wrongpassword1234";

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

function makeSetupBody(password = ADMIN_PASSWORD): URLSearchParams {
  const body = new URLSearchParams();
  body.set("display_name", "Jane Doe");
  body.set("headline", "Senior backend engineer · Berlin");
  body.set("anthropic_api_key", "sk-ant-test-key");
  body.set("daily_budget_usd", "5");
  body.set(
    "cv_markdown",
    "# Jane Doe\n\n## Experience\n" +
      "Lots of experience working on backend systems across multiple companies and roles. ".repeat(5),
  );
  body.set("admin_password", password);
  return body;
}

/**
 * Run POST /setup to configure the worker and hash the admin password.
 * Returns the setup response (should be 303).
 */
async function runSetup(): Promise<Response> {
  mockAnthropicOk();
  // SDD-1: POST /setup now requires setup_window_start to be initialized
  // (normally done by GET /). Seed it here so login tests can drive setup
  // directly via POST without first calling GET /.
  await (env as { STATE: KVNamespace }).STATE.put("setup_window_start", String(Date.now()));
  return runFetch(
    new Request("https://example.test/setup", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: makeSetupBody().toString(),
    }),
  );
}

describe("Login flow", () => {
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

  it("(a) GET /login after setup → 200 HTML with admin_password input", async () => {
    const setupRes = await runSetup();
    expect(setupRes.status).toBe(303);

    const res = await runFetch(
      new Request("https://example.test/login", { method: "GET" }),
    );

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('name="admin_password"');
    // Must not leak API key
    expect(html).not.toContain("sk-ant-test-key");
  });

  it("(a2) GET / after setup without session → 200 public chat page", async () => {
    // The chat page at / is always public — no login gate.
    const setupRes = await runSetup();
    expect(setupRes.status).toBe(303);

    const res = await runFetch(
      new Request("https://example.test/", { method: "GET" }),
    );

    expect(res.status).toBe(200);
    const html = await res.text();
    // Public chat page should contain display name
    expect(html).toContain("Jane Doe");
  });

  it("(b) POST /login with correct password → 303 Location /", async () => {
    const setupRes = await runSetup();
    expect(setupRes.status).toBe(303);

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
    // Must redirect to / (root)
    expect(location).toMatch(/\/$/);
    // Session cookie must be set
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain(SESSION_COOKIE_NAME);
    expect(setCookie).toContain("HttpOnly");
  });

  it("(c) GET / with session cookie from POST /login → 200 chat UI", async () => {
    const setupRes = await runSetup();
    expect(setupRes.status).toBe(303);

    // POST /login with correct password
    const body = new URLSearchParams();
    body.set("admin_password", ADMIN_PASSWORD);

    const loginRes = await runFetch(
      new Request("https://example.test/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      }),
    );
    expect(loginRes.status).toBe(303);

    // Extract session cookie
    const setCookieHeader = loginRes.headers.get("Set-Cookie") ?? "";
    const cookieMatch = setCookieHeader.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
    expect(cookieMatch).not.toBeNull();
    const cookieValue = cookieMatch![1];

    // GET / with session cookie
    const rootRes = await runFetch(
      new Request("https://example.test/", {
        method: "GET",
        headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
      }),
    );

    expect(rootRes.status).toBe(200);
    const html = await rootRes.text();
    // Chat page should show display name
    expect(html).toContain("Jane Doe");
  });

  it("(d) POST /login wrong password → 401 or re-render with error", async () => {
    const setupRes = await runSetup();
    expect(setupRes.status).toBe(303);

    const body = new URLSearchParams();
    body.set("admin_password", WRONG_PASSWORD);

    const res = await runFetch(
      new Request("https://example.test/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      }),
    );

    // Either 401 or a 200 re-render with error
    expect([401, 200]).toContain(res.status);
    if (res.status === 200) {
      const html = await res.text();
      // Re-rendered form should contain the password input and error indicator
      expect(html).toContain('name="admin_password"');
    }
    // Must NOT set a valid session cookie on failure
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).not.toContain(SESSION_COOKIE_NAME);
  });

  it("(e) POST /setup success → 303 Location pointing to / (not /admin)", async () => {
    const res = await runSetup();

    expect(res.status).toBe(303);
    const location = res.headers.get("Location") ?? "";
    // Must redirect to / (root), not /admin
    expect(location).toMatch(/\/$/);
    expect(location).not.toContain("/admin");
  });
});
