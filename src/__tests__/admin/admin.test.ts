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

function fakeAnthropicSse(): string {
  return [
    `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "m1", usage: { input_tokens: 10, output_tokens: 0 } } })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
  ].join("");
}

async function drainStream(res: Response): Promise<void> {
  const reader = res.body!.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
}

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
    expect(html).not.toContain("anthropicapi_key");
    expect(html).not.toContain("sk-ant");
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
    let capturedReqBody: Record<string, unknown> | null = null;
    fetchMock
      .get(rejectHost)
      .intercept({ path: /\/v1\/messages.*/, method: "POST" })
      .reply((opts: { body?: string }) => {
        try { capturedReqBody = JSON.parse(opts.body ?? "{}"); } catch { /* */ }
        return {
          statusCode: 401,
          data: JSON.stringify({ error: { type: "authentication_error" } }),
          responseOptions: { headers: { "content-type": "application/json" } },
        };
      });

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

    // Verify outgoing Anthropic test-call body shape (spec §9 F5)
    expect(capturedReqBody).not.toBeNull();
    expect(capturedReqBody).toHaveProperty("model");
    expect(capturedReqBody).toHaveProperty("system");
    expect(capturedReqBody).toHaveProperty("messages");
    expect(capturedReqBody).toHaveProperty("max_tokens");
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

describe("Acceptance Test 10: Admin requires matching identity (spec §12 Test 10)", () => {
  const AT10_HOST = "https://anthropic-mock-at10.test";

  beforeEach(async () => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    try { fetchMock.enableNetConnect(/localhost/); } catch { /* */ }
    (env as Record<string, string>).ANTHROPIC_BASE_URL = AT10_HOST;
    (env as Record<string, string>).ACCESS_JWKS_URL_OVERRIDE = "";
    await clearKv();
  });

  afterEach(async () => {
    fetchMock.deactivate();
    await clearKv();
  });

  it("runs all 5 spec §12 acceptance steps in sequence", async () => {
    const kp = await createJwtHarness();
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));
    const cfg = baseConfig({
      access_email: "owner@test",
      access_aud: "test-aud-1",
      access_team_domain: "test.cloudflareaccess.com",
    });
    await seedConfig(cfg);

    // Step 1: no JWT → 403
    const res1 = await runFetch(adminGetRequest(null));
    expect(res1.status).toBe(403);

    // Step 2: wrong email → 403 body contains 'email'
    const jwtWrongEmail = await mintAccessJwt({
      privateKey: kp.privateKey,
      aud: "test-aud-1",
      iss: "https://test.cloudflareaccess.com",
      email: "attacker@test",
    });
    const res2 = await runFetch(adminGetRequest(jwtWrongEmail));
    expect(res2.status).toBe(403);
    expect(await res2.text()).toContain("email");

    // Step 3: wrong aud → 403 body contains 'aud'
    const jwtWrongAud = await mintAccessJwt({
      privateKey: kp.privateKey,
      aud: "different-aud",
      iss: "https://test.cloudflareaccess.com",
      email: "owner@test",
    });
    const res3 = await runFetch(adminGetRequest(jwtWrongAud));
    expect(res3.status).toBe(403);
    expect(await res3.text()).toContain("aud");

    // Step 4: wrong iss → 403
    const jwtWrongIss = await mintAccessJwt({
      privateKey: kp.privateKey,
      aud: "test-aud-1",
      iss: "https://other.cloudflareaccess.com",
      email: "owner@test",
    });
    const res4 = await runFetch(adminGetRequest(jwtWrongIss));
    expect(res4.status).toBe(403);

    // Step 5: fully matching JWT → 200 HTML with pre-filled fields
    const jwtValid = await mintAccessJwt({
      privateKey: kp.privateKey,
      aud: "test-aud-1",
      iss: "https://test.cloudflareaccess.com",
      email: "owner@test",
    });
    const res5 = await runFetch(adminGetRequest(jwtValid));
    expect(res5.status).toBe(200);
    const html5 = await res5.text();
    expect(html5).toContain("input");
    expect(html5).toContain(cfg.display_name);
  });
});

describe("Acceptance Test 11: Admin edit reflects in chat (spec §12 Test 11)", () => {
  const AT11_HOST = "https://anthropic-mock-at11.test";
  const OLD_CV = "# Old CV content\n\n" + "This is the old content from before. ".repeat(6);
  const NEW_CV = "# Brand new role at Acme\n\n" + "Working at Acme Corp on exciting projects. ".repeat(5);

  beforeEach(async () => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    try { fetchMock.enableNetConnect(/localhost/); } catch { /* */ }
    (env as Record<string, string>).ANTHROPIC_BASE_URL = AT11_HOST;
    (env as Record<string, string>).ACCESS_JWKS_URL_OVERRIDE = "";
    await clearKv();
  });

  afterEach(async () => {
    fetchMock.deactivate();
    await clearKv();
  });

  it("runs all 3 spec §12 acceptance steps in sequence", async () => {
    const kp = await createJwtHarness();
    await getEnv().STATE.put(TEST_JWKS_KV_KEY, JSON.stringify(kp.jwksDocument));
    const cfg = baseConfig({ cv_markdown: OLD_CV });
    await seedConfig(cfg);

    // Step 1: POST /admin/save with new cv_markdown → 200
    const jwt = await mintAccessJwt({
      privateKey: kp.privateKey,
      aud: cfg.access_aud,
      iss: `https://${cfg.access_team_domain}`,
      email: cfg.access_email,
    });
    const saveBody = validSaveBody({ cv_markdown: NEW_CV });
    const saveRes = await runFetch(adminSaveRequest(jwt, saveBody));
    expect(saveRes.status).toBe(200);

    // Step 2: Inspect KV — config.cv_markdown is updated
    const storedRaw = await getEnv().STATE.get("config");
    const stored = JSON.parse(storedRaw as string) as StoredConfig;
    expect(stored.cv_markdown).toBe(NEW_CV);

    // Step 3: POST /chat — Anthropic request system field contains new CV, not old
    const captured: { body: Record<string, unknown> | null } = { body: null };
    fetchMock
      .get(AT11_HOST)
      .intercept({ path: /\/v1\/messages.*/, method: "POST" })
      .reply((opts: { body?: string }) => {
        try { captured.body = JSON.parse(opts.body ?? "{}"); } catch { /* */ }
        return {
          statusCode: 200,
          data: fakeAnthropicSse(),
          responseOptions: { headers: { "content-type": "text/event-stream" } },
        };
      });

    const chatRes = await runFetch(new Request("https://example.test/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Mozilla/5.0 (compatible)",
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "Tell me about your current role" }] }),
    }));
    await drainStream(chatRes);

    expect(captured.body).not.toBeNull();
    // system is an array of {type, text} blocks — join text fields for assertion
    const systemBlocks = captured.body?.system as Array<{ type: string; text: string }> | string | undefined;
    const systemText = Array.isArray(systemBlocks)
      ? systemBlocks.map((b) => b.text).join("\n")
      : (systemBlocks ?? "");
    expect(systemText).toContain("Brand new role at Acme");
    expect(systemText).not.toContain("old content from before");
  });
});
