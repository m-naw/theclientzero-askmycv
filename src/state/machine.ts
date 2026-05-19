/**
 * State machine for AskMyCV.
 *
 * Detects one of four application states (A–D) based on:
 *  - KV contents (config presence, setup_window_start presence/age)
 *  - JWT validity and claim match against stored config
 *
 * Downstream route handlers consume the result to decide which response to
 * render without duplicating detection logic.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Setup window duration: 10 minutes in milliseconds. */
export const SETUP_WINDOW_MS = 600_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The four states the Worker can be in. */
export const enum State {
  /** No config in KV, no valid JWT, setup window still open. */
  A_UNCONFIGURED = "A_UNCONFIGURED",
  /** No config in KV, valid JWT present — show setup form. */
  B_SETUP_FORM = "B_SETUP_FORM",
  /** Config present in KV, JWT claims match stored identity. */
  C_CONFIGURED = "C_CONFIGURED",
  /** No config in KV, no valid JWT, setup window has elapsed. */
  D_EXPIRED = "D_EXPIRED",
}

/**
 * Input context supplied by the route handler to detectState().
 * All JWT-derived fields are optional and undefined when no valid JWT is
 * present in the request.
 */
export interface StateContext {
  /** The KV namespace bound to this Worker. */
  kv: KVNamespace;
  /** True when a Cloudflare Access JWT was present and passed full verification. */
  jwtValid: boolean;
  /** Email claim from the verified JWT. Undefined if jwtValid is false. */
  jwtEmail?: string;
  /** Audience claim from the verified JWT. Undefined if jwtValid is false. */
  jwtAud?: string;
  /** Team domain extracted from the JWT issuer. Undefined if jwtValid is false. */
  jwtTeamDomain?: string;
  /** Current time in milliseconds since epoch. Defaults to Date.now(). */
  nowMs?: number;
}

/**
 * Result returned by detectState(). Always carries a `state` field. When
 * `reason` is "access_denied" the caller must respond with 403 regardless of
 * what `state` holds.
 */
export interface StateResult {
  state: State;
  reason?: "access_denied";
}

/**
 * Minimal shape stored in KV under the "config" key.
 * Only the identity fields are needed by the state machine; the full type
 * lives in src/types/config.ts.
 * CF Access fields are optional — when absent, the worker operates in
 * password-only mode and does not require a JWT for /setup or /admin.
 */
interface StoredConfigIdentity {
  access_email?: string;
  access_aud?: string;
  access_team_domain?: string;
  admin_password_hash?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the setup window has elapsed.
 *
 * The window is open (not expired) at the exact boundary moment — the check
 * uses a strict greater-than comparison so the boundary instant is still
 * considered within the window.
 */
export function isSetupWindowExpired(startMs: number, nowMs: number): boolean {
  return nowMs - startMs > SETUP_WINDOW_MS;
}

// ---------------------------------------------------------------------------
// Core detection function
// ---------------------------------------------------------------------------

/**
 * Detect the current application state.
 *
 * Side effects: when the state machine determines State A for the first time
 * (no setup_window_start in KV), it writes the current timestamp to KV to
 * start the setup window timer. Subsequent State A determinations within the
 * window do not overwrite that timestamp.
 */
export async function detectState(ctx: StateContext): Promise<StateResult> {
  const now = ctx.nowMs ?? Date.now();

  // Read config from KV. If present, we are either C_CONFIGURED or access_denied.
  const configRaw = await ctx.kv.get("config");

  if (configRaw !== null) {
    let storedConfig: StoredConfigIdentity;
    try {
      storedConfig = JSON.parse(configRaw) as StoredConfigIdentity;
    } catch {
      // Corrupt config — treat as access_denied to prevent broken access.
      return { state: State.C_CONFIGURED, reason: "access_denied" };
    }

    // When access_email is set in config, CF Access JWT is required and must match.
    if (storedConfig.access_email && storedConfig.access_email.length > 0) {
      if (!ctx.jwtValid || !ctx.jwtEmail || !ctx.jwtAud || !ctx.jwtTeamDomain) {
        return { state: State.C_CONFIGURED, reason: "access_denied" };
      }

      if (
        ctx.jwtEmail !== storedConfig.access_email ||
        ctx.jwtAud !== storedConfig.access_aud ||
        ctx.jwtTeamDomain !== storedConfig.access_team_domain
      ) {
        return { state: State.C_CONFIGURED, reason: "access_denied" };
      }
    }
    // When access_email is absent, the worker runs in password-only mode.
    // The state machine does not gate on JWT — admin auth is handled by
    // the session cookie mechanism in the route handlers.

    return { state: State.C_CONFIGURED };
  }

  // No config in KV.

  if (ctx.jwtValid) {
    // Valid JWT present — show the setup form.
    return { state: State.B_SETUP_FORM };
  }

  // No config and no valid JWT — check/set the setup window.
  const windowStartRaw = await ctx.kv.get("setup_window_start");

  if (windowStartRaw === null) {
    // First unconfigured visit — record the window start.
    await ctx.kv.put("setup_window_start", String(now));
    return { state: State.A_UNCONFIGURED };
  }

  const windowStartMs = Number(windowStartRaw);

  if (isSetupWindowExpired(windowStartMs, now)) {
    return { state: State.D_EXPIRED };
  }

  // Within the window — do NOT overwrite the original timestamp.
  return { state: State.A_UNCONFIGURED };
}
