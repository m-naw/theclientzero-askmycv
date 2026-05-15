/**
 * Test harness: mint Cloudflare-Access-shaped JWTs against an ephemeral
 * in-memory JWKS document for use in route-level tests.
 *
 * Wraps generateTestKeypair() from src/auth/jwt.ts (the canonical source
 * of the keypair primitive) so per-test files do not import from jose
 * directly.
 *
 * Production code never imports from this module.
 */

import { SignJWT, type KeyLike } from "jose";
import {
  generateTestKeypair,
  type GeneratedKeypair,
  type JwksDocument,
} from "../auth/jwt";

export interface MintJwtOptions {
  /** Audience claim. Required. */
  aud: string;
  /** Issuer claim. Defaults to `https://test.cloudflareaccess.com`. */
  iss?: string;
  /** Email claim. Required. */
  email: string;
  /** Seconds since epoch. Defaults to now + 3600. */
  exp?: number;
  /** kid header, must match a key in the JWKS. */
  kid?: string;
  /** Private key to sign with. */
  privateKey: KeyLike | CryptoKey;
}

/** Mint a CF-Access-shaped JWT. */
export async function mintAccessJwt(opts: MintJwtOptions): Promise<string> {
  const exp = opts.exp ?? Math.floor(Date.now() / 1000) + 3600;
  return new SignJWT({ email: opts.email })
    .setProtectedHeader({ alg: "ES256", kid: opts.kid ?? "test-key-1" })
    .setIssuer(opts.iss ?? "https://test.cloudflareaccess.com")
    .setAudience(opts.aud)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(opts.privateKey as KeyLike);
}

/** Create a fresh keypair + matching JWKS document for a test. */
export async function createJwtHarness(kid = "test-key-1"): Promise<GeneratedKeypair> {
  return generateTestKeypair(kid);
}

export type { GeneratedKeypair, JwksDocument };
