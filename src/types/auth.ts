/**
 * Auth-related types and constants.
 *
 * Kept separate from config.ts to avoid the config module becoming too large.
 */

/** Payload stored inside a signed admin session cookie. */
export interface AdminSessionPayload {
  sub: "admin";
  iat: number;
  exp: number;
}

/** KV key under which the bcrypt/argon2id admin password hash is stored. */
export const ADMIN_PASSWORD_HASH_KEY = "admin_password_hash";

/**
 * KV key under which the cookie-signing secret is stored.
 * This secret is used for HMAC-SHA256 session cookie signatures.
 */
export const COOKIE_SIGNING_SECRET_KEY = "cookie_signing_secret";
