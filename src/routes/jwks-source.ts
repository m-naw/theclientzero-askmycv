/**
 * Resolves which JWKS source the auth path should consult on this request.
 *
 *   - Tests can pre-write a JWKS document to KV under the reserved key
 *     `__test_jwks` so signature verification stays fully in-process
 *     (no live network call to a fake URL). The production code path
 *     never writes this key, so its presence is a test-harness signal.
 *   - Otherwise, the JWKS is fetched from env.ACCESS_JWKS_URL_OVERRIDE
 *     when set, or from the production CF Access URL.
 *
 * This file isolates the precedence rule so route handlers stay focused
 * on their own concerns.
 */

import type { JwksDocument } from "../auth/jwt";
import type { Env } from "../env";

export interface JwksSource {
  jwksOverride?: JwksDocument;
  jwksUrl?: string;
}

export const TEST_JWKS_KV_KEY = "__test_jwks";

export async function resolveJwksSource(env: Env): Promise<JwksSource> {
  const raw = await env.STATE.get(TEST_JWKS_KV_KEY);
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as JwksDocument;
      return { jwksOverride: parsed };
    } catch {
      // Fall through; remote source is the safe default.
    }
  }

  // "auto", empty, or whitespace-only ⇒ no override; the JWT verifier
  // derives the JWKS URL from the token's iss claim. Any other value is
  // used verbatim as a direct JWKS URL.
  const rawOverride = env.ACCESS_JWKS_URL_OVERRIDE ?? "";
  const trimmed = rawOverride.trim();
  const url = trimmed.length === 0 || trimmed === "auto" ? "auto" : rawOverride;

  return { jwksUrl: url };
}
