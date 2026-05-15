/**
 * Unit tests for src/state/machine.ts
 *
 * Uses a pure in-memory Map-backed KV mock — no Miniflare required.
 * All state transitions are deterministic.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  detectState,
  State,
  SETUP_WINDOW_MS,
  isSetupWindowExpired,
  type StateContext,
} from "../../state/machine";

// ---------------------------------------------------------------------------
// In-memory KV mock (Map-backed — no Miniflare dependency)
// ---------------------------------------------------------------------------

type KVValue = string | null;

function makeKV(): KVNamespace {
  const store = new Map<string, KVValue>();

  const kv = {
    get: async (key: string): Promise<string | null> => store.get(key) ?? null,
    put: async (key: string, value: string): Promise<void> => {
      store.set(key, value);
    },
    delete: async (key: string): Promise<void> => {
      store.delete(key);
    },
    list: async () => ({ keys: [], list_complete: true, cursor: undefined }),
    getWithMetadata: async () => ({ value: null, metadata: null }),
  } as unknown as KVNamespace;

  // Expose the store for test assertions
  (kv as unknown as { _store: Map<string, KVValue> })._store = store;

  return kv;
}

function getStore(kv: KVNamespace): Map<string, KVValue> {
  return (kv as unknown as { _store: Map<string, KVValue> })._store;
}

// ---------------------------------------------------------------------------
// Minimal config shape that satisfies the state machine
// ---------------------------------------------------------------------------

const VALID_EMAIL = "owner@example.com";
const VALID_AUD = "my-audience";
const VALID_TEAM_DOMAIN = "myteam.cloudflareaccess.com";

const STORED_CONFIG = JSON.stringify({
  owner_email: VALID_EMAIL,
  owner_aud: VALID_AUD,
  owner_team_domain: VALID_TEAM_DOMAIN,
  display_name: "Test Owner",
});

// ---------------------------------------------------------------------------
// Helper to build a StateContext quickly
// ---------------------------------------------------------------------------

function ctx(
  overrides: Partial<StateContext> & { kv: KVNamespace },
): StateContext {
  return {
    jwtValid: false,
    jwtEmail: undefined,
    jwtAud: undefined,
    jwtTeamDomain: undefined,
    nowMs: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// State A: unconfigured, no valid JWT
// ---------------------------------------------------------------------------

describe("State A — A_UNCONFIGURED", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = makeKV();
  });

  it("SM-A1: first visit returns A_UNCONFIGURED and writes setup_window_start", async () => {
    const nowMs = 1_700_000_000_000;
    const result = await detectState(ctx({ kv, jwtValid: false, nowMs }));

    expect(result.state).toBe(State.A_UNCONFIGURED);
    const store = getStore(kv);
    expect(store.has("setup_window_start")).toBe(true);
    expect(store.get("setup_window_start")).toBe(String(nowMs));
  });

  it("SM-A2: subsequent visit within window does NOT overwrite setup_window_start", async () => {
    const nowMs = 1_700_000_000_000;
    const firstResult = await detectState(ctx({ kv, jwtValid: false, nowMs }));
    expect(firstResult.state).toBe(State.A_UNCONFIGURED);

    const laterMs = nowMs + 60_000; // 1 minute later — still inside window
    const secondResult = await detectState(
      ctx({ kv, jwtValid: false, nowMs: laterMs }),
    );
    expect(secondResult.state).toBe(State.A_UNCONFIGURED);

    // setup_window_start must still hold the first write value
    const stored = getStore(kv).get("setup_window_start");
    expect(stored).toBe(String(nowMs));
  });
});

// ---------------------------------------------------------------------------
// State B: unconfigured, valid JWT present
// ---------------------------------------------------------------------------

describe("State B — B_SETUP_FORM", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = makeKV();
  });

  it("SM-B1: no config + valid JWT returns B_SETUP_FORM", async () => {
    const result = await detectState(
      ctx({
        kv,
        jwtValid: true,
        jwtEmail: VALID_EMAIL,
        jwtAud: VALID_AUD,
        jwtTeamDomain: VALID_TEAM_DOMAIN,
      }),
    );
    expect(result.state).toBe(State.B_SETUP_FORM);
  });

  it("SM-B2: B_SETUP_FORM does NOT write setup_window_start", async () => {
    await detectState(
      ctx({
        kv,
        jwtValid: true,
        jwtEmail: VALID_EMAIL,
        jwtAud: VALID_AUD,
        jwtTeamDomain: VALID_TEAM_DOMAIN,
      }),
    );
    expect(getStore(kv).has("setup_window_start")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// State C: configured, JWT present and claims match
// ---------------------------------------------------------------------------

describe("State C — C_CONFIGURED", () => {
  let kv: KVNamespace;

  beforeEach(async () => {
    kv = makeKV();
    await kv.put("config", STORED_CONFIG);
  });

  it("SM-C1: config present + JWT with matching claims returns C_CONFIGURED", async () => {
    const result = await detectState(
      ctx({
        kv,
        jwtValid: true,
        jwtEmail: VALID_EMAIL,
        jwtAud: VALID_AUD,
        jwtTeamDomain: VALID_TEAM_DOMAIN,
      }),
    );
    expect(result.state).toBe(State.C_CONFIGURED);
  });

  it("SM-C2: config present + no JWT returns access_denied", async () => {
    const result = await detectState(ctx({ kv, jwtValid: false }));
    expect(result.reason).toBe("access_denied");
  });

  it("SM-C3: config present + JWT with mismatched email returns access_denied", async () => {
    const result = await detectState(
      ctx({
        kv,
        jwtValid: true,
        jwtEmail: "intruder@example.com",
        jwtAud: VALID_AUD,
        jwtTeamDomain: VALID_TEAM_DOMAIN,
      }),
    );
    expect(result.reason).toBe("access_denied");
  });

  it("SM-C4: config present + JWT with mismatched audience returns access_denied", async () => {
    const result = await detectState(
      ctx({
        kv,
        jwtValid: true,
        jwtEmail: VALID_EMAIL,
        jwtAud: "wrong-audience",
        jwtTeamDomain: VALID_TEAM_DOMAIN,
      }),
    );
    expect(result.reason).toBe("access_denied");
  });

  it("SM-C5: config present + JWT with mismatched team_domain returns access_denied", async () => {
    const result = await detectState(
      ctx({
        kv,
        jwtValid: true,
        jwtEmail: VALID_EMAIL,
        jwtAud: VALID_AUD,
        jwtTeamDomain: "evil.cloudflareaccess.com",
      }),
    );
    expect(result.reason).toBe("access_denied");
  });
});

// ---------------------------------------------------------------------------
// State D: setup window expired
// ---------------------------------------------------------------------------

describe("State D — D_EXPIRED", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = makeKV();
  });

  it("SM-D1: no config, no JWT, expired window returns D_EXPIRED", async () => {
    const startMs = 1_700_000_000_000;
    await kv.put("setup_window_start", String(startMs));

    const nowMs = startMs + SETUP_WINDOW_MS + 1;
    const result = await detectState(ctx({ kv, jwtValid: false, nowMs }));

    expect(result.state).toBe(State.D_EXPIRED);
  });

  it("SM-D2: no config, no JWT, window exactly at boundary is NOT expired", async () => {
    const startMs = 1_700_000_000_000;
    await kv.put("setup_window_start", String(startMs));

    // Exactly at SETUP_WINDOW_MS — not yet expired (> check, not >=)
    const nowMs = startMs + SETUP_WINDOW_MS;
    const result = await detectState(ctx({ kv, jwtValid: false, nowMs }));

    expect(result.state).toBe(State.A_UNCONFIGURED);
  });
});

// ---------------------------------------------------------------------------
// isSetupWindowExpired helper
// ---------------------------------------------------------------------------

describe("isSetupWindowExpired", () => {
  it("returns true when elapsed > SETUP_WINDOW_MS", () => {
    const startMs = 1_000_000;
    const nowMs = startMs + SETUP_WINDOW_MS + 1;
    expect(isSetupWindowExpired(startMs, nowMs)).toBe(true);
  });

  it("returns false when elapsed <= SETUP_WINDOW_MS", () => {
    const startMs = 1_000_000;
    const nowMs = startMs + SETUP_WINDOW_MS;
    expect(isSetupWindowExpired(startMs, nowMs)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SETUP_WINDOW_MS constant
// ---------------------------------------------------------------------------

describe("SETUP_WINDOW_MS constant", () => {
  it("equals 30 minutes in milliseconds", () => {
    expect(SETUP_WINDOW_MS).toBe(30 * 60 * 1000);
  });
});
