/**
 * Admin route tests — session-primary auth, login, reset.
 *
 * Covers:
 *   a) POST /admin/login with wrong password → 401, delay ≥ 400ms
 *   b) 11th wrong-password attempt from same IP → 429
 *   c) Correct password → 200 with valid Set-Cookie (name, HttpOnly, Secure, SameSite=Lax)
 *   d) GET /admin with valid session + no access_email → 200
 *   e) GET /admin with access_email set + only session cookie → 403
 *   f) POST /admin/reset with valid session + correct password + "DELETE ALL CONFIG" → KV deleted, Set-Cookie clears
 *   g) POST /admin/reset with wrong confirm → 400, KV intact
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../worker";
import { hashPassword } from "../../auth/password";
import { SESSION_COOKIE_NAME } from "../../auth/session";
import { ADMIN_PASSWORD_HASH_KEY } from "../../types/auth";

const TEST_PASSWORD = "supersecretpassword";
const RATE_LIMIT_IP = "1.2.3.4";
const SUCCESS_IP = "9.9.9.9";

interface TestEnv {
  STATE: KVNamespace;
}

function getEnv(): TestEnv {
  return env as unknown as TestEnv;
}

async function clearKv(): Promise<void> {
  const kv = getEnv().STATE;
  const keysToDelete = [
    "config",
    ADMIN_PASSWORD_HASH_KEY,
    "admin_password_hash",
    "cookie_signing_secret",
    `ratelimit:login:${RATE_LIMIT_IP}`,
    `ratelimit:login:${SUCCESS_IP}`,
    `ratelimit:login:unknown`,
    `ratelimit:login:10.0.0.1`,
  ];
  for (const key of keysToDelete) {
    await kv.delete(key);
  }
}

async function seedHashedPassword(): Promise<void> {
  const hash = await hashPassword(TEST_PASSWORD);
  await getEnv().STATE.put(ADMIN_PASSWORD_HASH_KEY, hash);
}

async function seedConfig(overrides: Record<string, unknown> = {}): Promise<void> {
  const config = { owner_name: "Test", ...overrides };
  await getEnv().STATE.put("config", JSON.stringify(config));
}

async function runFetch(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as never, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

function loginRequest(password: string, ip: string): Request {
  return new Request("https://example.test/admin/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "CF-Connecting-IP": ip,
    },
    body: JSON.stringify({ password }),
  });
}

function adminGetRequest(sessionCookieValue: string | null): Request {
  const headers: Record<string, string> = {};
  if (sessionCookieValue !== null) {
    headers["cookie"] = `${SESSION_COOKIE_NAME}=${sessionCookieValue}`;
  }
  return new Request("https://example.test/admin", { method: "GET", headers });
}

function resetRequest(
  sessionCookieValue: string,
  currentPassword: string,
  confirm: string,
): Request {
  return new Request("https://example.test/admin/reset", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cookie": `${SESSION_COOKIE_NAME}=${sessionCookieValue}`,
    },
    body: JSON.stringify({ current_password: currentPassword, confirm }),
  });
}

/**
 * Perform a successful login and return the session cookie value (not the full header).
 */
async function loginAndGetCookieValue(): Promise<string> {
  const res = await runFetch(loginRequest(TEST_PASSWORD, SUCCESS_IP));
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("Set-Cookie") ?? "";
  const match = setCookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  if (!match) throw new Error(`No session cookie in Set-Cookie: ${setCookie}`);
  return match[1];
}

// ===========================================================================
// POST /admin/login
// ===========================================================================

describe("POST /admin/login", () => {
  beforeEach(async () => {
    await clearKv();
    await seedHashedPassword();
  });

  afterEach(async () => {
    await clearKv();
  });

  // Test (a): wrong password → 401 with delay ≥ 400ms
  it("(a) wrong password returns 401 with delay ≥ 400ms", async () => {
    const start = Date.now();
    const res = await runFetch(loginRequest("wrongpassword", "10.0.0.1"));
    const elapsed = Date.now() - start;
    expect(res.status).toBe(401);
    expect(elapsed).toBeGreaterThanOrEqual(400);
  }, 10_000);

  // Test (b): 11 wrong attempts from same IP → 11th returns 429
  // Each wrong-password attempt has a 500ms delay, so 10 × 500ms = 5s.
  // Use a 20s timeout to allow all 10 incorrect attempts plus some margin.
  it("(b) 11th wrong-password attempt from same IP returns 429", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await runFetch(loginRequest("wrongpassword", RATE_LIMIT_IP));
      expect(res.status).toBe(401);
    }
    const res11 = await runFetch(loginRequest("wrongpassword", RATE_LIMIT_IP));
    expect(res11.status).toBe(429);
  }, 20_000);

  // Test (c): correct password → 200 with proper Set-Cookie attributes
  it("(c) correct password returns 200 with Set-Cookie containing required attributes", async () => {
    const res = await runFetch(loginRequest(TEST_PASSWORD, SUCCESS_IP));
    expect(res.status).toBe(200);

    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain(SESSION_COOKIE_NAME);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
  });
});

// ===========================================================================
// GET /admin with session cookie
// ===========================================================================

// This describe block documents the auth surface: admin route with no JWT
// (session cookie only) is accepted when Cloudflare Access is not configured,
// and rejected when access_email is set (CF Access JWT becomes required).
describe("admin route with no JWT — session cookie only", () => {
  beforeEach(async () => {
    await clearKv();
    await seedHashedPassword();
  });

  afterEach(async () => {
    await clearKv();
  });

  // Test (d): valid session + no access_email → 200
  it("(d) valid session cookie with no access_email in config returns 200", async () => {
    // Config without access_email — CF Access JWT not required
    await seedConfig({ owner_name: "Test" });

    const cookieValue = await loginAndGetCookieValue();
    const res = await runFetch(adminGetRequest(cookieValue));
    expect(res.status).toBe(200);
  });

  // Test (e): access_email set + only session cookie (no CF JWT) → 403
  it("(e) valid session cookie but access_email set and no CF JWT returns 403", async () => {
    // Config WITH access_email — CF Access JWT becomes required
    await seedConfig({ owner_name: "Test", access_email: "owner@test.example" });

    // Need a fresh login for this test (different SUCCESS_IP counter state after test d)
    // Clear the rate-limit counter for SUCCESS_IP to be safe
    await getEnv().STATE.delete(`ratelimit:login:${SUCCESS_IP}`);

    const cookieValue = await loginAndGetCookieValue();
    const res = await runFetch(adminGetRequest(cookieValue));
    expect(res.status).toBe(403);
  });
});

// ===========================================================================
// POST /admin/reset
// ===========================================================================

describe("POST /admin/reset", () => {
  beforeEach(async () => {
    await clearKv();
    await seedHashedPassword();
    await seedConfig({ owner_name: "Test" });
  });

  afterEach(async () => {
    await clearKv();
  });

  // Test (f): valid session + correct password + "DELETE ALL CONFIG" → KV deleted, session cleared
  it("(f) correct credentials + exact confirm string deletes KV keys and clears session cookie", async () => {
    const cookieValue = await loginAndGetCookieValue();

    const res = await runFetch(resetRequest(cookieValue, TEST_PASSWORD, "DELETE ALL CONFIG"));
    expect(res.status).toBe(200);

    const kv = getEnv().STATE;
    expect(await kv.get("config")).toBeNull();
    expect(await kv.get("admin_password_hash")).toBeNull();
    expect(await kv.get("cookie_signing_secret")).toBeNull();

    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain(SESSION_COOKIE_NAME);
    expect(setCookie).toContain("Max-Age=0");
  });

  // Test (g): wrong confirm string → 400, KV keys intact
  it("(g) wrong confirm string returns 400 and KV keys are not deleted", async () => {
    const cookieValue = await loginAndGetCookieValue();

    const res = await runFetch(resetRequest(cookieValue, TEST_PASSWORD, "wrong string"));
    expect(res.status).toBe(400);

    const kv = getEnv().STATE;
    expect(await kv.get("config")).not.toBeNull();
    expect(await kv.get("admin_password_hash")).not.toBeNull();
  });
});
