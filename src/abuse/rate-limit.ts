/**
 * Per-IP hourly rate limiting using KV. Spec §9 F7.
 *
 * Key format: ratelimit:<ip>:<YYYY-MM-DD-HH>
 * Key expires at the next hour boundary so stale counters self-prune.
 */

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
