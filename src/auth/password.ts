/**
 * Password hashing and verification using bcryptjs.
 *
 * Uses bcryptjs (pure JS, compatible with Cloudflare Workers runtime).
 * The Anthropic API key is never read here — this module is auth-only.
 */

import * as bcrypt from "bcryptjs";

/** bcrypt work factor. 10 rounds is standard for interactive login. */
const BCRYPT_ROUNDS = 10;

/**
 * Hash a plaintext password using bcrypt.
 * Returns the bcrypt hash string (includes salt).
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

/**
 * Verify a plaintext password against a stored bcrypt hash.
 * Returns true if the password matches, false otherwise.
 */
export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}

/**
 * Introduce a 500ms delay to slow brute-force on wrong-password responses.
 * Call this before returning a 401 on password mismatch.
 */
export async function delayWrongPassword(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 500));
}
