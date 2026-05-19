/**
 * Acceptance Test — spec §12:
 * "GET /admin with empty KV returns HTTP 404 and does not leak admin UI markers"
 *
 * Steps validated:
 * 1. With no config in KV, GET /admin returns HTTP 404.
 * 2. Response body does NOT contain admin UI markers (form fields, CV editor,
 *    Anthropic API key input, save button labels).
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
  for (const key of [
    "config",
    "admin_password_hash",
    "cookie_signing_secret",
    "setup_window_start",
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

describe("Acceptance — GET /admin unconfigured returns 404 (spec §12)", () => {
  beforeEach(async () => {
    (env as Record<string, string>).ACCESS_JWKS_URL_OVERRIDE = "";
    await clearKv();
  });

  afterEach(async () => {
    await clearKv();
  });

  it("GET /admin returns 404 when unconfigured (empty KV)", async () => {
    const req = new Request("https://example.test/admin", { method: "GET" });
    const res = await runFetch(req);
    expect(res.status).toBe(404);
  });

  it("GET /admin with empty KV does not leak admin UI markers in body", async () => {
    const req = new Request("https://example.test/admin", { method: "GET" });
    const res = await runFetch(req);
    const body = await res.text();

    const adminMarkers = [
      "anthropic_api_key",
      "cv_markdown",
      "daily_budget_usd",
      'name="display_name"',
      'name="headline"',
      "Save configuration",
      "Admin configuration",
      "/admin/save",
    ];

    for (const marker of adminMarkers) {
      expect(body).not.toContain(marker);
    }
  });
});
