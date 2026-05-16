/**
 * Cloudflare Access JWT verification adapter for the Worker fetch path.
 *
 * Wraps the low-level verify() in src/auth/jwt.ts and surfaces the three
 * claim values the state machine and admin gate care about
 * (email, aud, team_domain). Production code fetches the JWKS from the
 * configured remote URL; tests inject a JwksDocument via
 * env.__JWKS_OVERRIDE (read by the caller and forwarded here as an
 * explicit parameter) so no globalThis monkey-patching is required.
 *
 * The Anthropic API key is never read here. This module is auth-only.
 */

import {
  verify,
  InvalidTokenError,
  ExpiredTokenError,
  type JwksDocument,
  type VerifiedPayload,
} from "./jwt";

export interface VerifiedAccessIdentity {
  email: string;
  aud: string;
  team_domain: string;
  raw: VerifiedPayload;
}

export interface VerifyAccessOptions {
  /** Expected audience. When supplied, mismatches throw InvalidTokenError. */
  audience?: string;
  /** Test-only in-memory JWKS. Takes precedence over jwksUrl. */
  jwksOverride?: JwksDocument;
  /** Remote JWKS URL. Used when jwksOverride is not supplied. */
  jwksUrl?: string;
}

/**
 * Verify a CF Access JWT and return the identity triple. Throws
 * InvalidTokenError / ExpiredTokenError on any failure (signature, issuer,
 * audience, expiration, missing email claim, malformed issuer).
 */
export async function verifyAccessJwt(
  token: string,
  opts: VerifyAccessOptions = {},
): Promise<VerifiedAccessIdentity> {
  const payload = await verify(token, {
    audience: opts.audience,
    jwksOverride: opts.jwksOverride,
    jwksUrl: opts.jwksUrl,
  });

  if (!payload.email || typeof payload.email !== "string") {
    throw new InvalidTokenError("token is missing email claim");
  }
  // Cloudflare Access emits `aud` as an array with a single element (the
  // Application Audience tag), but the JWT RFC permits string or string[].
  // Normalize to the first string element for downstream comparison.
  let aud: string;
  if (typeof payload.aud === "string" && payload.aud.length > 0) {
    aud = payload.aud;
  } else if (
    Array.isArray(payload.aud) &&
    payload.aud.length > 0 &&
    typeof payload.aud[0] === "string" &&
    payload.aud[0].length > 0
  ) {
    aud = payload.aud[0];
  } else {
    throw new InvalidTokenError("token is missing aud claim");
  }
  if (typeof payload.iss !== "string") {
    throw new InvalidTokenError("token is missing iss claim");
  }

  // iss has the form "https://<team>.cloudflareaccess.com"; team_domain is the host.
  let team_domain: string;
  try {
    team_domain = new URL(payload.iss).host;
  } catch {
    throw new InvalidTokenError(`token has unparseable iss: ${payload.iss}`);
  }

  return {
    email: payload.email,
    aud,
    team_domain,
    raw: payload,
  };
}

export { InvalidTokenError, ExpiredTokenError };
