/**
 * JWT authentication helpers for Cloudflare Access JWTs.
 *
 * verify() validates a CF Access JWT against JWKS.
 * sign()   mints a new JWT (used for internal / refresh tokens).
 * refresh() verifies an expiring token within a grace window then re-signs.
 *
 * Tests inject keys via opts.jwksOverride; production uses a remote JWKS URL.
 * No secrets are embedded here — callers supply keying material explicitly.
 */

import {
  createRemoteJWKSet,
  decodeJwt,
  exportJWK,
  generateKeyPair,
  importJWK,
  jwtVerify,
  SignJWT,
  type JWK,
  type JWTPayload,
  type KeyLike,
} from "jose";

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/** Thrown when the token's signature is invalid, the issuer is wrong, or the
 *  token is structurally malformed. */
export class InvalidTokenError extends Error {
  override readonly name: string = "InvalidTokenError";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

/** Thrown when the token has expired (and the caller did not opt into a grace
 *  window). Extends InvalidTokenError so callers that only catch the base
 *  class still handle expiry. */
export class ExpiredTokenError extends InvalidTokenError {
  override readonly name: string = "ExpiredTokenError";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

// ---------------------------------------------------------------------------
// Public option shapes
// ---------------------------------------------------------------------------

/** A minimal in-memory JWKS document (for test injection). */
export interface JwksDocument {
  keys: JWK[];
}

export interface VerifyOptions {
  /** Expected audience claim. If omitted, audience is not checked. */
  audience?: string;
  /**
   * Test-only: supply a JwksDocument directly instead of fetching from a
   * remote URL.  The remote URL is NEVER consulted when this is present.
   */
  jwksOverride?: JwksDocument;
  /** Remote JWKS URL used when jwksOverride is absent. */
  jwksUrl?: string;
}

export interface SignOptions {
  /** Private key (KeyLike) used to sign the JWT. */
  privateKey: KeyLike | Uint8Array;
  /** Algorithm. Defaults to "ES256". */
  alg?: string;
  /** Expiry as a jose duration string (e.g. "1h", "30m") or seconds.
   *  Defaults to "1h". */
  expiresIn?: string | number;
}

export interface RefreshOptions extends SignOptions {
  /** How many seconds past exp we still allow a refresh. Defaults to 300. */
  gracePeriodSec?: number;
  /** Verification options for the current (possibly expired) token. */
  verify?: VerifyOptions;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pattern required for the issuer claim. */
const CLOUDFLARE_ISS_PATTERN = /^https:\/\/[^/]+\.cloudflareaccess\.com$/;

/**
 * Resolve a JWKS URL when the configured value is the "auto" sentinel
 * (or empty/whitespace, for defense in depth). In that case the URL is
 * derived from the unverified token's iss claim as
 * `${iss}/cdn-cgi/access/certs`. The iss is validated against the
 * Cloudflare Access pattern before use so an attacker-controlled token
 * cannot redirect JWKS fetches to an arbitrary host.
 */
function resolveJwksUrl(token: string, jwksUrl: string | undefined): string {
  const trimmed = (jwksUrl ?? "").trim();
  if (trimmed.length > 0 && trimmed !== "auto") {
    return jwksUrl as string;
  }

  let iss: unknown;
  try {
    iss = decodeJwt(token).iss;
  } catch (err) {
    throw new InvalidTokenError("token is not a decodable JWT", { cause: err });
  }
  if (typeof iss !== "string") {
    throw new InvalidTokenError("token is missing iss claim");
  }
  assertIssuer(iss);
  return `${iss}/cdn-cgi/access/certs`;
}

/** Build a jose key input from either an override or a remote URL. */
async function buildKeyInput(
  token: string,
  opts: VerifyOptions,
): Promise<Parameters<typeof jwtVerify>[1]> {
  if (opts.jwksOverride) {
    // Test-only: resolve the first matching key from the in-memory set.
    // We return a function compatible with the jose GetKeyFunction signature.
    const { keys } = opts.jwksOverride;
    return async (_header) => {
      // Find a key matching the kid in the header (or fall back to first key).
      const kid = _header.kid;
      const jwk = kid ? (keys.find((k) => k.kid === kid) ?? keys[0]) : keys[0];
      if (!jwk) throw new InvalidTokenError("no key found in jwksOverride");
      return importJWK(jwk) as Promise<KeyLike>;
    };
  }

  if (opts.jwksUrl === undefined) {
    throw new InvalidTokenError("either jwksOverride or jwksUrl must be provided");
  }

  const url = resolveJwksUrl(token, opts.jwksUrl);
  return createRemoteJWKSet(new URL(url));
}

/** Validate that the issuer matches the Cloudflare Access pattern. */
function assertIssuer(iss: string | undefined): void {
  if (!iss || !CLOUDFLARE_ISS_PATTERN.test(iss)) {
    throw new InvalidTokenError(
      `issuer "${iss ?? ""}" does not match *.cloudflareaccess.com`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Verified payload shape (superset of JWTPayload). */
export interface VerifiedPayload extends JWTPayload {
  email?: string;
}

/**
 * Verify a Cloudflare Access JWT.
 *
 * Throws InvalidTokenError for bad signatures / wrong issuer.
 * Throws ExpiredTokenError for an elapsed exp claim.
 */
export async function verify(
  token: string,
  opts: VerifyOptions,
): Promise<VerifiedPayload> {
  const keyInput = await buildKeyInput(token, opts);

  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, keyInput, {
      audience: opts.audience,
    });
    payload = result.payload;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // jose uses the error code to distinguish expiry.
    if (
      err != null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "ERR_JWT_EXPIRED"
    ) {
      throw new ExpiredTokenError("token has expired", { cause: err });
    }
    throw new InvalidTokenError(`token verification failed: ${message}`, {
      cause: err,
    });
  }

  // Additional issuer check — enforce *.cloudflareaccess.com even when jose
  // did not enforce it (jose only enforces iss when issuer option is set).
  assertIssuer(payload.iss);

  return payload as VerifiedPayload;
}

/**
 * Sign a new JWT.
 *
 * @param payload  Claims to embed (must NOT contain exp — use opts.expiresIn).
 * @param opts     Key material and expiry configuration.
 * @returns        Compact JWT string.
 */
export async function sign(
  payload: Record<string, unknown>,
  opts: SignOptions,
): Promise<string> {
  const { privateKey, alg = "ES256", expiresIn = "1h" } = opts;

  const builder = new SignJWT(payload)
    .setProtectedHeader({ alg })
    .setIssuedAt();

  if (typeof expiresIn === "string") {
    builder.setExpirationTime(expiresIn);
  } else {
    builder.setExpirationTime(Math.floor(Date.now() / 1000) + expiresIn);
  }

  return builder.sign(privateKey);
}

/**
 * Refresh a (possibly recently expired) JWT.
 *
 * Verifies the current token allowing expiry within the grace period, then
 * mints a new token carrying the same non-temporal claims with a fresh exp.
 *
 * Throws InvalidTokenError / ExpiredTokenError (outside grace) if the token
 * cannot be verified.
 */
export async function refresh(
  token: string,
  opts: RefreshOptions,
): Promise<string> {
  const gracePeriodSec = opts.gracePeriodSec ?? 300;
  const keyInput = await buildKeyInput(token, opts.verify ?? {});

  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, keyInput, {
      audience: opts.verify?.audience,
      // Allow tokens that expired up to gracePeriodSec seconds ago.
      clockTolerance: gracePeriodSec,
    });
    payload = result.payload;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      err != null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "ERR_JWT_EXPIRED"
    ) {
      throw new ExpiredTokenError(
        "token has expired beyond the grace period",
        { cause: err },
      );
    }
    throw new InvalidTokenError(`refresh: token verification failed: ${message}`, {
      cause: err,
    });
  }

  // Strip temporal claims — sign() will set fresh ones.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { iat, exp, nbf, ...rest } = payload;

  return sign(rest as Record<string, unknown>, opts);
}

// ---------------------------------------------------------------------------
// Test-only utility: generate a fresh ES256 keypair and export public JWK.
// Named export so test files can import it without importing from jose directly.
// ---------------------------------------------------------------------------

export interface GeneratedKeypair {
  privateKey: KeyLike;
  publicKey: KeyLike;
  jwksDocument: JwksDocument;
}

/**
 * Generate an ephemeral ES256 keypair and return the private key plus a
 * JwksDocument suitable for use as opts.jwksOverride.
 *
 * This is intended for use in tests only.
 */
export async function generateTestKeypair(kid = "test-key-1"): Promise<GeneratedKeypair> {
  const { publicKey, privateKey } = await generateKeyPair("ES256", {
    extractable: true,
  });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = kid;
  publicJwk.alg = "ES256";
  publicJwk.use = "sig";

  return {
    privateKey: privateKey as KeyLike,
    publicKey: publicKey as KeyLike,
    jwksDocument: { keys: [publicJwk] },
  };
}
