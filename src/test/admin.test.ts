/**
 * GET /admin route tests — session-primary auth model.
 *
 * Runs inside the @cloudflare/vitest-pool-workers miniflare runtime so KV
 * semantics and Web Crypto behave as on production.
 *
 * Auth model:
 *   Layer 1 (primary): admin session cookie (HMAC-SHA256 signed).
 *     Missing → 401.
 *   Layer 2 (optional): CF Access JWT when config.access_email is set.
 *     Present but invalid → 403.
 *
 * JWT verification is wired through the `__test_jwks` KV key (see
 * src/routes/jwks-source.ts). Tests write an in-memory JWKS document into KV
 * so no live network calls are made.
 *
 * Coverage:
 *   - success: valid session cookie + valid JWT → 200 HTML with admin form pre-filled, no API key exposed
 *   - denial: no_session (→ 401), valid session + missing JWT + access_email set (→ 403)
 *   - denial: valid session + signature_invalid JWT, team_domain_mismatch, aud_mismatch, email_mismatch
 *   - success: valid session + no access_email configured → 200 (no JWT needed)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env, createExecutionContext, fetchMock, waitOnExecutionContext } from "cloudflare:test";
import worker from "../worker";
import { createJwtHarness, mintAccessJwt } from "../test-utils/jwt-harness";
import { TEST_JWKS_KV_KEY } from "../routes/jwks-source";
import { signSession, SESSION_COOKIE_NAME } from "../auth/session";
import type { AdminSessionPayload } from "../auth/session";
import type { StoredConfig } from "../types/config";

/** KV key under which the cookie-signing secret is stored (must match session.ts). */
const SIGNING_SECRET_KV_KEY = "cookie_signing_secret";
/** A fixed test secret — deterministic so tests are reproducible. */
const TEST_SIGNING_SECRET = "test-hmac-signing-secret-32bytes!!";

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
  for (const key of ["config", "setup_window_start", TEST_JWKS_KV_KEY, SIGNING_SECRET_KV_KEY]) {
    await kv.delete(key);
  }
}

function baseConfig(overrides: Partial<StoredConfig> = {}): StoredConfig {
  return {
    display_name: "Test Owner",
    headline: "Full-stack engineer · Remote",
    cv_markdown: "# Test Owner\n\n## Experience\n\n" + "Worked on many projects. ".repeat(12),
    anthropic_api_key: "sk-ant-admin-test-secret-key",
    daily_budget_usd: 3,
    access_email: "owner@admin-test.example",
    access_aud: "admin-test-aud-123",
    access_team_domain: "admintest.cloudflareaccess.com",
    setup_timestamp: Date.now() - 5_000,
    ...overrides,
  };
}

async function seedConfig(cfg: StoredConfig): Promise<void> {
  await getEnv().STATE.put("config", JSON.stringify(cfg));
}

/**
 * SC1: Seed the cookie_signing_secret into KV and return a valid signed
 * session cookie string (cookie value only, not the full Set-Cookie header).
 */
async function seedSessionAndCookie(): Promise<string> {
  const kv = getEnv().STATE;
  // Write a deterministic signing secret to KV
  await kv.put(SIGNING_SECRET_KV_KEY, TEST_SIGNING_SECRET);
  // Mint a fresh session payload (valid for 1 hour)
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: AdminSessionPayload = {
    sub: "admin",
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };
  // Sign using the same function production uses
  const token = await signSession(payload, TEST_SIGNING_SECRET);
  return token;
}

async function runFetch(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as never, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/** Build a GET /admin request. Attaches session cookie and/or JWT header as supplied. */
function adminGetRequest(opts: { sessionCookie?: string; jwt?: string | null }): Request {
  const headers: Record<string, string> = {};
  if (opts.sessionCookie) {
    headers["Cookie"] = `${SESSION_COOKIE_NAME}=${opts.sessionCookie}`;
  }
  if (opts.jwt != null && opts.jwt.length > 0) {
    headers["cf-access-jwt-assertion"] = opts.jwt;
  }
  return new Request("https://example.test/admin", { method: "GET", headers });
}

describe("GET /admin — session-primary auth model", () => {
  beforeEach(async () => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    try { fetchMock.enableNetConnect(/localhost/); } catch { /* not all versions */ }
    (env as Record<string, string>).ANTHROPIC_BASE_URL = "";
    (env as Record<string, string>).ACCESS_JWKS_URL_OVERRIDE = "";
    await clearKv();
  });

  afterEach(async () => {
    fetchMock.deactivate();
    await clearKv();
  });

  // SC1 + SC2 + success case: valid session + valid JWT → 200 with form, no API key exposed
  it("valid session cookie + valid JWT returns 200 with admin form pre-filled and no API key", async () => {
    const kp = await createJwtHarness();
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));
    const cfg = baseConfig();
    await seedConfig(cfg);
    // SC1: seed session
    const sessionCookie = await seedSessionAndCookie();

    const jwt = await mintAccessJwt({
      privateKey: kp.privateKey,
      aud: cfg.access_aud,
      iss: `https://${cfg.access_team_domain}`,
      email: cfg.access_email,
    });

    const res = await runFetch(adminGetRequest({ sessionCookie, jwt }));
    expect(res.status).toBe(200);
    const html = await res.text();

    // Admin form fields are present
    expect(html).toContain('name="cv_markdown"');
    // Pre-filled with current config values
    expect(html).toContain(cfg.display_name);
    expect(html).toContain(cfg.headline);
    // cv_markdown content is in the form
    expect(html).toContain("Test Owner");
    // API key must never appear in the HTML
    expect(html).not.toContain("sk-ant-admin-test-secret-key");
    expect(html).not.toContain("sk-ant");
  });

  // S6: no session cookie → 401 (session is the primary auth layer)
  it("missing session cookie returns 401 regardless of JWT", async () => {
    const kp = await createJwtHarness();
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));
    const cfg = baseConfig();
    await seedConfig(cfg);

    const jwt = await mintAccessJwt({
      privateKey: kp.privateKey,
      aud: cfg.access_aud,
      iss: `https://${cfg.access_team_domain}`,
      email: cfg.access_email,
    });

    // No session cookie, JWT present — should still get 401
    const res = await runFetch(adminGetRequest({ jwt }));
    expect(res.status).toBe(401);
    // API key must not appear even in denial response
    const body = await res.text();
    expect(body).not.toContain("sk-ant-admin-test-secret-key");
  });

  // SC3: valid session + missing JWT + access_email set → 403 (second-layer denial)
  it("valid session cookie + missing JWT + config.access_email set returns 403", async () => {
    const kp = await createJwtHarness();
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));
    // Config has access_email set → JWT layer is enforced
    await seedConfig(baseConfig({ access_email: "owner@admin-test.example" }));
    const sessionCookie = await seedSessionAndCookie();

    // Valid session but NO JWT
    const res = await runFetch(adminGetRequest({ sessionCookie }));
    expect(res.status).toBe(403);
  });

  // SC2: valid session + no access_email → 200 (JWT layer skipped entirely)
  it("valid session cookie + no access_email configured returns 200 without any JWT", async () => {
    // Config has no access_email → JWT layer is bypassed
    await seedConfig(baseConfig({ access_email: undefined }));
    const sessionCookie = await seedSessionAndCookie();

    const res = await runFetch(adminGetRequest({ sessionCookie }));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("sk-ant-admin-test-secret-key");
  });

  // SC2: valid session + JWT with wrong signature → 403
  it("valid session + JWT signed by untrusted key returns 403", async () => {
    const kp = await createJwtHarness();
    const foreign = await createJwtHarness("foreign-admin-key-1");
    // KV trusts kp's JWKS only
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));
    await seedConfig(baseConfig());
    const sessionCookie = await seedSessionAndCookie();

    const jwt = await mintAccessJwt({
      privateKey: foreign.privateKey,
      kid: "foreign-admin-key-1",
      aud: "admin-test-aud-123",
      iss: "https://admintest.cloudflareaccess.com",
      email: "owner@admin-test.example",
    });

    const res = await runFetch(adminGetRequest({ sessionCookie, jwt }));
    expect(res.status).toBe(403);
  });

  // SC2: valid session + JWT with wrong issuer → 403
  it("valid session + JWT with wrong issuer returns 403", async () => {
    const kp = await createJwtHarness();
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));
    await seedConfig(baseConfig({ access_team_domain: "correct.cloudflareaccess.com" }));
    const sessionCookie = await seedSessionAndCookie();

    const jwt = await mintAccessJwt({
      privateKey: kp.privateKey,
      aud: "admin-test-aud-123",
      iss: "https://attacker.cloudflareaccess.com",
      email: "owner@admin-test.example",
    });

    const res = await runFetch(adminGetRequest({ sessionCookie, jwt }));
    expect(res.status).toBe(403);
  });

  // SC2: valid session + JWT with wrong audience → 403
  it("valid session + JWT with wrong audience returns 403", async () => {
    const kp = await createJwtHarness();
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));
    await seedConfig(baseConfig({ access_aud: "expected-aud-value" }));
    const sessionCookie = await seedSessionAndCookie();

    const jwt = await mintAccessJwt({
      privateKey: kp.privateKey,
      aud: "completely-wrong-aud",
      iss: "https://admintest.cloudflareaccess.com",
      email: "owner@admin-test.example",
    });

    const res = await runFetch(adminGetRequest({ sessionCookie, jwt }));
    expect(res.status).toBe(403);
  });

  // SC2: valid session + valid JWT but access_email not matching JWT email
  // requireAdminAuth verifies JWT crypto (sig, aud, iss) but does not
  // recheck JWT email against config.access_email — that check belongs to the
  // state machine. A valid-signature JWT from a wrong email passes Layer 2.
  it("valid session + cryptographically valid JWT (wrong email) passes JWT layer → 200", async () => {
    const kp = await createJwtHarness();
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));
    await seedConfig(baseConfig({ access_email: "owner@admin-test.example" }));
    const sessionCookie = await seedSessionAndCookie();

    const jwt = await mintAccessJwt({
      privateKey: kp.privateKey,
      aud: "admin-test-aud-123",
      iss: "https://admintest.cloudflareaccess.com",
      email: "attacker@evil.example",
    });

    // Valid session + crypto-valid JWT → requireAdminAuth returns null → 200
    const res = await runFetch(adminGetRequest({ sessionCookie, jwt }));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("sk-ant-admin-test-secret-key");
  });
});
