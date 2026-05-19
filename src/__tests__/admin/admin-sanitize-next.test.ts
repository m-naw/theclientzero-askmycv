/**
 * Admin sanitizeNext consolidation test (SDD-6 Fix C).
 *
 * Previously, admin.ts had a local sanitizeNextParam that diverged from
 * src/lib/redirect.ts sanitizeNext (no URL-decode, required /admin/ prefix).
 * The fix delegates to the shared sanitizeNext helper and then applies the
 * admin-specific /admin-prefix restriction as a separate post-sanitize
 * filter.
 *
 * This test asserts that POST /admin/login's effective sanitization is
 * equivalent to calling sanitizeNext directly and then applying the
 * /admin-prefix filter, so an open-redirect bypass that worked against
 * sanitizeNext would also fail here (and vice versa).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../worker";
import { hashPassword } from "../../auth/password";
import { ADMIN_PASSWORD_HASH_KEY } from "../../types/auth";
import { sanitizeNext } from "../../lib/redirect";

const TEST_PASSWORD = "supersecretpassword";

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
    `ratelimit:login:7.7.7.7`,
  ]) {
    await kv.delete(key);
  }
}

async function seedHashedPassword(): Promise<void> {
  const hash = await hashPassword(TEST_PASSWORD);
  await getEnv().STATE.put(ADMIN_PASSWORD_HASH_KEY, hash);
}

async function runFetch(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as never, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

function adminLoginWithNext(rawNext: string, ip: string): Request {
  return new Request("https://example.test/admin/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "CF-Connecting-IP": ip,
    },
    body: JSON.stringify({ password: TEST_PASSWORD, next: rawNext }),
  });
}

/**
 * Reference implementation: what the admin route should redirect to for a
 * given raw next value. Composes the shared sanitizeNext helper with the
 * admin-specific /admin-prefix post-filter; mirrors the production code.
 */
function expectedAdminRedirect(rawNext: string): string {
  const sanitized = sanitizeNext(rawNext);
  if (sanitized === "/") return "/admin";
  if (sanitized !== "/admin" && !sanitized.startsWith("/admin/")) return "/admin";
  return sanitized;
}

describe("POST /admin/login next= sanitization (SDD-6 Fix C)", () => {
  beforeEach(async () => {
    await clearKv();
    await seedHashedPassword();
  });

  afterEach(async () => {
    await clearKv();
  });

  const cases: Array<{ raw: string; label: string }> = [
    { raw: "/admin/foo", label: "/admin/foo (valid admin path)" },
    { raw: "javascript:alert(1)", label: "javascript: scheme" },
    { raw: "//evil.com", label: "//evil.com protocol-relative" },
    // Encoded protocol-relative: sanitizeNext URL-decodes once → "//evil.com" → "/"
    // The pre-fix admin sanitizer skipped decoding and would have accepted this.
    { raw: "%2F%2Fevil.com", label: "URL-encoded //evil.com" },
    { raw: "/notadmin", label: "/notadmin (outside admin scope)" },
    { raw: "/admin", label: "/admin (exact match)" },
  ];

  for (const { raw, label } of cases) {
    it(`next=${label} → Location equals sanitizeNext + admin-filter result`, async () => {
      const expected = expectedAdminRedirect(raw);

      const res = await runFetch(adminLoginWithNext(raw, "7.7.7.7"));
      expect(res.status).toBe(303);
      expect(res.headers.get("Location")).toBe(expected);

      // Clear rate-limit counter between cases to keep iteration cheap.
      await getEnv().STATE.delete("ratelimit:login:7.7.7.7");
    });
  }
});
