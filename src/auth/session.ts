/**
 * Admin session cookie management.
 *
 * Uses Web Crypto (SubtleCrypto) for HMAC-SHA256 — compatible with
 * Cloudflare Workers runtime (no Node crypto dependency).
 *
 * Token format: base64url(payload_json).base64url(hmac_signature)
 */

import type { AdminSessionPayload } from "../types/auth";

export { AdminSessionPayload };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Name of the HTTP cookie holding the admin session token. */
export const SESSION_COOKIE_NAME = "askmycv_admin_session";

/** Default session lifetime: 7 days in seconds. */
export const SESSION_TTL_SECONDS = 604800;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function base64urlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64urlDecode(str: string): Uint8Array {
  // Restore padding
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function importKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sign an AdminSessionPayload and return a compact token string.
 * Format: `<base64url(payload_json)>.<base64url(hmac_sha256_signature)>`
 */
export async function signSession(
  payload: AdminSessionPayload,
  secret: string,
): Promise<string> {
  const enc = new TextEncoder();
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = base64urlEncode(enc.encode(payloadJson).buffer as ArrayBuffer);

  const key = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64));
  const sigB64 = base64urlEncode(sig);

  return `${payloadB64}.${sigB64}`;
}

/**
 * Verify a session token. Throws if the signature is invalid or the token is
 * expired. Returns the decoded AdminSessionPayload on success.
 */
export async function verifySession(
  cookieValue: string,
  secret: string,
): Promise<AdminSessionPayload> {
  const dotIndex = cookieValue.lastIndexOf(".");
  if (dotIndex === -1) {
    throw new Error("Invalid session token: missing signature separator");
  }

  const payloadB64 = cookieValue.slice(0, dotIndex);
  const sigB64 = cookieValue.slice(dotIndex + 1);

  if (!payloadB64 || !sigB64) {
    throw new Error("Invalid session token: empty payload or signature");
  }

  // Verify HMAC
  const enc = new TextEncoder();
  const key = await importKey(secret);
  let sigBytes: Uint8Array;
  try {
    sigBytes = base64urlDecode(sigB64);
  } catch {
    throw new Error("Invalid session token: cannot decode signature");
  }

  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes,
    enc.encode(payloadB64),
  );

  if (!valid) {
    throw new Error("Invalid session token: signature mismatch");
  }

  // Decode and parse payload
  let payload: AdminSessionPayload;
  try {
    const payloadBytes = base64urlDecode(payloadB64);
    const payloadJson = new TextDecoder().decode(payloadBytes);
    payload = JSON.parse(payloadJson) as AdminSessionPayload;
  } catch {
    throw new Error("Invalid session token: cannot decode payload");
  }

  // Check expiry
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.exp <= nowSeconds) {
    throw new Error("Session token expired");
  }

  return payload;
}

/** Options for buildSetCookieHeader. */
export interface SetCookieOptions {
  /** Max-Age in seconds. Defaults to SESSION_TTL_SECONDS. */
  maxAge?: number;
}

/**
 * Build a Set-Cookie header value for an admin session cookie.
 * Always sets HttpOnly; Secure; SameSite=Lax; Path=/admin.
 */
export function buildSetCookieHeader(
  value: string,
  opts: SetCookieOptions = {},
): string {
  const maxAge = opts.maxAge ?? SESSION_TTL_SECONDS;
  return [
    `${SESSION_COOKIE_NAME}=${value}`,
    `Max-Age=${maxAge}`,
    "Path=/admin",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

/**
 * Build a Set-Cookie header value that clears the admin session cookie.
 */
export function buildClearCookieHeader(): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Max-Age=0",
    "Path=/admin",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

// ---------------------------------------------------------------------------
// High-level KV-backed session helpers
// ---------------------------------------------------------------------------

/** KV key under which the cookie-signing secret is stored. */
const SIGNING_SECRET_KEY = "cookie_signing_secret";

/**
 * Get or generate the HMAC signing secret from KV.
 * If no secret exists, generates a 32-byte random secret and stores it.
 */
async function getOrCreateSigningSecret(kv: KVNamespace): Promise<string> {
  const existing = await kv.get(SIGNING_SECRET_KEY);
  if (existing !== null && existing.length > 0) {
    return existing;
  }
  // Generate a new 32-byte random secret, stored as hex
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  await kv.put(SIGNING_SECRET_KEY, hex);
  return hex;
}

/**
 * Read the cookie value for SESSION_COOKIE_NAME from the request Cookie header.
 * Returns null if not present.
 */
function readSessionCookieValue(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const name = trimmed.slice(0, eqIdx).trim();
    if (name === SESSION_COOKIE_NAME) {
      return trimmed.slice(eqIdx + 1).trim();
    }
  }
  return null;
}

/**
 * Create a new signed admin session cookie.
 * Generates a fresh session token, signs it, and returns the Set-Cookie header value.
 */
export async function createSessionCookie(kv: KVNamespace): Promise<string> {
  const secret = await getOrCreateSigningSecret(kv);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: AdminSessionPayload = {
    sub: "admin",
    iat: nowSeconds,
    exp: nowSeconds + SESSION_TTL_SECONDS,
  };
  const token = await signSession(payload, secret);
  return buildSetCookieHeader(token);
}

/**
 * Return a Set-Cookie header value that clears the session cookie.
 * Does not require KV access — just produces the clearing header.
 */
export function clearSessionCookie(): string {
  return buildClearCookieHeader();
}

/**
 * Verify the session cookie from the request.
 * Returns the parsed AdminSessionPayload on success, or null if missing/invalid/expired.
 */
export async function verifySessionCookie(
  request: Request,
  kv: KVNamespace,
): Promise<AdminSessionPayload | null> {
  const cookieValue = readSessionCookieValue(request);
  if (cookieValue === null) return null;

  const secret = await kv.get(SIGNING_SECRET_KEY);
  if (secret === null || secret.length === 0) return null;

  try {
    return await verifySession(cookieValue, secret);
  } catch {
    return null;
  }
}
