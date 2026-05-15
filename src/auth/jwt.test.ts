/**
 * Unit tests for src/auth/jwt.ts
 *
 * Runs inside the @cloudflare/vitest-pool-workers miniflare runtime so
 * Web Crypto and jose behave exactly as on a production Worker.
 * No network calls are made — JWKS is always supplied via jwksOverride.
 */

import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import {
  verify,
  sign,
  refresh,
  generateTestKeypair,
  InvalidTokenError,
  ExpiredTokenError,
} from "./jwt";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_ISS = "https://team.cloudflareaccess.com";
const VALID_AUD = "test-audience";

/** Mint a token using the test keypair. `exp` defaults to now + 3600 s. */
async function mintToken(
  opts: {
    privateKey: CryptoKey;
    iss?: string;
    aud?: string;
    exp?: number;
    kid?: string;
  },
): Promise<string> {
  const exp = opts.exp ?? Math.floor(Date.now() / 1000) + 3600;
  return new SignJWT({ email: "owner@example.com" })
    .setProtectedHeader({ alg: "ES256", kid: opts.kid ?? "test-key-1" })
    .setIssuer(opts.iss ?? VALID_ISS)
    .setAudience(opts.aud ?? VALID_AUD)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(opts.privateKey);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("jwt.verify", () => {
  it("TC-1: accepts a valid token and returns its payload", async () => {
    const kp = await generateTestKeypair();
    const token = await mintToken({ privateKey: kp.privateKey as CryptoKey });

    const payload = await verify(token, {
      audience: VALID_AUD,
      jwksOverride: kp.jwksDocument,
    });

    expect(payload.iss).toBe(VALID_ISS);
    expect(payload.email).toBe("owner@example.com");
  });

  it("TC-2: bad signature throws InvalidTokenError", async () => {
    const kp = await generateTestKeypair("key-1");
    // Build a JWKS with a DIFFERENT public key so the signature does not match.
    const foreign = await generateTestKeypair("key-1"); // same kid, different key
    const token = await mintToken({
      privateKey: kp.privateKey as CryptoKey,
      kid: "key-1",
    });

    await expect(
      verify(token, {
        audience: VALID_AUD,
        jwksOverride: foreign.jwksDocument,
      }),
    ).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("TC-3: wrong issuer throws InvalidTokenError", async () => {
    const kp = await generateTestKeypair();
    const token = await mintToken({
      privateKey: kp.privateKey as CryptoKey,
      iss: "https://evil.example.com",
    });

    await expect(
      verify(token, {
        audience: VALID_AUD,
        jwksOverride: kp.jwksDocument,
      }),
    ).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("TC-4: expired token throws ExpiredTokenError", async () => {
    const kp = await generateTestKeypair();
    const token = await mintToken({
      privateKey: kp.privateKey as CryptoKey,
      exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
    });

    await expect(
      verify(token, {
        audience: VALID_AUD,
        jwksOverride: kp.jwksDocument,
      }),
    ).rejects.toBeInstanceOf(ExpiredTokenError);
  });

  it("TC-4b: ExpiredTokenError is also an instanceof InvalidTokenError", async () => {
    const kp = await generateTestKeypair();
    const token = await mintToken({
      privateKey: kp.privateKey as CryptoKey,
      exp: Math.floor(Date.now() / 1000) - 3600,
    });

    let caught: unknown;
    try {
      await verify(token, {
        audience: VALID_AUD,
        jwksOverride: kp.jwksDocument,
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ExpiredTokenError);
    expect(caught).toBeInstanceOf(InvalidTokenError);
  });
});

describe("jwt.sign + jwt.verify round-trip", () => {
  it("TC-5: sign then verify returns the same payload claims", async () => {
    const kp = await generateTestKeypair();

    const token = await sign(
      { iss: VALID_ISS, aud: VALID_AUD, email: "test@example.com" },
      { privateKey: kp.privateKey, alg: "ES256", expiresIn: "1h" },
    );

    const payload = await verify(token, {
      audience: VALID_AUD,
      jwksOverride: kp.jwksDocument,
    });

    expect(payload.email).toBe("test@example.com");
    expect(payload.iss).toBe(VALID_ISS);
  });
});

describe("jwt.refresh", () => {
  it("TC-6: refresh issues a new token with a later exp", async () => {
    const kp = await generateTestKeypair();

    // Original token that expired 30 seconds ago (within default 300 s grace).
    const originalExp = Math.floor(Date.now() / 1000) - 30;
    const original = await mintToken({
      privateKey: kp.privateKey as CryptoKey,
      exp: originalExp,
    });

    const refreshed = await refresh(original, {
      privateKey: kp.privateKey,
      alg: "ES256",
      expiresIn: "1h",
      gracePeriodSec: 300,
      verify: {
        audience: VALID_AUD,
        jwksOverride: kp.jwksDocument,
      },
    });

    // Refreshed token should be valid.
    const payload = await verify(refreshed, {
      audience: VALID_AUD,
      jwksOverride: kp.jwksDocument,
    });

    const newExp = payload.exp ?? 0;
    expect(newExp).toBeGreaterThan(originalExp);
    expect(payload.email).toBe("owner@example.com");
  });

  it("TC-7: refresh beyond grace period throws ExpiredTokenError", async () => {
    const kp = await generateTestKeypair();

    // Expired 10 minutes ago; grace is only 60 seconds.
    const original = await mintToken({
      privateKey: kp.privateKey as CryptoKey,
      exp: Math.floor(Date.now() / 1000) - 600,
    });

    await expect(
      refresh(original, {
        privateKey: kp.privateKey,
        alg: "ES256",
        expiresIn: "1h",
        gracePeriodSec: 60,
        verify: {
          audience: VALID_AUD,
          jwksOverride: kp.jwksDocument,
        },
      }),
    ).rejects.toBeInstanceOf(ExpiredTokenError);
  });
});

describe("error class discrimination", () => {
  it("TC-8: InvalidTokenError and ExpiredTokenError are distinct via instanceof", () => {
    const inv = new InvalidTokenError("inv");
    const exp = new ExpiredTokenError("exp");

    // ExpiredTokenError IS-A InvalidTokenError
    expect(exp).toBeInstanceOf(InvalidTokenError);
    expect(exp).toBeInstanceOf(ExpiredTokenError);

    // InvalidTokenError is NOT an ExpiredTokenError
    expect(inv).toBeInstanceOf(InvalidTokenError);
    expect(inv).not.toBeInstanceOf(ExpiredTokenError);
  });
});
