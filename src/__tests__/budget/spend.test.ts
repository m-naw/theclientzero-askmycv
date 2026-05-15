/**
 * Unit tests for src/budget/spend.ts — daily spend tracking.
 * Runs inside @cloudflare/vitest-pool-workers (Miniflare).
 */

import { describe, it, expect, beforeEach } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env } from "cloudflare:test";
import { utcDateKey, readSpend, addSpend } from "../../budget/spend";

interface TestEnv {
  STATE: KVNamespace;
}

function getKv(): KVNamespace {
  return (env as unknown as TestEnv).STATE;
}

describe("utcDateKey", () => {
  it("formats as spend:YYYY-MM-DD", () => {
    const d = new Date("2025-06-15T14:30:00Z");
    expect(utcDateKey(d)).toBe("spend:2025-06-15");
  });

  it("uses UTC date, not local time", () => {
    // Date at 23:59 UTC — UTC date is 15th
    const d = new Date("2025-06-15T23:59:00Z");
    expect(utcDateKey(d)).toBe("spend:2025-06-15");
  });

  it("rolls over at UTC midnight", () => {
    const d = new Date("2025-06-16T00:00:00Z");
    expect(utcDateKey(d)).toBe("spend:2025-06-16");
  });
});

describe("readSpend", () => {
  const testKey = "spend:2025-06-15";

  beforeEach(async () => {
    await getKv().delete(testKey);
  });

  it("returns 0 when key does not exist", async () => {
    const result = await readSpend(getKv(), testKey);
    expect(result).toBe(0);
  });

  it("returns parsed float when key exists", async () => {
    await getKv().put(testKey, "1.23456");
    const result = await readSpend(getKv(), testKey);
    expect(result).toBeCloseTo(1.23456);
  });

  it("returns 0 for non-numeric stored value", async () => {
    await getKv().put(testKey, "garbage");
    const result = await readSpend(getKv(), testKey);
    expect(result).toBe(0);
  });
});

describe("addSpend", () => {
  const testKey = "spend:2025-06-15";

  beforeEach(async () => {
    await getKv().delete(testKey);
  });

  it("writes the delta to KV when key does not exist (starts at 0)", async () => {
    // addSpend without ctx — executes synchronously in the test
    await addSpend(getKv(), testKey, 0.5);
    const stored = await getKv().get(testKey);
    expect(Number(stored)).toBeCloseTo(0.5);
  });

  it("accumulates spend on top of existing value", async () => {
    await getKv().put(testKey, "1.0");
    await addSpend(getKv(), testKey, 0.5);
    const stored = await getKv().get(testKey);
    expect(Number(stored)).toBeCloseTo(1.5);
  });

  it("uses ctx.waitUntil when ctx is provided", async () => {
    let waitUntilCalled = false;
    let waitUntilPromise: Promise<unknown> | null = null;
    const fakeCtx = {
      waitUntil(p: Promise<unknown>) {
        waitUntilCalled = true;
        waitUntilPromise = p;
      },
    } as unknown as ExecutionContext;

    addSpend(getKv(), testKey, 0.25, fakeCtx);
    expect(waitUntilCalled).toBe(true);

    // Await the promise to let the KV write complete
    await waitUntilPromise;
    const stored = await getKv().get(testKey);
    expect(Number(stored)).toBeCloseTo(0.25);
  });
});
