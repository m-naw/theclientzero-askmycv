/**
 * JWKS mock — generates an EC P-256 keypair, exposes the public JWK set
 * over a fetch handler, and issues ES256-signed JWTs with controllable
 * aud / iss / email / exp claims that the Worker's `jose.jwtVerify` path
 * can verify against the same JWKS URL.
 *
 * Test-only injection: tests set `env.ACCESS_JWKS_URL_OVERRIDE` to the
 * URL that resolves to this mock's `fetchHandler`. Worker code reads
 * that env binding — no globalThis monkey-patching.
 */

import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyLike } from "jose";

export interface JwtClaims {
  aud: string;
  iss: string;
  email: string;
  /** Seconds since epoch. Defaults to now + 3600. */
  exp?: number;
  /** When true, sign with a foreign keypair so signature verification fails. */
  forge?: boolean;
}

export interface JwksMock {
  /** Returns a JWKS document (public keys only). */
  getJwks(): Promise<{ keys: JWK[] }>;
  /** Mints a signed JWT. */
  issueJwt(claims: JwtClaims): Promise<string>;
  /** Fetch handler suitable for the JWKS URL (returns application/json). */
  fetchHandler: (request: Request) => Promise<Response>;
}

export async function createJwksMock(): Promise<JwksMock> {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const kid = "askmycv-test-key-1";
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = kid;
  publicJwk.alg = "ES256";
  publicJwk.use = "sig";

  // Foreign keypair for forged-signature tests.
  const foreign = await generateKeyPair("ES256", { extractable: true });

  async function sign(privKey: KeyLike | Uint8Array, claims: JwtClaims): Promise<string> {
    const exp = claims.exp ?? Math.floor(Date.now() / 1000) + 3600;
    return new SignJWT({ email: claims.email })
      .setProtectedHeader({ alg: "ES256", kid })
      .setIssuer(claims.iss)
      .setAudience(claims.aud)
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(privKey);
  }

  return {
    async getJwks() {
      return { keys: [publicJwk] };
    },
    async issueJwt(claims) {
      return sign(claims.forge ? foreign.privateKey : privateKey, claims);
    },
    fetchHandler: async () => {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  };
}
