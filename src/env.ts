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
}
