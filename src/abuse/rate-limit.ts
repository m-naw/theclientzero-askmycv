/**
 * Per-IP hourly rate limiting using KV. Spec §9 F7.
 *
 * Key format: ratelimit:<ip>:<YYYY-MM-DD-HH>
 * Key expires at the next hour boundary so stale counters self-prune.
 */

import { LOGIN_RATE_LIMIT_MAX, LOGIN_RATE_LIMIT_WINDOW_MS } from "../auth/constants";

// ---------------------------------------------------------------------------
// Login rate-limit constants
// ---------------------------------------------------------------------------

/** KV key prefix for login attempt rate limiting. Format: ratelimit:login:<ip> */
export const LOGIN_RATE_LIMIT_PREFIX = "ratelimit:login:";

// Re-export for backwards compat
export { LOGIN_RATE_LIMIT_MAX } from "../auth/constants";

/** Login rate-limit window duration in seconds (1 hour). */
export const LOGIN_RATE_LIMIT_WINDOW_SECONDS = 3600;

function hourKey(ip: string, now: Date): string {
  const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const hour = now.getUTCHours().toString().padStart(2, "0");
  return `ratelimit:${ip}:${date}-${hour}`;
}

/**
 * Increment the request counter for the given IP and check if it is within
 * the allowed limit.
 *
 * Returns { allowed: boolean, count: number } where:
 * - allowed: true if the incremented count is <= limit
 * - count: the new count after incrementing
 */
export async function checkAndIncrement(
  kv: KVNamespace,
  ip: string,
  limit: number,
  now: Date,
): Promise<{ allowed: boolean; count: number }> {
  const key = hourKey(ip, now);

  const raw = await kv.get(key);
  const prev = raw === null ? 0 : Number(raw);
  const count = (Number.isFinite(prev) ? prev : 0) + 1;

  // Compute TTL as seconds until the next hour boundary
  const msUntilNextHour =
    (60 - now.getUTCMinutes()) * 60 * 1000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds();
  const ttlSeconds = Math.max(1, Math.ceil(msUntilNextHour / 1000));

  await kv.put(key, String(count), { expirationTtl: ttlSeconds });

  return { allowed: count <= limit, count };
}

// ---------------------------------------------------------------------------
// Login-specific rate limiting
// ---------------------------------------------------------------------------

/**
 * Check and increment the login attempt counter for the given IP.
 *
 * Uses LOGIN_RATE_LIMIT_MAX and LOGIN_RATE_LIMIT_WINDOW_MS from auth/constants.
 * Key format: ratelimit:login:<ip>
 * Window: rolling LOGIN_RATE_LIMIT_WINDOW_MS milliseconds (1 hour).
 *
 * Returns { allowed: boolean, remaining: number }:
 * - allowed: true if the incremented count is <= LOGIN_RATE_LIMIT_MAX
 * - remaining: attempts remaining after this one (0 when denied)
 */
export async function checkLoginRateLimit(
  kv: KVNamespace,
  ip: string,
): Promise<{ allowed: boolean; remaining: number }> {
  const key = `${LOGIN_RATE_LIMIT_PREFIX}${ip}`;

  const raw = await kv.get(key);
  const prev = raw === null ? 0 : Number(raw);
  const count = (Number.isFinite(prev) ? prev : 0) + 1;

  const ttlSeconds = Math.max(1, Math.ceil(LOGIN_RATE_LIMIT_WINDOW_MS / 1000));
  await kv.put(key, String(count), { expirationTtl: ttlSeconds });

  const allowed = count <= LOGIN_RATE_LIMIT_MAX;
  const remaining = allowed ? Math.max(0, LOGIN_RATE_LIMIT_MAX - count) : 0;
  return { allowed, remaining };
}
