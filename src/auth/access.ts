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
import { verifySessionCookie } from "./session";
import { resolveJwksSource } from "../routes/jwks-source";
import type { StoredConfig } from "../types/config";
import type { Env } from "../env";

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

// ---------------------------------------------------------------------------
// Dual-layer admin auth helper
// ---------------------------------------------------------------------------

/**
 * Verify the admin session cookie, and optionally also verify a CF Access JWT
 * when config.access_email is set.
 *
 * Returns null when the request is authorized.
 * Returns a Response (401 or 403) when authorization fails.
 */
export async function requireAdminAuth(
  request: Request,
  env: Env,
  config: StoredConfig | null,
): Promise<Response | null> {
  // Layer 1: session cookie
  const session = await verifySessionCookie(request, env.STATE);
  if (session === null) {
    const url = new URL(request.url);
    // Avoid redirect loops: if already on /login, don't append next.
    if (url.pathname === "/login") {
      return new Response(null, {
        status: 303,
        headers: { Location: "/login" },
      });
    }
    const next = encodeURIComponent(url.pathname + url.search);
    return new Response(null, {
      status: 303,
      headers: { Location: `/login?next=${next}` },
    });
  }

  // Layer 2: optional CF Access JWT when access_email is configured
  if (config?.access_email && config.access_email.length > 0) {
    const jwt = request.headers.get("cf-access-jwt-assertion") ?? "";
    if (jwt.length === 0) {
      return new Response("Access JWT invalid: missing token", { status: 403 });
    }
    try {
      const jwksSource = await resolveJwksSource(env);
      const identity = await verifyAccessJwt(jwt, {
        ...jwksSource,
        audience: config.access_aud,
      });
      // Verify team domain matches config
      if (
        config.access_team_domain &&
        config.access_team_domain.length > 0 &&
        identity.team_domain !== config.access_team_domain
      ) {
        return new Response("Access JWT invalid: team_domain_mismatch", { status: 403 });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      return new Response(`Access JWT invalid: ${msg}`, { status: 403 });
    }
  }

  return null;
}
