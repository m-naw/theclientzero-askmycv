/**
 * Daily spend tracking helpers. Spec §9 F6.
 *
 * KV key format: spend:YYYY-MM-DD (UTC date).
 * Keys auto-expire after the next UTC midnight so stale entries are pruned
 * automatically without manual cleanup.
 */

/**
 * Build the KV key for the given UTC date.
 * Returns "spend:YYYY-MM-DD".
 */
export function utcDateKey(now: Date): string {
  return `spend:${now.toISOString().slice(0, 10)}`;
}

/**
 * Read the current spend for the given key.
 * Returns 0 if the key does not exist or the stored value is not numeric.
 */
export async function readSpend(kv: KVNamespace, key: string): Promise<number> {
  const raw = await kv.get(key);
  if (raw === null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Internal: perform the read-modify-write for spend accumulation.
 * Returns the promise for ctx.waitUntil scheduling.
 */
async function writeSpend(kv: KVNamespace, key: string, deltaUsd: number): Promise<void> {
  const raw = await kv.get(key);
  const prev = raw === null ? 0 : Number(raw);
  const next = (Number.isFinite(prev) ? prev : 0) + deltaUsd;

  // Compute TTL as seconds until the next UTC midnight after the key's date.
  // Key format: "spend:YYYY-MM-DD" — extract the date portion.
  const datePart = key.slice("spend:".length); // "YYYY-MM-DD"
  const keyDate = new Date(`${datePart}T00:00:00Z`);
  // Next midnight = start of the day after keyDate
  const nextMidnightMs = keyDate.getTime() + 2 * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();
  // Minimum TTL of 60 s — Cloudflare KV requires expirationTtl >= 60.
  const ttlSeconds = Math.max(60, Math.ceil((nextMidnightMs - nowMs) / 1000));

  await kv.put(key, String(next), { expirationTtl: ttlSeconds });
}

/**
 * Add deltaUsd to the stored spend for key.
 *
 * When ctx is provided, schedules the KV write via ctx.waitUntil (non-blocking
 * for the visitor response). When ctx is absent, returns a Promise that resolves
 * when the write is complete — useful for direct calls and unit tests.
 *
 * Failures inside the write are silently swallowed: spend tracking must never
 * break the visitor stream.
 */
export function addSpend(
  kv: KVNamespace,
  key: string,
  deltaUsd: number,
  ctx?: ExecutionContext,
): Promise<void> {
  const promise = writeSpend(kv, key, deltaUsd).catch(() => {
    // swallow — spend tracking must never propagate errors
  });

  if (ctx) {
    ctx.waitUntil(promise);
  }

  return promise;
}
