/**
 * Integration test: setup flow without Cloudflare Access JWT.
 *
 * Verifies that a fresh deployment can be set up without any CF Access
 * policy or JWT header — using only admin_password for authentication.
 *
 * Scenario:
 *   1. GET /setup → 200 (setup form rendered, no JWT required)
 *   2. POST /setup with admin_password within window → 303 + Set-Cookie
 *   3. GET /admin with that session cookie → 200
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env, createExecutionContext, fetchMock, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../worker";
import { TEST_JWKS_KV_KEY } from "../../routes/jwks-source";
import { ADMIN_PASSWORD_HASH_KEY } from "../../types/auth";
import { SESSION_COOKIE_NAME } from "../../auth/session";
import type { StoredConfig } from "../../types/config";

const ANTHROPIC_HOST = "https://anthropic-mock-nocf.test";

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

function makeSetupBody(): URLSearchParams {
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
  body.set("admin_password", ADMIN_PASSWORD);
  return body;
}

describe("Setup without Cloudflare Access JWT", () => {
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

  it("GET /setup returns 200 (no JWT required)", async () => {
    const res = await runFetch(
      new Request("https://example.test/setup", { method: "GET" }),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('name="cv_markdown"');
    expect(html).toContain('name="admin_password"');
  });

  it("POST /setup with admin_password within window returns 303 + Set-Cookie", async () => {
    mockAnthropicOk();

    const res = await runFetch(
      new Request("https://example.test/setup", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: makeSetupBody().toString(),
      }),
    );

    expect(res.status).toBe(303);

    // Location must point to /admin
    const location = res.headers.get("Location") ?? "";
    expect(location).toContain("/admin");

    // Set-Cookie must be present with required security attributes
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain(SESSION_COOKIE_NAME);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");

    // Config persisted; access_email absent (no CF Access)
    const raw = await getEnv().STATE.get("config");
    expect(raw).not.toBeNull();
    const cfg = JSON.parse(raw as string) as StoredConfig;
    expect(cfg.access_email).toBeUndefined();
    expect(cfg.display_name).toBe("Jane Doe");

    // admin_password_hash stored separately — never on the config object
    const hash = await getEnv().STATE.get(ADMIN_PASSWORD_HASH_KEY);
    expect(hash).not.toBeNull();
    expect(typeof hash).toBe("string");
    // Hash must look like a bcrypt hash ($2b$ prefix)
    expect((hash as string).startsWith("$2")).toBe(true);

    // Anthropic key must never appear in the Set-Cookie header
    expect(setCookie).not.toContain("sk-ant-test-key");
  });

  it("GET /admin with session cookie from /setup returns 200", async () => {
    mockAnthropicOk();

    // Step 1: complete setup
    const setupRes = await runFetch(
      new Request("https://example.test/setup", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: makeSetupBody().toString(),
      }),
    );
    expect(setupRes.status).toBe(303);

    // Extract session cookie value from Set-Cookie header
    const setCookieHeader = setupRes.headers.get("Set-Cookie") ?? "";
    const cookieMatch = setCookieHeader.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
    expect(cookieMatch).not.toBeNull();
    const cookieValue = cookieMatch![1];
    expect(cookieValue.length).toBeGreaterThan(0);

    // Step 2: GET /admin with that cookie
    const adminRes = await runFetch(
      new Request("https://example.test/admin", {
        method: "GET",
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${cookieValue}`,
        },
      }),
    );
    expect(adminRes.status).toBe(200);
    const adminHtml = await adminRes.text();
    // Admin page should contain config form elements
    expect(adminHtml).toContain('name="cv_markdown"');
  });

  it("GET /admin without session cookie returns 401", async () => {
    mockAnthropicOk();

    // Complete setup first so config exists
    await runFetch(
      new Request("https://example.test/setup", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: makeSetupBody().toString(),
      }),
    );

    // GET /admin with no cookie
    const adminRes = await runFetch(
      new Request("https://example.test/admin", { method: "GET" }),
    );
    expect(adminRes.status).toBe(401);
  });
});
