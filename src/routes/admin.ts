/**
 * GET /admin and POST /admin/save handlers.
 *
 * Both routes require a valid Cloudflare Access JWT whose identity (email,
 * aud, team_domain) exactly matches the values recorded at setup. Any
 * mismatch renders the access-denied page with the specific denial reason.
 *
 * GET /admin — renders the admin form pre-filled with the current config,
 * omitting the Anthropic API key value (it is never echoed to HTML).
 *
 * POST /admin/save — validates form input, optionally validates a new
 * Anthropic key against the live API, then persists the updated config.
 * If the key field is blank, the existing key is preserved unchanged.
 * The key value is never included in any HTML response.
 */

import Anthropic from "@anthropic-ai/sdk";
import { verifyOwnerIdentity } from "../auth/identity";
import { resolveJwksSource } from "./jwks-source";
import { renderAdminForm } from "../views/admin-form";
import { renderAccessDenied, type AccessDenialReason } from "../views/error-pages";
import {
  parseStoredConfig,
  CV_MIN_LENGTH,
  CV_MAX_LENGTH,
  ALLOWED_MODELS,
  DEFAULT_MODEL,
  type StoredConfig,
} from "../types/config";
import type { Env } from "../env";

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" } as const;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

function errorJson(status: number, error: string, field?: string): Response {
  return new Response(JSON.stringify({ error, field }), {
    status,
    headers: JSON_HEADERS,
  });
}

function readField(form: FormData, name: string): string {
  const v = form.get(name);
  if (typeof v !== "string") return "";
  return v;
}

/**
 * Load and parse the stored config from KV.
 * Returns null when config is absent or malformed (unconfigured state).
 */
async function loadConfig(env: Env): Promise<StoredConfig | null> {
  const raw = await env.STATE.get("config");
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = parseStoredConfig(parsed);
  return result.ok ? result.value : null;
}

// ---------------------------------------------------------------------------
// GET /admin
// ---------------------------------------------------------------------------

export async function handleAdminGet(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  // --- Load config ---
  const config = await loadConfig(env);
  if (config === null) {
    // Not yet configured — the setup flow handles this path.
    return new Response(renderAccessDenied({ reason: "no_jwt" }), {
      status: 403,
      headers: HTML_HEADERS,
    });
  }

  // --- Auth ---
  const source = await resolveJwksSource(env);
  const authResult = await verifyOwnerIdentity(request, config, source);
  if (!authResult.ok) {
    const reason = authResult.reason as AccessDenialReason;
    return new Response(
      renderAccessDenied({
        reason,
        expectedEmail: config.access_email,
      }),
      { status: 403, headers: HTML_HEADERS },
    );
  }

  // --- Render admin form, prefilled — API key is intentionally excluded ---
  const html = renderAdminForm({
    email: authResult.identity.email,
    prefill: {
      display_name: config.display_name,
      headline: config.headline,
      cv_markdown: config.cv_markdown,
      daily_budget_usd: config.daily_budget_usd,
      location: config.location,
      linkedin_url: config.linkedin_url,
      github_url: config.github_url,
      pdf_cv_url: config.pdf_cv_url,
      max_msgs_per_hour: config.max_msgs_per_hour,
      model: config.model,
      accent_color: config.accent_color,
    },
  });

  return new Response(html, { status: 200, headers: HTML_HEADERS });
}

// ---------------------------------------------------------------------------
// POST /admin/save
// ---------------------------------------------------------------------------

export async function handleAdminSave(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  // --- Load config ---
  const config = await loadConfig(env);
  if (config === null) {
    return errorJson(403, "not configured");
  }

  // --- Auth ---
  const source = await resolveJwksSource(env);
  const authResult = await verifyOwnerIdentity(request, config, source);
  if (!authResult.ok) {
    const reason = authResult.reason as AccessDenialReason;
    return new Response(
      renderAccessDenied({
        reason,
        expectedEmail: config.access_email,
      }),
      { status: 403, headers: HTML_HEADERS },
    );
  }

  // --- Parse form body ---
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorJson(400, "invalid form body");
  }

  const display_name = readField(form, "display_name");
  if (!display_name) return errorJson(400, "missing required field: display_name", "display_name");

  const headline = readField(form, "headline");
  if (!headline) return errorJson(400, "missing required field: headline", "headline");

  const cv_markdown = readField(form, "cv_markdown");
  if (!cv_markdown) return errorJson(400, "missing required field: cv_markdown", "cv_markdown");
  if (cv_markdown.length < CV_MIN_LENGTH || cv_markdown.length > CV_MAX_LENGTH) {
    return errorJson(
      400,
      `cv_markdown must be between ${CV_MIN_LENGTH} and ${CV_MAX_LENGTH} characters`,
      "cv_markdown",
    );
  }

  const daily_budget_raw = readField(form, "daily_budget_usd");
  if (!daily_budget_raw) return errorJson(400, "missing required field: daily_budget_usd", "daily_budget_usd");
  const daily_budget_usd = Number(daily_budget_raw);
  if (!Number.isFinite(daily_budget_usd) || daily_budget_usd <= 0) {
    return errorJson(400, "daily_budget_usd must be a positive number", "daily_budget_usd");
  }

  // Optional fields
  const location = readField(form, "location") || undefined;
  const linkedin_url = readField(form, "linkedin_url") || undefined;
  const github_url = readField(form, "github_url") || undefined;
  const pdf_cv_url = readField(form, "pdf_cv_url") || undefined;
  const max_msgs_per_hour_raw = readField(form, "max_msgs_per_hour");
  let max_msgs_per_hour: number | undefined = undefined;
  if (max_msgs_per_hour_raw) {
    const parsed = Number(max_msgs_per_hour_raw);
    if (Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0) {
      max_msgs_per_hour = parsed;
    }
  }
  const modelRaw = readField(form, "model");
  const model = (ALLOWED_MODELS as readonly string[]).includes(modelRaw)
    ? modelRaw
    : (config.model ?? DEFAULT_MODEL);
  const accent_color = readField(form, "accent_color").trim() || undefined;

  // --- Anthropic key: blank = preserve existing; non-blank = validate + replace ---
  const newKeyRaw = readField(form, "anthropic_api_key");
  let anthropic_api_key = config.anthropic_api_key; // preserve existing by default

  if (newKeyRaw.length > 0) {
    // Validate the new key against the live Anthropic API.
    try {
      const clientOpts: ConstructorParameters<typeof Anthropic>[0] = {
        apiKey: newKeyRaw,
        dangerouslyAllowBrowser: true,
      };
      if (env.ANTHROPIC_BASE_URL && env.ANTHROPIC_BASE_URL.length > 0) {
        clientOpts.baseURL = env.ANTHROPIC_BASE_URL;
      }
      const client = new Anthropic(clientOpts);
      await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        system: "You are a helpful assistant.",
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "anthropic key validation failed";
      return errorJson(400, `anthropic_api_key rejected: ${msg}`, "anthropic_api_key");
    }
    anthropic_api_key = newKeyRaw;
  }

  // --- Persist updated config ---
  const updated: StoredConfig = {
    ...config,
    display_name,
    headline,
    cv_markdown,
    anthropic_api_key,
    daily_budget_usd,
    location,
    linkedin_url,
    github_url,
    pdf_cv_url,
    max_msgs_per_hour,
    model,
    accent_color,
  };

  await env.STATE.put("config", JSON.stringify(updated));

  // --- Return success HTML (API key is intentionally not included) ---
  const html = renderAdminForm({
    email: authResult.identity.email,
    prefill: {
      display_name: updated.display_name,
      headline: updated.headline,
      cv_markdown: updated.cv_markdown,
      daily_budget_usd: updated.daily_budget_usd,
      location: updated.location,
      linkedin_url: updated.linkedin_url,
      github_url: updated.github_url,
      pdf_cv_url: updated.pdf_cv_url,
      max_msgs_per_hour: updated.max_msgs_per_hour,
      model: updated.model,
      accent_color: updated.accent_color,
    },
  });

  return new Response(html, { status: 200, headers: HTML_HEADERS });
}
