/**
 * GET /admin route tests — all done_when criteria.
 *
 * Runs inside the @cloudflare/vitest-pool-workers miniflare runtime so KV
 * semantics and Web Crypto behave as on production.
 *
 * JWT verification is wired through the `__test_jwks` KV key (see
 * src/routes/jwks-source.ts). Tests write an in-memory JWKS document into KV
 * so no live network calls are made.
 *
 * Coverage:
 *   - success: valid identity → 200 HTML with admin form pre-filled, no API key exposed
 *   - denial: no_jwt, signature_invalid, team_domain_mismatch, aud_mismatch, email_mismatch
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env, createExecutionContext, fetchMock, waitOnExecutionContext } from "cloudflare:test";
import worker from "../worker";
import { createJwtHarness, mintAccessJwt } from "../test-utils/jwt-harness";
import { TEST_JWKS_KV_KEY } from "../routes/jwks-source";
import type { StoredConfig } from "../types/config";

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
  for (const key of ["config", "setup_window_start", TEST_JWKS_KV_KEY]) {
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

async function runFetch(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as never, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

function adminGetRequest(jwt: string | null): Request {
  const headers: Record<string, string> = {};
  if (jwt) headers["cf-access-jwt-assertion"] = jwt;
  return new Request("https://example.test/admin", { method: "GET", headers });
}

describe("GET /admin — all done_when criteria", () => {
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

  // SC2 + SC3 + SC4: success case
  it("valid identity returns 200 with admin form pre-filled from config and no API key exposed", async () => {
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

    const res = await runFetch(adminGetRequest(jwt));
    expect(res.status).toBe(200);
    const html = await res.text();

    // Admin form fields are present
    expect(html).toContain('name="cv_markdown"');
    // Pre-filled with current config values
    expect(html).toContain(cfg.display_name);
    expect(html).toContain(cfg.headline);
    // cv_markdown content is in the form
    expect(html).toContain("Test Owner");
    // API key must never appear in the HTML (SC4)
    expect(html).not.toContain("sk-ant-admin-test-secret-key");
    expect(html).not.toContain("sk-ant");
  });

  // SC2: denial reason — no_jwt
  it("missing CF-Authorization header returns 403 with reason=no_jwt", async () => {
    const kp = await createJwtHarness();
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));
    await seedConfig(baseConfig());

    const res = await runFetch(adminGetRequest(null));
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toContain("no_jwt");
    // API key must not appear even in denial HTML
    expect(html).not.toContain("sk-ant-admin-test-secret-key");
  });

  // SC2: denial reason — signature_invalid
  it("JWT signed by an untrusted key returns 403 with reason=signature_invalid", async () => {
    const kp = await createJwtHarness();
    const foreign = await createJwtHarness("foreign-admin-key-1");
    // KV trusts kp's JWKS only
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));
    await seedConfig(baseConfig());

    const jwt = await mintAccessJwt({
      privateKey: foreign.privateKey,
      kid: "foreign-admin-key-1",
      aud: "admin-test-aud-123",
      iss: "https://admintest.cloudflareaccess.com",
      email: "owner@admin-test.example",
    });

    const res = await runFetch(adminGetRequest(jwt));
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toContain("signature_invalid");
  });

  // SC2: denial reason — team_domain_mismatch
  it("JWT with wrong issuer returns 403 with reason=team_domain_mismatch", async () => {
    const kp = await createJwtHarness();
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));
    await seedConfig(baseConfig({ access_team_domain: "correct.cloudflareaccess.com" }));

    const jwt = await mintAccessJwt({
      privateKey: kp.privateKey,
      aud: "admin-test-aud-123",
      iss: "https://attacker.cloudflareaccess.com",
      email: "owner@admin-test.example",
    });

    const res = await runFetch(adminGetRequest(jwt));
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toContain("team_domain_mismatch");
  });

  // SC2: denial reason — aud_mismatch
  it("JWT with wrong audience returns 403 with reason=aud_mismatch", async () => {
    const kp = await createJwtHarness();
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));
    await seedConfig(baseConfig({ access_aud: "expected-aud-value" }));

    const jwt = await mintAccessJwt({
      privateKey: kp.privateKey,
      aud: "completely-wrong-aud",
      iss: "https://admintest.cloudflareaccess.com",
      email: "owner@admin-test.example",
    });

    const res = await runFetch(adminGetRequest(jwt));
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toContain("aud_mismatch");
  });

  // SC2: denial reason — email_mismatch
  it("JWT with wrong email returns 403 with reason=email_mismatch", async () => {
    const kp = await createJwtHarness();
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));
    await seedConfig(baseConfig({ access_email: "owner@admin-test.example" }));

    const jwt = await mintAccessJwt({
      privateKey: kp.privateKey,
      aud: "admin-test-aud-123",
      iss: "https://admintest.cloudflareaccess.com",
      email: "attacker@evil.example",
    });

    const res = await runFetch(adminGetRequest(jwt));
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toContain("email_mismatch");
  });
});
