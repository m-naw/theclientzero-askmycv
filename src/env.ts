export interface Env {
  /** KV namespace bound at deploy time — see wrangler.toml. */
  STATE: KVNamespace;
  /**
   * Override for Anthropic's base URL. Tests point this at a local mock;
   * production leaves it empty so the SDK uses its default.
   */
  ANTHROPIC_BASE_URL?: string;
  /**
   * Test-only override for the JWKS endpoint used by Access JWT
   * verification. Empty in production (real CF Access URL is used).
   */
  ACCESS_JWKS_URL_OVERRIDE?: string;
  /**
   * Timeout in milliseconds for the Anthropic upstream fetch.
   * Coerced to a number at runtime; defaults to 30000ms.
   */
  ANTHROPIC_TIMEOUT_MS?: string;
}

/** Returns the Anthropic fetch timeout in milliseconds (default 30000). */
export function getAnthropicTimeoutMs(env: Env): number {
  const raw = env.ANTHROPIC_TIMEOUT_MS;
  if (raw === undefined || raw === "") return 30000;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 30000;
}
