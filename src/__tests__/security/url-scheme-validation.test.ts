/**
 * SDD-4: URL scheme allow-list at input boundary.
 *
 * The public chat-page view renders linkedin_url / github_url / pdf_cv_url
 * into <a href="..."> with only HTML escaping. escapeHtml does NOT block
 * dangerous schemes — `javascript:alert(1)` survives escaping intact and
 * fires on click → stored XSS against any visitor.
 *
 * Defense: reject non-http(s) schemes at POST /setup and POST /admin/save
 * so a dangerous value can never reach KV in the first place.
 *
 * These tests pin the rejection behavior for both routes and confirm the
 * happy-path (https://) regression case still succeeds.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env, createExecutionContext, fetchMock, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../worker";
import { hashPassword } from "../../auth/password";
import { TEST_JWKS_KV_KEY } from "../../routes/jwks-source";
import { ADMIN_PASSWORD_HASH_KEY } from "../../types/auth";
import { SESSION_COOKIE_NAME } from "../../auth/session";
import { SETUP_RATE_LIMIT_PREFIX } from "../../abuse/rate-limit";
import type { StoredConfig } from "../../types/config";

const ANTHROPIC_HOST = "https://anthropic-mock-sdd4.test";
const ADMIN_PASSWORD = "correcthorsebatterystaple";
const SUCCESS_IP = "9.9.9.4";

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
    `${SETUP_RATE_LIMIT_PREFIX}unknown`,
    `ratelimit:login:${SUCCESS_IP}`,
    `ratelimit:login:unknown`,
  ]) {
    await kv.delete(key);
  }
}

async function seedSetupWindow(): Promise<void> {
  await getEnv().STATE.put("setup_window_start", String(Date.now()));
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

function makeSetupBody(overrides: Record<string, string> = {}): URLSearchParams {
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
  for (const [k, v] of Object.entries(overrides)) body.set(k, v);
  return body;
}

function postSetup(body: URLSearchParams): Request {
  return new Request("https://example.test/setup", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

// ---------------------------------------------------------------------------
// POST /setup
// ---------------------------------------------------------------------------

describe("SDD-4: POST /setup URL scheme allow-list", () => {
  beforeEach(async () => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    try { fetchMock.enableNetConnect(/localhost/); } catch { /* not all versions */ }

    (env as Record<string, string>).ANTHROPIC_BASE_URL = ANTHROPIC_HOST;
    (env as Record<string, string>).ACCESS_JWKS_URL_OVERRIDE = "";
    await clearKv();
    await seedSetupWindow();
  });

  afterEach(async () => {
    fetchMock.deactivate();
    await clearKv();
  });

  it("rejects javascript: scheme on linkedin_url (400, no config written)", async () => {
    mockAnthropicOk();
    const res = await runFetch(
      postSetup(makeSetupBody({ linkedin_url: "javascript:alert(document.cookie)" })),
    );
    expect(res.status).toBe(400);
    expect(await getEnv().STATE.get("config")).toBeNull();
    expect(await getEnv().STATE.get(ADMIN_PASSWORD_HASH_KEY)).toBeNull();
    const html = await res.text();
    // Response is the re-rendered setup form (sticky input echoes the
    // submitted value HTML-escaped inside value="..."). The dangerous
    // string must NEVER appear inside an href= attribute.
    expect(html).toContain('name="cv_markdown"');
    expect(html).not.toMatch(/href="[^"]*javascript:/i);
  });

  it("rejects data: scheme on github_url (400, no config written)", async () => {
    mockAnthropicOk();
    const res = await runFetch(
      postSetup(makeSetupBody({ github_url: "data:text/html,<script>alert(1)</script>" })),
    );
    expect(res.status).toBe(400);
    expect(await getEnv().STATE.get("config")).toBeNull();
    const html = await res.text();
    expect(html).toContain('name="cv_markdown"');
    // <script> tag must NOT appear unescaped in the response
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("rejects protocol-relative // on pdf_cv_url (400, no config written)", async () => {
    mockAnthropicOk();
    const res = await runFetch(
      postSetup(makeSetupBody({ pdf_cv_url: "//evil.com/cv.pdf" })),
    );
    expect(res.status).toBe(400);
    expect(await getEnv().STATE.get("config")).toBeNull();
  });

  it("rejects vbscript: scheme on linkedin_url", async () => {
    mockAnthropicOk();
    const res = await runFetch(
      postSetup(makeSetupBody({ linkedin_url: "vbscript:msgbox(1)" })),
    );
    expect(res.status).toBe(400);
    expect(await getEnv().STATE.get("config")).toBeNull();
  });

  it("rejects leading-whitespace scheme bypass", async () => {
    mockAnthropicOk();
    const res = await runFetch(
      postSetup(makeSetupBody({ linkedin_url: "  javascript:alert(1)" })),
    );
    expect(res.status).toBe(400);
    expect(await getEnv().STATE.get("config")).toBeNull();
  });

  it("rejects newline-embedded scheme bypass on linkedin_url", async () => {
    mockAnthropicOk();
    const res = await runFetch(
      postSetup(makeSetupBody({ linkedin_url: "https://example.com\njavascript:alert(1)" })),
    );
    expect(res.status).toBe(400);
    expect(await getEnv().STATE.get("config")).toBeNull();
    const html = await res.text();
    expect(html).not.toMatch(/href="[^"]*javascript:/i);
  });

  it("rejects tab-embedded scheme bypass on linkedin_url", async () => {
    mockAnthropicOk();
    const res = await runFetch(
      postSetup(makeSetupBody({ linkedin_url: "https://example.com\tjavascript:alert(1)" })),
    );
    expect(res.status).toBe(400);
    expect(await getEnv().STATE.get("config")).toBeNull();
  });

  it("accepts https:// linkedin_url (regression guard)", async () => {
    mockAnthropicOk();
    const res = await runFetch(
      postSetup(makeSetupBody({ linkedin_url: "https://linkedin.com/in/jane" })),
    );
    expect(res.status).toBe(303);
    const raw = await getEnv().STATE.get("config");
    expect(raw).not.toBeNull();
    const cfg = JSON.parse(raw as string) as StoredConfig;
    // setup handler does not currently persist linkedin_url to StoredConfig,
    // but the request must complete successfully — the URL having passed
    // validation is what we are guarding against regression.
    expect(cfg.display_name).toBe("Jane Doe");
  });

  it("accepts empty linkedin_url (empty allowed, regression guard)", async () => {
    mockAnthropicOk();
    const res = await runFetch(
      postSetup(makeSetupBody({ linkedin_url: "" })),
    );
    expect(res.status).toBe(303);
    expect(await getEnv().STATE.get("config")).not.toBeNull();
  });

  it("accepts http:// github_url (regression guard)", async () => {
    mockAnthropicOk();
    const res = await runFetch(
      postSetup(makeSetupBody({ github_url: "http://github.com/jane" })),
    );
    expect(res.status).toBe(303);
  });
});

// ---------------------------------------------------------------------------
// POST /admin/save
// ---------------------------------------------------------------------------

async function seedAdminSession(): Promise<string> {
  // Seed admin password hash and a stored config so /admin/save reaches the
  // URL-validation block.
  const hash = await hashPassword(ADMIN_PASSWORD);
  await getEnv().STATE.put(ADMIN_PASSWORD_HASH_KEY, hash);
  await getEnv().STATE.put(
    "config",
    JSON.stringify({
      display_name: "Existing",
      headline: "Existing headline",
      cv_markdown: "x".repeat(200),
      anthropic_api_key: "sk-ant-test-key",
      daily_budget_usd: 5,
      setup_timestamp: Date.now(),
      model: "claude-haiku-4-5-20251001",
    } satisfies StoredConfig),
  );

  // Login to get a valid session cookie
  const loginRes = await runFetch(
    new Request("https://example.test/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json", "CF-Connecting-IP": SUCCESS_IP },
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    }),
  );
  if (loginRes.status !== 303) {
    throw new Error(`login failed: ${loginRes.status}`);
  }
  const setCookie = loginRes.headers.get("Set-Cookie") ?? "";
  const match = setCookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  if (!match) throw new Error("no session cookie issued");
  return match[1];
}

function makeAdminSaveBody(overrides: Record<string, string> = {}): URLSearchParams {
  const body = new URLSearchParams();
  body.set("display_name", "Jane Doe");
  body.set("headline", "Senior backend engineer");
  body.set("cv_markdown", "x".repeat(200));
  body.set("daily_budget_usd", "5");
  for (const [k, v] of Object.entries(overrides)) body.set(k, v);
  return body;
}

function postAdminSave(body: URLSearchParams, cookie: string): Request {
  return new Request("https://example.test/admin/save", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${SESSION_COOKIE_NAME}=${cookie}`,
    },
    body: body.toString(),
  });
}

describe("SDD-4: POST /admin/save URL scheme allow-list", () => {
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

  it("rejects javascript: scheme on linkedin_url (400, config unchanged)", async () => {
    const cookie = await seedAdminSession();
    const before = await getEnv().STATE.get("config");

    const res = await runFetch(
      postAdminSave(
        makeAdminSaveBody({ linkedin_url: "javascript:alert(1)" }),
        cookie,
      ),
    );
    expect(res.status).toBe(400);
    const after = await getEnv().STATE.get("config");
    expect(after).toBe(before);
    const cfg = JSON.parse(after as string) as StoredConfig;
    expect(cfg.linkedin_url).toBeUndefined();
    const html = await res.text();
    // Sticky input may echo the value HTML-escaped inside value="..." — that
    // is safe. What must NEVER appear is the value inside an href= attribute.
    expect(html).not.toMatch(/href="[^"]*javascript:/i);
  });

  it("rejects data: scheme on github_url (400, config unchanged)", async () => {
    const cookie = await seedAdminSession();
    const before = await getEnv().STATE.get("config");

    const res = await runFetch(
      postAdminSave(
        makeAdminSaveBody({ github_url: "data:text/html,<script>x</script>" }),
        cookie,
      ),
    );
    expect(res.status).toBe(400);
    expect(await getEnv().STATE.get("config")).toBe(before);
  });

  it("rejects protocol-relative // on pdf_cv_url (400, config unchanged)", async () => {
    const cookie = await seedAdminSession();
    const before = await getEnv().STATE.get("config");

    const res = await runFetch(
      postAdminSave(
        makeAdminSaveBody({ pdf_cv_url: "//evil.com/cv.pdf" }),
        cookie,
      ),
    );
    expect(res.status).toBe(400);
    expect(await getEnv().STATE.get("config")).toBe(before);
  });

  it("accepts https:// URLs on all three fields (regression guard)", async () => {
    const cookie = await seedAdminSession();
    const res = await runFetch(
      postAdminSave(
        makeAdminSaveBody({
          linkedin_url: "https://linkedin.com/in/jane",
          github_url: "https://github.com/jane",
          pdf_cv_url: "https://example.test/cv.pdf",
        }),
        cookie,
      ),
    );
    expect(res.status).toBe(200);
    const raw = await getEnv().STATE.get("config");
    const cfg = JSON.parse(raw as string) as StoredConfig;
    expect(cfg.linkedin_url).toBe("https://linkedin.com/in/jane");
    expect(cfg.github_url).toBe("https://github.com/jane");
    expect(cfg.pdf_cv_url).toBe("https://example.test/cv.pdf");
  });

  it("accepts empty URLs (empty allowed, regression guard)", async () => {
    const cookie = await seedAdminSession();
    const res = await runFetch(
      postAdminSave(makeAdminSaveBody(), cookie),
    );
    expect(res.status).toBe(200);
  });
});
