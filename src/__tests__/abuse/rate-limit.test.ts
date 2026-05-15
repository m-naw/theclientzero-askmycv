/**
 * Unit tests for src/abuse/rate-limit.ts — per-IP hourly rate limiting.
 * Runs inside @cloudflare/vitest-pool-workers (Miniflare).
 */

import { describe, it, expect, beforeEach } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env } from "cloudflare:test";
import { checkAndIncrement } from "../../abuse/rate-limit";

interface TestEnv {
  STATE: KVNamespace;
}

function getKv(): KVNamespace {
  return (env as unknown as TestEnv).STATE;
}

describe("checkAndIncrement", () => {
  const ip = "1.2.3.4";
  const limit = 5;
  const now = new Date("2025-06-15T14:30:00Z");

  beforeEach(async () => {
    // Clean up any rate limit keys
    const kv = getKv();
    const key = `ratelimit:${ip}:2025-06-15-14`;
    await kv.delete(key);
  });

  it("allows the first request (count=1, allowed=true)", async () => {
    const result = await checkAndIncrement(getKv(), ip, limit, now);
    expect(result.allowed).toBe(true);
    expect(result.count).toBe(1);
  });

  it("allows requests up to the limit", async () => {
    for (let i = 1; i <= limit; i++) {
      const result = await checkAndIncrement(getKv(), ip, limit, now);
      expect(result.allowed).toBe(true);
      expect(result.count).toBe(i);
    }
  });

  it("blocks the request when count exceeds limit", async () => {
    // Exhaust the limit
    for (let i = 0; i < limit; i++) {
      await checkAndIncrement(getKv(), ip, limit, now);
    }
    // Next request should be blocked
    const result = await checkAndIncrement(getKv(), ip, limit, now);
    expect(result.allowed).toBe(false);
    expect(result.count).toBeGreaterThan(limit);
  });

  it("uses different keys for different hours", async () => {
    const kv = getKv();
    const now14 = new Date("2025-06-15T14:30:00Z");
    const now15 = new Date("2025-06-15T15:00:00Z");

    // Fill up hour 14
    for (let i = 0; i < limit; i++) {
      await checkAndIncrement(kv, ip, limit, now14);
    }
    const blocked = await checkAndIncrement(kv, ip, limit, now14);
    expect(blocked.allowed).toBe(false);

    // Hour 15 should be fresh
    const fresh = await checkAndIncrement(kv, ip, limit, now15);
    expect(fresh.allowed).toBe(true);
    expect(fresh.count).toBe(1);
  });

  it("uses different keys for different IPs", async () => {
    const kv = getKv();
    const ip2 = "9.8.7.6";
    const key2 = `ratelimit:${ip2}:2025-06-15-14`;
    await kv.delete(key2);

    // Fill up ip1
    for (let i = 0; i < limit; i++) {
      await checkAndIncrement(kv, ip, limit, now);
    }
    const blocked = await checkAndIncrement(kv, ip, limit, now);
    expect(blocked.allowed).toBe(false);

    // ip2 should be fresh
    const fresh = await checkAndIncrement(kv, ip2, limit, now);
    expect(fresh.allowed).toBe(true);
    expect(fresh.count).toBe(1);
  });
});
