/**
 * Setup acceptance tests — spec §12 Tests 1–5.
 *
 * Runs against the real Worker handler inside the @cloudflare/vitest-pool-workers
 * miniflare runtime so KV semantics and Web Crypto behave as on production.
 *
 * The Anthropic SDK call inside POST /setup is intercepted via fetchMock —
 * we point the SDK at env.ANTHROPIC_BASE_URL (set to a synthetic host) and
 * register interceptors for the /v1/messages endpoint.
 *
 * JWT signature verification is wired through the reserved KV key
 * `__test_jwks` (see src/routes/jwks-source.ts). Tests write a JWKS document
 * matching their test keypair into KV; production never writes that key.
 *
 * CF Access JWT is OPTIONAL since the optional-CF-Access feature:
 *   - GET /setup works without JWT (returns 200).
 *   - POST /setup works without JWT (returns 303 on success).
 *   - POST /setup with invalid JWT still returns 403 (we still verify when present).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env, createExecutionContext, fetchMock, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../worker";
import { createJwtHarness, mintAccessJwt } from "../../test-utils/jwt-harness";
import { SETUP_WINDOW_MS } from "../../state/machine";
import { TEST_JWKS_KV_KEY } from "../../routes/jwks-source";
import { ADMIN_PASSWORD_HASH_KEY } from "../../types/auth";
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
  for (const key of ["config", "setup_window_start", TEST_JWKS_KV_KEY, ADMIN_PASSWORD_HASH_KEY, "cookie_signing_secret"]) {
    await kv.delete(key);
  }
}

function validFormBody(): URLSearchParams {
  const body = new URLSearchParams();
  body.set("display_name", "Jane Doe");
  body.set("headline", "Senior backend engineer · Berlin");
  body.set("anthropic_api_key", "sk-ant-test-key");
  body.set("daily_budget_usd", "5");
  // 250+ chars to satisfy MIN
  body.set(
    "cv_markdown",
    "# Jane Doe\n\n## Experience\n" +
      "Lots of experience working on backend systems across multiple companies and roles. ".repeat(5),
  );
  body.set("admin_password", "correcthorsebatterystaple");
  return body;
}

function setupRequest(jwt: string | null, body: URLSearchParams): Request {
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (jwt) headers["cf-access-jwt-assertion"] = jwt;
  return new Request("https://example.test/setup", {
    method: "POST",
    headers,
    body: body.toString(),
  });
}

function getSetupRequest(jwt?: string): Request {
  const headers: Record<string, string> = {};
  if (jwt) headers["cf-access-jwt-assertion"] = jwt;
  return new Request("https://example.test/setup", { method: "GET", headers });
}

function rootRequest(jwt?: string): Request {
  const headers: Record<string, string> = {};
  if (jwt) headers["cf-access-jwt-assertion"] = jwt;
  return new Request("https://example.test/", { headers });
}

async function runFetch(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as never, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/** Register an Anthropic mock that returns HTTP 200 to /v1/messages. */
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

describe("Setup acceptance tests (spec §12)", () => {
  beforeEach(async () => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    // Allow loopback so miniflare internal traffic still works.
    try { fetchMock.enableNetConnect(/localhost/); } catch { /* not all versions */ }

    (env as Record<string, string>).ANTHROPIC_BASE_URL = ANTHROPIC_HOST;
    (env as Record<string, string>).ACCESS_JWKS_URL_OVERRIDE = "";
    await clearKv();
  });

  afterEach(async () => {
    fetchMock.deactivate();
    await clearKv();
  });

  // ---------------------------------------------------------------------
  // Timing precision check: setup_window_start is recorded within 5000ms
  // ---------------------------------------------------------------------
  it("setup_window_start is recorded within 5000 ms of the GET / request", async () => {
    const before = Date.now();
    await runFetch(rootRequest());
    const after = Date.now();

    const stored = await getEnv().STATE.get("setup_window_start");
    expect(stored).not.toBeNull();
    const ts = Number(stored);
    // setup_window_start must be within 5_000 ms of when the request was made
    expect(ts).toBeGreaterThanOrEqual(before - 5_000);
    expect(ts).toBeLessThanOrEqual(after + 5_000);
  });

  // ---------------------------------------------------------------------
  // Test 1: Cold-start state machine
  // JWT is no longer required — GET /setup and POST /setup work without JWT.
  // ---------------------------------------------------------------------
  it("Test 1: cold-start GET / serves instructions, records setup_window_start; GET /setup without JWT returns 200", async () => {
    // (1) GET /
    const getRes = await runFetch(rootRequest());
    expect(getRes.status).toBe(200);
    const html = await getRes.text();
    expect(html).toContain("/setup");
    expect(html).toContain("/admin");

    // (2) setup_window_start now set
    const stored = await getEnv().STATE.get("setup_window_start");
    expect(stored).not.toBeNull();
    const ts = Number(stored);
    expect(Number.isFinite(ts)).toBe(true);
    expect(Math.abs(Date.now() - ts)).toBeLessThan(60_000);

    // (3) GET /setup without JWT — now allowed (200)
    const setupGetRes = await runFetch(getSetupRequest());
    expect(setupGetRes.status).toBe(200);
    const setupHtml = await setupGetRes.text();
    expect(setupHtml).toContain('name="cv_markdown"');

    // (4) config still absent
    expect(await getEnv().STATE.get("config")).toBeNull();
  });

  // ---------------------------------------------------------------------
  // Test 1b: POST /setup without JWT and without admin_password returns 400
  // ---------------------------------------------------------------------
  it("Test 1b: POST /setup without JWT and without admin_password returns 400", async () => {
    const bodyWithoutPassword = validFormBody();
    bodyWithoutPassword.delete("admin_password");

    const postRes = await runFetch(setupRequest(null, bodyWithoutPassword));
    expect(postRes.status).toBe(400);
    const json = await postRes.json() as { field?: string };
    expect(json.field).toBe("admin_password");

    // config still absent
    expect(await getEnv().STATE.get("config")).toBeNull();
  });

  // ---------------------------------------------------------------------
  // Test 2: Setup without JWT — password-only mode
  // ---------------------------------------------------------------------
  it("Test 2a: POST /setup without JWT persists config and redirects to /admin with Set-Cookie", async () => {
    mockAnthropicOk();

    const postRes = await runFetch(setupRequest(null, validFormBody()));
    expect(postRes.status).toBe(303);
    expect(postRes.headers.get("Location")).toContain("/admin");

    const setCookie = postRes.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");

    // config persisted, no access_email (password-only mode)
    const stored = await getEnv().STATE.get("config");
    expect(stored).not.toBeNull();
    const cfg = JSON.parse(stored as string) as StoredConfig;
    expect(cfg.access_email).toBeUndefined();
    expect(cfg.anthropic_api_key).toBe("sk-ant-test-key");

    // admin_password_hash stored in KV (never on config)
    const hash = await getEnv().STATE.get(ADMIN_PASSWORD_HASH_KEY);
    expect(hash).not.toBeNull();

    // Anthropic key must never appear in response
    expect(setCookie).not.toContain("sk-ant-test-key");
  });

  // ---------------------------------------------------------------------
  // Test 2b: Setup with valid JWT — CF Access mode
  // ---------------------------------------------------------------------
  it("Test 2b: POST /setup with valid JWT persists config with identity claims and redirects to /admin", async () => {
    const kp = await createJwtHarness();
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));

    const jwt = await mintAccessJwt({
      privateKey: kp.privateKey,
      aud: "test-aud-1",
      iss: "https://test.cloudflareaccess.com",
      email: "owner@test",
    });

    // (1) GET /setup with JWT — expect setup form
    const getRes = await runFetch(getSetupRequest(jwt));
    expect(getRes.status).toBe(200);
    const html = await getRes.text();
    expect(html).toContain('name="cv_markdown"');

    // (2) Pre-configure Anthropic mock → 200
    mockAnthropicOk();

    // (3) POST /setup with JWT and valid body
    const postRes = await runFetch(setupRequest(jwt, validFormBody()));
    expect(postRes.status).toBe(303);
    expect(postRes.headers.get("Location")).toContain("/admin");

    const setCookie = postRes.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");

    // (4) config persisted with identity captured from JWT
    const stored = await getEnv().STATE.get("config");
    expect(stored).not.toBeNull();
    const cfg = JSON.parse(stored as string) as StoredConfig;
    expect(cfg.access_email).toBe("owner@test");
    expect(cfg.access_aud).toBe("test-aud-1");
    expect(cfg.access_team_domain).toBe("test.cloudflareaccess.com");
    // (5) Anthropic key is persisted on the config record (KV-only).
    expect(cfg.anthropic_api_key).toBe("sk-ant-test-key");
    // The Anthropic key must never appear in the Set-Cookie or response.
    expect(setCookie).not.toContain("sk-ant-test-key");
  });

  // ---------------------------------------------------------------------
  // Test 3: Setup blocked after configuration
  // ---------------------------------------------------------------------
  it("Test 3: POST /setup after config already present returns 403, config unchanged", async () => {
    const kp = await createJwtHarness();
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));

    const existing: StoredConfig = {
      display_name: "Existing",
      headline: "Blurb",
      cv_markdown: "x".repeat(300),
      anthropic_api_key: "sk-ant-existing",
      daily_budget_usd: 3,
      access_email: "owner@test",
      access_aud: "test-aud-1",
      access_team_domain: "test.cloudflareaccess.com",
      setup_timestamp: Date.now() - 1000,
    };
    await getEnv().STATE.put("config", JSON.stringify(existing));

    const jwt = await mintAccessJwt({
      privateKey: kp.privateKey,
      aud: "test-aud-1",
      iss: "https://test.cloudflareaccess.com",
      email: "owner@test",
    });

    mockAnthropicOk();

    const body = validFormBody();
    body.set("display_name", "New Name");
    const res = await runFetch(setupRequest(jwt, body));
    expect(res.status).toBe(403);

    const after = JSON.parse((await getEnv().STATE.get("config")) as string) as StoredConfig;
    expect(after.display_name).toBe("Existing");
  });

  // ---------------------------------------------------------------------
  // Test 4: Setup blocked with forged / wrong-iss / expired JWT
  // When a JWT is present, it must pass verification.
  // ---------------------------------------------------------------------
  it("Test 4: POST /setup with forged / wrong-issuer / expired JWT all 403, config absent", async () => {
    const kp = await createJwtHarness();
    const foreign = await createJwtHarness();
    // The Worker trusts kp's JWKS; foreign-signed tokens fail verification.
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));

    mockAnthropicOk();

    // (1) Forged signature.
    const forged = await mintAccessJwt({
      privateKey: foreign.privateKey,
      aud: "test-aud-1",
      iss: "https://test.cloudflareaccess.com",
      email: "owner@test",
    });
    const r1 = await runFetch(setupRequest(forged, validFormBody()));
    expect(r1.status).toBe(403);

    // (2) Wrong issuer.
    const wrongIss = await mintAccessJwt({
      privateKey: kp.privateKey,
      aud: "test-aud-1",
      iss: "https://attacker.example.com",
      email: "owner@test",
    });
    const r2 = await runFetch(setupRequest(wrongIss, validFormBody()));
    expect(r2.status).toBe(403);

    // (3) Expired.
    const expired = await mintAccessJwt({
      privateKey: kp.privateKey,
      aud: "test-aud-1",
      iss: "https://test.cloudflareaccess.com",
      email: "owner@test",
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const r3 = await runFetch(setupRequest(expired, validFormBody()));
    expect(r3.status).toBe(403);

    expect(await getEnv().STATE.get("config")).toBeNull();
  });

  // ---------------------------------------------------------------------
  // Test 5: Setup window expiration and recovery
  // ---------------------------------------------------------------------
  it("Test 5: expired window renders expired page; POST /setup returns 410; deletion recovers", async () => {
    const kp = await createJwtHarness();
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));

    // Pre-set setup_window_start to 31 minutes ago.
    const oldStart = Date.now() - (SETUP_WINDOW_MS + 60_000);
    await getEnv().STATE.put("setup_window_start", String(oldStart));

    // (1) GET / with no JWT → expired page
    const expiredHtml = await (await runFetch(rootRequest())).text();
    expect(expiredHtml).toContain("setup_window_start");
    expect(expiredHtml.toLowerCase()).toContain("expired");

    // (2) POST /setup with valid body and expired window → 410
    mockAnthropicOk();
    const r = await runFetch(setupRequest(null, validFormBody()));
    expect(r.status).toBe(410);

    // (3) Delete setup_window_start
    await getEnv().STATE.delete("setup_window_start");

    // (4) GET / with no JWT → setup instructions (not expired page)
    const recoveryHtml = await (await runFetch(rootRequest())).text();
    expect(recoveryHtml.toLowerCase()).not.toContain("setup window expired");

    // (5) GET /setup without JWT → setup form (200)
    const formRes = await runFetch(getSetupRequest());
    expect(formRes.status).toBe(200);
    const formHtml = await formRes.text();
    expect(formHtml).toContain('name="cv_markdown"');
  });

  // ---------------------------------------------------------------------
  // Test 6: Anthropic key rejection
  // ---------------------------------------------------------------------
  it("returns 400 when Anthropic rejects the key", async () => {
    // Use a dedicated host so we don't collide with persisted 200 interceptors
    // from earlier tests on ANTHROPIC_HOST.
    const rejectHost = "https://anthropic-reject.test";
    (env as Record<string, string>).ANTHROPIC_BASE_URL = rejectHost;
    const pool = fetchMock.get(rejectHost);

    let capturedBody: string | undefined;
    pool
      .intercept({ path: /\/v1\/messages.*/, method: "POST" })
      .reply((opts: { body?: unknown }) => {
        capturedBody = typeof opts.body === "string" ? opts.body : undefined;
        return {
          statusCode: 401,
          data: JSON.stringify({ error: { type: "authentication_error" } }),
          responseOptions: { headers: { "content-type": "application/json" } },
        };
      });

    const res = await runFetch(setupRequest(null, validFormBody()));
    expect(res.status).toBe(400);
    const json = await res.json() as { field?: string };
    expect(json.field).toBe("anthropic_api_key");
    expect(await getEnv().STATE.get("config")).toBeNull();

    // Assert the outbound request body shape sent to Anthropic.
    expect(capturedBody).toBeDefined();
    const outbound = JSON.parse(capturedBody as string) as Record<string, unknown>;
    expect(typeof outbound.model).toBe("string");
    expect(typeof outbound.system).toBe("string");
    expect(Array.isArray(outbound.messages)).toBe(true);
    expect(typeof outbound.max_tokens).toBe("number");
  });
});

describe("POST /setup field validation", () => {
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

  it("returns 400 for non-numeric and non-positive daily_budget_usd", async () => {
    mockAnthropicOk();
    for (const badValue of ["not-a-number", "0", "-5"]) {
      const body = validFormBody();
      body.set("daily_budget_usd", badValue);
      const res = await runFetch(setupRequest(null, body));
      expect(res.status).toBe(400);
      const json = await res.json() as { field?: string };
      expect(json.field).toBe("daily_budget_usd");
      expect(await getEnv().STATE.get("config")).toBeNull();
    }
  });

  it("returns 400 for each missing required field", async () => {
    mockAnthropicOk();
    for (const field of ["display_name", "headline", "anthropic_api_key", "cv_markdown", "daily_budget_usd"]) {
      const body = validFormBody();
      body.delete(field);
      const res = await runFetch(setupRequest(null, body));
      expect(res.status).toBe(400);
      const json = await res.json() as { field?: string };
      expect(json.field).toBe(field);
      expect(await getEnv().STATE.get("config")).toBeNull();
    }
  });

  it("returns 400 for admin_password shorter than 12 chars", async () => {
    mockAnthropicOk();
    const body = validFormBody();
    body.set("admin_password", "short");
    const res = await runFetch(setupRequest(null, body));
    expect(res.status).toBe(400);
    const json = await res.json() as { field?: string };
    expect(json.field).toBe("admin_password");
    expect(await getEnv().STATE.get("config")).toBeNull();
  });

  it("returns 400 for admin_password longer than 128 chars", async () => {
    mockAnthropicOk();
    const body = validFormBody();
    body.set("admin_password", "a".repeat(129));
    const res = await runFetch(setupRequest(null, body));
    expect(res.status).toBe(400);
    const json = await res.json() as { field?: string };
    expect(json.field).toBe("admin_password");
    expect(await getEnv().STATE.get("config")).toBeNull();
  });
});
