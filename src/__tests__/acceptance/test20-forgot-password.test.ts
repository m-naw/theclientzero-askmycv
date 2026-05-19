/**
 * Acceptance Test 20 — spec §12 / F19:
 * "Admin forgot-password recovery: GET /login (with no session) returns HTTP 200
 *  with HTML containing inline recovery instructions (wrangler + kv tokens)"
 *
 * Notes:
 *   - The forgot-password recovery block lives inside the admin login form view
 *     (renderLoginForm). The login form is served at GET /login.
 *   - "Inline" means the recovery instructions are part of the page body, not a
 *     link to docs/.
 *
 * Steps validated:
 * 1. GET /login with no cookie returns HTTP 200 and content-type text/html.
 * 2. Body contains the forgot-password block.
 * 3. Body contains both "kv" and "wrangler" recovery tokens (case-insensitive).
 * 4. Body does NOT link to a docs/ path (recovery is fully inline).
 *
 * Runs inside @cloudflare/vitest-pool-workers (Miniflare).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../worker";

interface TestEnv {
  STATE: KVNamespace;
}

function getEnv(): TestEnv {
  return env as unknown as TestEnv;
}

async function clearKv(): Promise<void> {
  const kv = getEnv().STATE;
  for (const key of ["config", "admin_password_hash", "cookie_signing_secret"]) {
    await kv.delete(key);
  }
}

async function runFetch(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as never, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("Acceptance Test 20 — admin forgot-password inline recovery (spec §12 / F19)", () => {
  beforeEach(async () => {
    (env as Record<string, string>).ACCESS_JWKS_URL_OVERRIDE = "";
    await clearKv();
  });

  afterEach(async () => {
    await clearKv();
  });

  it("GET /login returns HTTP 200 HTML", async () => {
    const req = new Request("https://example.test/login", { method: "GET" });
    const res = await runFetch(req);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct.toLowerCase()).toContain("text/html");
  });

  it("GET /login HTML contains forgot-password block with both wrangler and kv recovery tokens", async () => {
    const req = new Request("https://example.test/login", { method: "GET" });
    const res = await runFetch(req);
    const body = await res.text();

    // Forgot-password block must be present
    expect(body.toLowerCase()).toContain("forgot password");

    // Inline recovery tokens (case-insensitive)
    expect(body.toLowerCase()).toContain("wrangler");
    expect(body.toLowerCase()).toContain("kv");

    // The admin_password_hash key must be named explicitly
    expect(body).toContain("admin_password_hash");
  });

  it("GET /login HTML recovery is inline, not a link to docs/", async () => {
    const req = new Request("https://example.test/login", { method: "GET" });
    const res = await runFetch(req);
    const body = await res.text();

    // No anchor with href that points to a docs/ path
    expect(body).not.toMatch(/href=["'][^"']*\/docs\//i);
  });
});
