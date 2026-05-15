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
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env, createExecutionContext, fetchMock, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../worker";
import { createJwtHarness, mintAccessJwt } from "../../test-utils/jwt-harness";
import { SETUP_WINDOW_MS } from "../../state/machine";
import { TEST_JWKS_KV_KEY } from "../../routes/jwks-source";
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
  for (const key of ["config", "setup_window_start", TEST_JWKS_KV_KEY]) {
    await kv.delete(key);
  }
}

function validFormBody(): URLSearchParams {
  const body = new URLSearchParams();
  body.set("display_name", "Jane Doe");
  body.set("page_title", "Jane Doe — CV chat");
  body.set("about_blurb", "Senior backend engineer.");
  body.set("chat_path", "/");
  body.set("anthropic_api_key", "sk-ant-test-key");
  body.set("daily_budget_usd", "5");
  // 250+ chars to satisfy MIN
  body.set(
    "cv_markdown",
    "# Jane Doe\n\n## Experience\n" +
      "Lots of experience working on backend systems across multiple companies and roles. ".repeat(5),
  );
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
  // Test 1: Cold-start state machine
  // ---------------------------------------------------------------------
  it("Test 1: cold-start GET / serves instructions, records setup_window_start, POST /setup without JWT is 403", async () => {
    // (1) GET /
    const getRes = await runFetch(rootRequest());
    expect(getRes.status).toBe(200);
    const html = await getRes.text();
    expect(html).toContain("Cloudflare Access");
    expect(html).toContain("/setup");
    expect(html).toContain("/admin");

    // (2) setup_window_start now set
    const stored = await getEnv().STATE.get("setup_window_start");
    expect(stored).not.toBeNull();
    const ts = Number(stored);
    expect(Number.isFinite(ts)).toBe(true);
    expect(Math.abs(Date.now() - ts)).toBeLessThan(60_000);

    // (3) POST /setup with valid body but no JWT
    const postRes = await runFetch(setupRequest(null, validFormBody()));
    expect(postRes.status).toBe(403);

    // (4) config still absent
    expect(await getEnv().STATE.get("config")).toBeNull();
  });

  // ---------------------------------------------------------------------
  // Test 2: Setup with valid JWT
  // ---------------------------------------------------------------------
  it("Test 2: GET / + POST /setup with valid JWT persists config and returns success HTML", async () => {
    const kp = await createJwtHarness();
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));

    const jwt = await mintAccessJwt({
      privateKey: kp.privateKey,
      aud: "test-aud-1",
      iss: "https://test.cloudflareaccess.com",
      email: "owner@test",
    });

    // (1) GET / with JWT — expect setup form (B_SETUP_FORM)
    const getRes = await runFetch(rootRequest(jwt));
    expect(getRes.status).toBe(200);
    const html = await getRes.text();
    expect(html).toContain('name="cv_markdown"');

    // (2) Pre-configure Anthropic mock → 200
    mockAnthropicOk();

    // (3) POST /setup with JWT and valid body
    const postRes = await runFetch(setupRequest(jwt, validFormBody()));
    expect(postRes.status).toBe(200);
    const successHtml = await postRes.text();
    expect(successHtml).toContain("https://example.test/");
    expect(successHtml).toContain("/admin");
    // The Anthropic key must never appear in the response body.
    expect(successHtml).not.toContain("sk-ant-test-key");

    // (4) config persisted with identity captured from JWT
    const stored = await getEnv().STATE.get("config");
    expect(stored).not.toBeNull();
    const cfg = JSON.parse(stored as string) as StoredConfig;
    expect(cfg.access_email).toBe("owner@test");
    expect(cfg.access_aud).toBe("test-aud-1");
    expect(cfg.access_team_domain).toBe("test.cloudflareaccess.com");
    // (5) Anthropic key is persisted on the config record (KV-only).
    expect(cfg.anthropic_api_key).toBe("sk-ant-test-key");
  });

  // ---------------------------------------------------------------------
  // Test 3: Setup blocked after configuration
  // ---------------------------------------------------------------------
  it("Test 3: POST /setup after config already present returns 403, config unchanged", async () => {
    const kp = await createJwtHarness();
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));

    const existing: StoredConfig = {
      display_name: "Existing",
      page_title: "Existing",
      cv_markdown: "x".repeat(300),
      about_blurb: "Blurb",
      chat_path: "/",
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
  it("Test 5: expired window renders expired page; POST /setup is 403; deletion recovers", async () => {
    const kp = await createJwtHarness();
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));

    // Pre-set setup_window_start to 31 minutes ago.
    const oldStart = Date.now() - (SETUP_WINDOW_MS + 60_000);
    await getEnv().STATE.put("setup_window_start", String(oldStart));

    // (1) GET / with no JWT → expired page
    const expiredHtml = await (await runFetch(rootRequest())).text();
    expect(expiredHtml).toContain("setup_window_start");
    expect(expiredHtml.toLowerCase()).toContain("expired");

    // (2) POST /setup with valid JWT and body → 403
    mockAnthropicOk();
    const jwt = await mintAccessJwt({
      privateKey: kp.privateKey,
      aud: "test-aud-1",
      iss: "https://test.cloudflareaccess.com",
      email: "owner@test",
    });
    const r = await runFetch(setupRequest(jwt, validFormBody()));
    expect(r.status).toBe(403);

    // (3) Delete setup_window_start
    await getEnv().STATE.delete("setup_window_start");

    // (4) GET / with no JWT → setup instructions (not expired page)
    const recoveryHtml = await (await runFetch(rootRequest())).text();
    expect(recoveryHtml).toContain("Cloudflare Access");
    expect(recoveryHtml.toLowerCase()).not.toContain("setup window expired");

    // (5) GET / with valid JWT → setup form
    const formHtml = await (await runFetch(rootRequest(jwt))).text();
    expect(formHtml).toContain('name="cv_markdown"');
  });
});
