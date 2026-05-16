/**
 * Owner identity verification for admin routes.
 *
 * verifyOwnerIdentity() cryptographically validates the Cloudflare Access JWT
 * and then checks the resulting identity against the stored owner config.
 * Returns a discriminated union so callers can render the correct denial
 * reason without inspecting raw error types.
 *
 * This module is auth-only. The Anthropic API key is never read here.
 */

import { verifyAccessJwt, type VerifiedAccessIdentity } from "./access";
import { readAccessJwt } from "./access-token";
import type { JwksDocument } from "./jwt";
import type { StoredConfig } from "../types/config";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type DenialReason =
  | "no_jwt"
  | "signature_invalid"
  | "team_domain_mismatch"
  | "aud_mismatch"
  | "email_mismatch";

export interface OwnerIdentityGranted {
  ok: true;
  identity: VerifiedAccessIdentity;
}

export interface OwnerIdentityDenied {
  ok: false;
  reason: DenialReason;
}

export type OwnerIdentityResult = OwnerIdentityGranted | OwnerIdentityDenied;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface VerifyOwnerIdentityOptions {
  /** In-memory JWKS override for tests. Takes precedence over jwksUrl. */
  jwksOverride?: JwksDocument;
  /** Remote JWKS URL. Used when jwksOverride is not supplied. */
  jwksUrl?: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Verify the CF Access JWT from the request headers, then cross-check the
 * resulting identity against the stored owner config.
 *
 * Returns OwnerIdentityGranted when all checks pass, or OwnerIdentityDenied
 * with a specific reason when any check fails. Never throws.
 */
export async function verifyOwnerIdentity(
  request: Request,
  config: StoredConfig,
  opts: VerifyOwnerIdentityOptions,
): Promise<OwnerIdentityResult> {
  // --- 1. JWT presence (header or CF_Authorization cookie fallback) ---
  const token = readAccessJwt(request);
  if (token.length === 0) {
    return { ok: false, reason: "no_jwt" };
  }

  // --- 2. Cryptographic verification (signature, issuer pattern, expiry) ---
  let identity: VerifiedAccessIdentity;
  try {
    identity = await verifyAccessJwt(token, {
      jwksOverride: opts.jwksOverride,
      jwksUrl: opts.jwksUrl,
    });
  } catch {
    return { ok: false, reason: "signature_invalid" };
  }

  // --- 3. Team domain check ---
  if (identity.team_domain !== config.access_team_domain) {
    return { ok: false, reason: "team_domain_mismatch" };
  }

  // --- 4. Audience check ---
  if (identity.aud !== config.access_aud) {
    return { ok: false, reason: "aud_mismatch" };
  }

  // --- 5. Email check ---
  if (identity.email !== config.access_email) {
    return { ok: false, reason: "email_mismatch" };
  }

  return { ok: true, identity };
}
