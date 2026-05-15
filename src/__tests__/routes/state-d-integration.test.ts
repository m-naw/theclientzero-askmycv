/**
 * Integration tests for state D (setup window expired) through the HTTP layer.
 *
 * Proves that:
 * 1. When setup_window_start is >30 min old, GET / renders the expired-setup page.
 * 2. Deleting the KV key recovers the Worker to a usable state on the next request.
 * 3. The Anthropic API key never appears in either response body.
 *
 * Runs inside @cloudflare/vitest-pool-workers (Miniflare) so KV behaves as on
 * production Workers.
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
  for (const key of ["config", "setup_window_start"]) {
    await kv.delete(key);
  }
}

function rootRequest(): Request {
  return new Request("https://example.test/", { method: "GET" });
}

async function runFetch(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as never, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("GET / in state D (setup window expired)", () => {
  beforeEach(async () => {
    (env as Record<string, string>).ACCESS_JWKS_URL_OVERRIDE = "";
    await clearKv();
  });

  afterEach(async () => {
    await clearKv();
  });

  it("renders the expired-setup page when setup_window_start is older than 30 minutes", async () => {
    // Seed KV: timestamp 31 minutes in the past triggers state D
    const thirtyOneMinutesAgo = Date.now() - 31 * 60 * 1000;
    await getEnv().STATE.put("setup_window_start", String(thirtyOneMinutesAgo));

    const res = await runFetch(rootRequest());

    expect(res.status).toBe(200);
    const html = await res.text();

    // Verify the expired-setup page is rendered (exact strings from renderExpiredSetup)
    expect(html).toContain("Setup window expired");
    expect(html).toContain("setup_window_start");
    expect(html).toContain("Cloudflare");
    expect(html).toContain("Delete");

    // The Anthropic API key must never appear in the response (hard constraint)
    expect(html).not.toContain("anthropic_api_key");
  });

  it("recovers to a usable state after the setup_window_start KV key is deleted", async () => {
    // Seed expired state
    const thirtyOneMinutesAgo = Date.now() - 31 * 60 * 1000;
    await getEnv().STATE.put("setup_window_start", String(thirtyOneMinutesAgo));

    // First request: confirm state D is active
    const expiredRes = await runFetch(rootRequest());
    expect(expiredRes.status).toBe(200);
    const expiredHtml = await expiredRes.text();
    expect(expiredHtml).toContain("Setup window expired");

    // Recovery: delete the KV key (as instructed by the recovery guide)
    await getEnv().STATE.delete("setup_window_start");

    // Second request: Worker must NOT render the expired page
    const recoveredRes = await runFetch(rootRequest());
    expect(recoveredRes.status).toBe(200);
    const recoveredHtml = await recoveredRes.text();
    expect(recoveredHtml).not.toContain("Setup window expired");

    // The Anthropic API key must never appear in either response
    expect(recoveredHtml).not.toContain("anthropic_api_key");
  });
});
