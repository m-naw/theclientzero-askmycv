/**
 * StoredConfig — the canonical configuration payload persisted under the
 * KV key `config`. Field names are snake_case per spec §11.
 *
 * The Anthropic API key is stored on this same record (rather than under a
 * separate "secrets" KV entry) because the spec defines `anthropic_api_key`
 * as a top-level field of the persisted config (see spec §11 / §12 Test 2).
 * No code path is allowed to embed the key into HTML or env vars; KV is
 * the only source.
 */

export interface StoredConfig {
  /** Owner's display name shown on the chat page. Required. */
  display_name: string;
  /** Short headline shown on the chat page. Required. */
  headline: string;
  /** CV content in markdown, 200..50000 chars. Required. */
  cv_markdown: string;
  /** Anthropic API key. KV-only; never echoed to HTML or logs. Required. */
  anthropic_api_key: string;
  /** Hard daily Anthropic spend cap, in USD. Required. */
  daily_budget_usd: number;
  /** Owner's email captured from the Access JWT during setup. Required. */
  access_email: string;
  /** Access application audience captured at setup. Required. */
  access_aud: string;
  /** Cloudflare team domain (host portion of iss) captured at setup. Required. */
  access_team_domain: string;
  /** ms-since-epoch timestamp at which setup completed. Required. */
  setup_timestamp: number;

  // ---- Optional profile fields (spec §9 F3 / F4) ----
  /** Owner's location shown on the chat page. Optional. */
  location?: string;
  /** LinkedIn profile URL rendered as an anchor. Optional. */
  linkedin_url?: string;
  /** GitHub profile URL rendered as an anchor. Optional. */
  github_url?: string;
  /** PDF CV download URL rendered as an anchor. Optional. */
  pdf_cv_url?: string;
  /** Suggested starter questions shown to visitors. Optional; falls back to defaults. */
  suggested_questions?: string[];
}

/** Names of all required fields (used by the setup-form validator). */
export const REQUIRED_SETUP_FIELDS = [
  "display_name",
  "headline",
  "anthropic_api_key",
  "cv_markdown",
  "daily_budget_usd",
] as const;

export type RequiredSetupField = (typeof REQUIRED_SETUP_FIELDS)[number];

/** CV markdown length bounds per spec F3. */
export const CV_MIN_LENGTH = 200;
export const CV_MAX_LENGTH = 50_000;

/**
 * Lightweight runtime validator. Returns `{ ok: true, value }` if the JSON
 * conforms to StoredConfig shape, otherwise `{ ok: false, error }`.
 *
 * No zod dependency — the validation surface is small enough that a manual
 * walk is clearer than introducing a schema library for one type.
 */
export function parseStoredConfig(
  raw: unknown,
): { ok: true; value: StoredConfig } | { ok: false; error: string } {
  if (raw === null || typeof raw !== "object") {
    return { ok: false, error: "config must be an object" };
  }
  const r = raw as Record<string, unknown>;
  const stringFields = [
    "display_name",
    "headline",
    "cv_markdown",
    "anthropic_api_key",
    "access_email",
    "access_aud",
    "access_team_domain",
  ] as const;
  for (const f of stringFields) {
    if (typeof r[f] !== "string" || (r[f] as string).length === 0) {
      return { ok: false, error: `field ${f} missing or not a non-empty string` };
    }
  }
  if (typeof r.daily_budget_usd !== "number" || Number.isNaN(r.daily_budget_usd)) {
    return { ok: false, error: "daily_budget_usd must be a number" };
  }
  if (typeof r.setup_timestamp !== "number" || Number.isNaN(r.setup_timestamp)) {
    return { ok: false, error: "setup_timestamp must be a number" };
  }
  return { ok: true, value: r as unknown as StoredConfig };
}
