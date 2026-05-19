/**
 * Integration test: POST /login no-hash branch timing parity (SDD-6 Fix B).
 *
 * Before the fix, the wrong-password branch awaited a 500ms timing delay
 * while the "no admin password configured" branch returned 401 immediately.
 * A remote attacker could distinguish the two by response timing, confirming
 * a fresh-deploy window during which setup may still be possible.
 *
 * After the fix, both branches share the same LOGIN_FAIL_DELAY_MS delay.
 * We assert the no-hash response takes ≥400ms (matching the existing
 * wrong-password assertion in admin.test.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../worker";
import { ADMIN_PASSWORD_HASH_KEY } from "../../types/auth";

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
    ADMIN_PASSWORD_HASH_KEY,
    "cookie_signing_secret",
    "ratelimit:login:198.51.100.7",
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

describe("POST /login — no-hash branch timing parity (SDD-6 Fix B)", () => {
  beforeEach(async () => {
    await clearKv();
    // Ensure no admin_password_hash key exists.
    await getEnv().STATE.delete(ADMIN_PASSWORD_HASH_KEY);
  });

  afterEach(async () => {
    await clearKv();
  });

  it("returns 401 with ≥400ms delay when no admin_password_hash is configured", async () => {
    const body = new URLSearchParams();
    body.set("admin_password", "anything");

    const start = Date.now();
    const res = await runFetch(
      new Request("https://example.test/login", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "CF-Connecting-IP": "198.51.100.7",
        },
        body: body.toString(),
      }),
    );
    const elapsed = Date.now() - start;

    expect(res.status).toBe(401);
    // Match the wrong-password branch's ≥400ms timing assertion.
    expect(elapsed).toBeGreaterThanOrEqual(400);
  }, 10_000);
});
