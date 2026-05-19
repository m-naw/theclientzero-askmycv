/**
 * Integration tests for SDD-3:
 *   (a) POST /admin/save with new_admin_password rotates cookie_signing_secret
 *       and invalidates the operator's existing session cookie.
 *   (b) GET /logout clears the session cookie + rotates the signing secret,
 *       303-redirecting to /login. A subsequent GET /admin with the old
 *       cookie redirects to /login (no longer authenticated).
 *   (c) POST /logout behaves identically to GET /logout.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env, createExecutionContext, fetchMock, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../worker";
import { TEST_JWKS_KV_KEY } from "../../routes/jwks-source";
import { ADMIN_PASSWORD_HASH_KEY } from "../../types/auth";
import { SESSION_COOKIE_NAME } from "../../auth/session";

const ANTHROPIC_HOST = "https://anthropic-mock-logout.test";
const ADMIN_PASSWORD = "correcthorsebatterystaple";
const NEW_ADMIN_PASSWORD = "newpassword1234secure";

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

async function runSetup(): Promise<Response> {
  mockAnthropicOk();
  await getEnv().STATE.put("setup_window_start", String(Date.now()));
  return runFetch(
    new Request("https://example.test/setup", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: makeSetupBody().toString(),
    }),
  );
}

async function loginAndGetCookie(password = ADMIN_PASSWORD): Promise<string> {
  const body = new URLSearchParams();
  body.set("admin_password", password);
  const res = await runFetch(
    new Request("https://example.test/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }),
  );
  expect(res.status).toBe(303);
  const setCookie = res.headers.get("Set-Cookie") ?? "";
  const m = setCookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  expect(m).not.toBeNull();
  return m![1];
}

function buildAdminSaveBody(opts: { newPassword?: string } = {}): URLSearchParams {
  const body = new URLSearchParams();
  body.set("display_name", "Jane Doe");
  body.set("headline", "Senior backend engineer · Berlin");
  body.set("cv_markdown",
    "# Jane Doe\n\n## Experience\n" +
      "Lots of experience working on backend systems across multiple companies and roles. ".repeat(5),
  );
  body.set("daily_budget_usd", "5");
  body.set("theme", "light");
  body.set("model", "claude-haiku-4-5-20251001");
  if (opts.newPassword) body.set("new_admin_password", opts.newPassword);
  return body;
}

describe("SDD-3: logout + password-change session rotation", () => {
  beforeEach(async () => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    try { fetchMock.enableNetConnect(/localhost/); } catch { /* ignore */ }

    (env as Record<string, string>).ANTHROPIC_BASE_URL = ANTHROPIC_HOST;
    (env as Record<string, string>).ACCESS_JWKS_URL_OVERRIDE = "";
    await clearKv();
  });

  afterEach(async () => {
    fetchMock.deactivate();
    await clearKv();
  });

  it("(a) POST /admin/save with new_admin_password rotates the secret + invalidates old session", async () => {
    const setupRes = await runSetup();
    expect(setupRes.status).toBe(303);

    const cookieValue = await loginAndGetCookie();

    // Confirm session works pre-rotation
    const preRes = await runFetch(
      new Request("https://example.test/admin", {
        method: "GET",
        headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
      }),
    );
    expect(preRes.status).toBe(200);

    // POST /admin/save with a new password
    const saveRes = await runFetch(
      new Request("https://example.test/admin/save", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: `${SESSION_COOKIE_NAME}=${cookieValue}`,
        },
        body: buildAdminSaveBody({ newPassword: NEW_ADMIN_PASSWORD }).toString(),
      }),
    );

    // Operator is redirected to /login and the session cookie is cleared
    expect(saveRes.status).toBe(303);
    const loc = saveRes.headers.get("Location") ?? "";
    expect(loc).toMatch(/^\/login/);
    const clearedCookie = saveRes.headers.get("Set-Cookie") ?? "";
    expect(clearedCookie).toContain(SESSION_COOKIE_NAME);
    expect(clearedCookie).toContain("Max-Age=0");

    // Signing secret must have been rotated (deleted) — KV entry is null
    const secret = await getEnv().STATE.get("cookie_signing_secret");
    expect(secret).toBeNull();

    // Subsequent GET /admin with the OLD cookie no longer authenticates →
    // routed to /admin/login (requireAdminAuth) — must NOT return 200.
    const postRes = await runFetch(
      new Request("https://example.test/admin", {
        method: "GET",
        headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
      }),
    );
    expect(postRes.status).not.toBe(200);
  });

  it("(b) GET /logout clears cookie + rotates secret + redirects to /login", async () => {
    const setupRes = await runSetup();
    expect(setupRes.status).toBe(303);

    const cookieValue = await loginAndGetCookie();

    // Confirm session works
    const preRes = await runFetch(
      new Request("https://example.test/admin", {
        method: "GET",
        headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
      }),
    );
    expect(preRes.status).toBe(200);

    const res = await runFetch(
      new Request("https://example.test/logout", {
        method: "GET",
        headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("Location") ?? "").toMatch(/^\/login/);
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain(SESSION_COOKIE_NAME);
    expect(setCookie).toContain("Max-Age=0");

    // Signing secret rotated
    const secret = await getEnv().STATE.get("cookie_signing_secret");
    expect(secret).toBeNull();

    // Old cookie no longer authenticates
    const postRes = await runFetch(
      new Request("https://example.test/admin", {
        method: "GET",
        headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
      }),
    );
    expect(postRes.status).not.toBe(200);
  });

  it("(c) POST /logout behaves identically to GET /logout", async () => {
    const setupRes = await runSetup();
    expect(setupRes.status).toBe(303);

    const cookieValue = await loginAndGetCookie();

    const res = await runFetch(
      new Request("https://example.test/logout", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("Location") ?? "").toMatch(/^\/login/);
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain(SESSION_COOKIE_NAME);
    expect(setCookie).toContain("Max-Age=0");

    const secret = await getEnv().STATE.get("cookie_signing_secret");
    expect(secret).toBeNull();

    const postRes = await runFetch(
      new Request("https://example.test/admin", {
        method: "GET",
        headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
      }),
    );
    expect(postRes.status).not.toBe(200);
  });
});
