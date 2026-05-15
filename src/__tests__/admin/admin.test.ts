/**
 * Admin route tests — GET /admin and POST /admin/save.
 *
 * Runs inside the @cloudflare/vitest-pool-workers miniflare runtime so KV
 * semantics and Web Crypto behave as on production.
 *
 * JWT verification is wired through the `__test_jwks` KV key (see
 * src/routes/jwks-source.ts). Tests write an in-memory JWKS document into KV
 * so no live network calls are made.
 *
 * The Anthropic SDK call inside POST /admin/save is intercepted via fetchMock.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env, createExecutionContext, fetchMock, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../worker";
import { createJwtHarness, mintAccessJwt } from "../../test-utils/jwt-harness";
import { TEST_JWKS_KV_KEY } from "../../routes/jwks-source";
import type { StoredConfig } from "../../types/config";

const ANTHROPIC_HOST = "https://anthropic-mock-admin.test";

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
    display_name: "Jane Doe",
    headline: "Senior backend engineer · Berlin",
    cv_markdown: "# Jane Doe\n\n" + "Experience: lots. ".repeat(15),
    anthropic_api_key: "sk-ant-existing-key",
    daily_budget_usd: 5,
    access_email: "owner@test.example",
    access_aud: "test-aud-admin",
    access_team_domain: "test.cloudflareaccess.com",
    setup_timestamp: Date.now() - 10_000,
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

function adminSaveRequest(jwt: string | null, body: URLSearchParams): Request {
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (jwt) headers["cf-access-jwt-assertion"] = jwt;
  return new Request("https://example.test/admin/save", {
    method: "POST",
    headers,
    body: body.toString(),
  });
}

function validSaveBody(overrides: Record<string, string> = {}): URLSearchParams {
  const body = new URLSearchParams();
  body.set("display_name", "Jane Doe Updated");
  body.set("headline", "Updated headline · Berlin");
  body.set("cv_markdown", "# Jane Doe\n\n" + "Updated experience section. ".repeat(15));
  body.set("daily_budget_usd", "7");
  for (const [k, v] of Object.entries(overrides)) {
    body.set(k, v);
  }
  return body;
}

function mockAnthropicOk(host = ANTHROPIC_HOST): void {
  fetchMock
    .get(host)
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

describe("GET /admin", () => {
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

  // Test 1: no JWT header → 403 with no_jwt denial
  it("Test 1: returns 403 with access-denied HTML when no JWT is present", async () => {
    const kp = await createJwtHarness();
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));
    await seedConfig(baseConfig());

    const res = await runFetch(adminGetRequest(null));
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toContain("no_jwt");
    expect(html).not.toContain("sk-ant-existing-key");
  });

  // Test 2: forged signature → 403 with signature_invalid denial
  it("Test 2: returns 403 with signature_invalid when JWT is signed by unknown key", async () => {
    const kp = await createJwtHarness();
    const foreign = await createJwtHarness("foreign-key-1");
    // KV trusts kp's JWKS only
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));
    await seedConfig(baseConfig());

    const jwt = await mintAccessJwt({
      privateKey: foreign.privateKey,
      kid: "foreign-key-1",
      aud: "test-aud-admin",
      iss: "https://test.cloudflareaccess.com",
      email: "owner@test.example",
    });

    const res = await runFetch(adminGetRequest(jwt));
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toContain("signature_invalid");
  });

  // Test 3: wrong team domain → 403 with team_domain_mismatch
  it("Test 3: returns 403 with team_domain_mismatch when iss differs from stored domain", async () => {
    const kp = await createJwtHarness();
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));
    await seedConfig(baseConfig({ access_team_domain: "correct.cloudflareaccess.com" }));

    const jwt = await mintAccessJwt({
      privateKey: kp.privateKey,
      aud: "test-aud-admin",
      iss: "https://other.cloudflareaccess.com",
      email: "owner@test.example",
    });

    const res = await runFetch(adminGetRequest(jwt));
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toContain("team_domain_mismatch");
  });

  // Test 4: wrong audience → 403 with aud_mismatch
  it("Test 4: returns 403 with aud_mismatch when JWT aud differs from stored aud", async () => {
    const kp = await createJwtHarness();
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));
    await seedConfig(baseConfig({ access_aud: "expected-aud" }));

    const jwt = await mintAccessJwt({
      privateKey: kp.privateKey,
      aud: "wrong-aud",
      iss: "https://test.cloudflareaccess.com",
      email: "owner@test.example",
    });

    const res = await runFetch(adminGetRequest(jwt));
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toContain("aud_mismatch");
  });

  // Test 5: wrong email → 403 with email_mismatch
  it("Test 5: returns 403 with email_mismatch when JWT email differs from stored email", async () => {
    const kp = await createJwtHarness();
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));
    await seedConfig(baseConfig({ access_email: "owner@test.example" }));

    const jwt = await mintAccessJwt({
      privateKey: kp.privateKey,
      aud: "test-aud-admin",
      iss: "https://test.cloudflareaccess.com",
      email: "attacker@other.example",
    });

    const res = await runFetch(adminGetRequest(jwt));
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toContain("email_mismatch");
  });

  // Test 6: valid JWT → 200 HTML with admin form, no API key value
  it("Test 6: returns 200 with admin form HTML pre-filled from config, no API key exposed", async () => {
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
    // Form is rendered
    expect(html).toContain('name="cv_markdown"');
    expect(html).toContain(cfg.display_name);
    expect(html).toContain(cfg.headline);
    // API key must never appear in the HTML
    expect(html).not.toContain("sk-ant-existing-key");
    expect(html).not.toContain("anthropic_api_key".replace("_", "")).not.toContain("sk-ant");
  });
});

describe("POST /admin/save", () => {
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

  // Test 7: blank API key field preserves existing key
  it("Test 7: blank anthropic_api_key preserves the existing key without calling Anthropic", async () => {
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

    const body = validSaveBody(); // no anthropic_api_key field
    const res = await runFetch(adminSaveRequest(jwt, body));
    expect(res.status).toBe(200);

    // Existing key preserved in KV
    const stored = JSON.parse((await getEnv().STATE.get("config")) as string) as StoredConfig;
    expect(stored.anthropic_api_key).toBe("sk-ant-existing-key");
    // Key never in response HTML
    const html = await res.clone().text().catch(() => "");
    expect(html).not.toContain("sk-ant-existing-key");
  });

  // Test 8: valid new API key is validated and persisted
  it("Test 8: non-blank valid anthropic_api_key is validated against Anthropic and persisted", async () => {
    const kp = await createJwtHarness();
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));
    const cfg = baseConfig();
    await seedConfig(cfg);
    mockAnthropicOk();

    const jwt = await mintAccessJwt({
      privateKey: kp.privateKey,
      aud: cfg.access_aud,
      iss: `https://${cfg.access_team_domain}`,
      email: cfg.access_email,
    });

    const body = validSaveBody({ anthropic_api_key: "sk-ant-new-rotated-key" });
    const res = await runFetch(adminSaveRequest(jwt, body));
    expect(res.status).toBe(200);

    const stored = JSON.parse((await getEnv().STATE.get("config")) as string) as StoredConfig;
    expect(stored.anthropic_api_key).toBe("sk-ant-new-rotated-key");
    // Key never in response
    const html = await res.text();
    expect(html).not.toContain("sk-ant-new-rotated-key");
  });

  // Test 9: invalid new API key returns 400 and does not update config
  it("Test 9: invalid anthropic_api_key returns 400 and config is not modified", async () => {
    const rejectHost = "https://anthropic-reject-admin.test";
    const kp = await createJwtHarness();
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));
    const cfg = baseConfig();
    await seedConfig(cfg);

    (env as Record<string, string>).ANTHROPIC_BASE_URL = rejectHost;
    fetchMock
      .get(rejectHost)
      .intercept({ path: /\/v1\/messages.*/, method: "POST" })
      .reply(
        401,
        JSON.stringify({ error: { type: "authentication_error" } }),
        { headers: { "content-type": "application/json" } },
      );

    const jwt = await mintAccessJwt({
      privateKey: kp.privateKey,
      aud: cfg.access_aud,
      iss: `https://${cfg.access_team_domain}`,
      email: cfg.access_email,
    });

    const body = validSaveBody({ anthropic_api_key: "sk-ant-bad-key" });
    const res = await runFetch(adminSaveRequest(jwt, body));
    expect(res.status).toBe(400);
    const json = await res.json() as { field?: string };
    expect(json.field).toBe("anthropic_api_key");

    // Config unchanged
    const stored = JSON.parse((await getEnv().STATE.get("config")) as string) as StoredConfig;
    expect(stored.anthropic_api_key).toBe("sk-ant-existing-key");
  });

  // Test 10: no JWT on POST → 403 denial HTML
  it("Test 10: POST /admin/save with no JWT returns 403 access-denied HTML", async () => {
    const kp = await createJwtHarness();
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));
    await seedConfig(baseConfig());

    const res = await runFetch(adminSaveRequest(null, validSaveBody()));
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toContain("no_jwt");
  });

  // Test 11: required field missing → 400
  it("Test 11: POST /admin/save missing display_name returns 400", async () => {
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

    const body = validSaveBody();
    body.delete("display_name");
    const res = await runFetch(adminSaveRequest(jwt, body));
    expect(res.status).toBe(400);
    const json = await res.json() as { field?: string };
    expect(json.field).toBe("display_name");
  });

  // Test 12: all 5 denial reasons are renderable (smoke test for denial copy)
  it("Test 12: all 5 denial reasons produce non-empty HTML bodies on GET /admin", async () => {
    const kp = await createJwtHarness();
    const foreign = await createJwtHarness("foreign-key-2");
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));
    await seedConfig(baseConfig());

    // no_jwt
    const r1 = await runFetch(adminGetRequest(null));
    expect(r1.status).toBe(403);
    expect(await r1.text()).toContain("no_jwt");

    // signature_invalid
    const forged = await mintAccessJwt({
      privateKey: foreign.privateKey,
      kid: "foreign-key-2",
      aud: "test-aud-admin",
      iss: "https://test.cloudflareaccess.com",
      email: "owner@test.example",
    });
    const r2 = await runFetch(adminGetRequest(forged));
    expect(r2.status).toBe(403);
    expect(await r2.text()).toContain("signature_invalid");

    // team_domain_mismatch
    const wrongDomain = await mintAccessJwt({
      privateKey: kp.privateKey,
      aud: "test-aud-admin",
      iss: "https://attacker.cloudflareaccess.com",
      email: "owner@test.example",
    });
    const r3 = await runFetch(adminGetRequest(wrongDomain));
    expect(r3.status).toBe(403);
    expect(await r3.text()).toContain("team_domain_mismatch");

    // aud_mismatch
    const wrongAud = await mintAccessJwt({
      privateKey: kp.privateKey,
      aud: "wrong-aud",
      iss: "https://test.cloudflareaccess.com",
      email: "owner@test.example",
    });
    const r4 = await runFetch(adminGetRequest(wrongAud));
    expect(r4.status).toBe(403);
    expect(await r4.text()).toContain("aud_mismatch");

    // email_mismatch
    const wrongEmail = await mintAccessJwt({
      privateKey: kp.privateKey,
      aud: "test-aud-admin",
      iss: "https://test.cloudflareaccess.com",
      email: "attacker@other.example",
    });
    const r5 = await runFetch(adminGetRequest(wrongEmail));
    expect(r5.status).toBe(403);
    expect(await r5.text()).toContain("email_mismatch");
  });
});
