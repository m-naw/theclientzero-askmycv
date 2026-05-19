/**
 * Admin route handlers.
 *
 * GET /admin — render admin form (requires session cookie + optional CF Access JWT)
 * POST /admin/save — save config (requires session cookie + optional CF Access JWT)
 * POST /admin/login — authenticate with password, issue session cookie
 * POST /admin/reset — verify password, clear all KV config keys
 *
 * The Anthropic API key is never echoed to HTML or included in any response body.
 */

import Anthropic from "@anthropic-ai/sdk";
import { requireAdminAuth } from "../auth/access";
import {
  createSessionCookie,
  clearSessionCookie,
  verifySessionCookie,
} from "../auth/session";
import { verifyPassword, hashPassword } from "../auth/password";
import { ADMIN_PASSWORD_HASH_KEY } from "../types/auth";
import { checkLoginRateLimit } from "../abuse/rate-limit";
import { renderAdminForm } from "../views/admin-form";
import { renderAdminLoginForm } from "../views/admin-login";
import {
  CV_MIN_LENGTH,
  CV_MAX_LENGTH,
  ALLOWED_MODELS,
  DEFAULT_MODEL,
  type StoredConfig,
} from "../types/config";
import type { Env } from "../env";

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" } as const;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

const MAX_BODY_BYTES = 100 * 1024; // 100 KiB

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
 * Returns null when config is absent or unparseable JSON.
 *
 * Uses a lenient parse: full StoredConfig validation is not required here
 * because admin session auth is password-primary. The only field we need
 * at auth time is access_email (to decide whether CF Access JWT is required).
 */
async function loadConfig(env: Env): Promise<StoredConfig | null> {
  const raw = await env.STATE.get("config");
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as StoredConfig;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET /admin
// ---------------------------------------------------------------------------

export async function handleAdminGet(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  // Load config first (404 if null)
  const config = await loadConfig(env);
  if (config === null) {
    return new Response("Not configured", { status: 404 });
  }

  // Auth: session cookie + optional CF Access JWT
  const authError = await requireAdminAuth(request, env, config);
  if (authError !== null) {
    return authError;
  }

  // Render admin form — API key intentionally excluded
  const html = renderAdminForm({
    email: config.access_email,
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
      theme: config.theme,
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
  // Load config first (404 if null)
  const config = await loadConfig(env);
  if (config === null) {
    return new Response("Not configured", { status: 404 });
  }

  // Auth: session cookie + optional CF Access JWT
  const authError = await requireAdminAuth(request, env, config);
  if (authError !== null) {
    return authError;
  }

  // Body-size guard
  const contentLengthSave = request.headers.get("content-length");
  if (contentLengthSave !== null && Number(contentLengthSave) > MAX_BODY_BYTES) {
    return errorJson(413, "request body too large");
  }

  // Parse form body
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
  const themeRaw = readField(form, "theme") || "light";
  const theme: "light" | "dark" = themeRaw === "dark" ? "dark" : "light";

  // Optional new admin password — only update if non-empty and meets length requirement
  const newAdminPasswordRaw = readField(form, "new_admin_password");
  let newAdminPasswordHash: string | undefined;
  if (newAdminPasswordRaw.length > 0) {
    if (newAdminPasswordRaw.length < 12) {
      return errorJson(400, "new_admin_password must be at least 12 characters", "new_admin_password");
    }
    newAdminPasswordHash = await hashPassword(newAdminPasswordRaw);
  }

  // Anthropic key: blank = preserve existing; non-blank = validate + replace
  const newKeyRaw = readField(form, "anthropic_api_key");
  let anthropic_api_key = config.anthropic_api_key;

  if (newKeyRaw.length > 0) {
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

  // Persist updated config
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
    theme,
  };

  await env.STATE.put("config", JSON.stringify(updated));

  // If a new admin password was provided, update the hash in KV
  if (newAdminPasswordHash !== undefined) {
    await env.STATE.put(ADMIN_PASSWORD_HASH_KEY, newAdminPasswordHash);
  }

  // Return success HTML — API key intentionally excluded
  const html = renderAdminForm({
    email: config.access_email,
    successMessage: "Configuration saved.",
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
      theme: updated.theme,
    },
  });

  return new Response(html, { status: 200, headers: HTML_HEADERS });
}

// ---------------------------------------------------------------------------
// GET /admin/login
// ---------------------------------------------------------------------------

/**
 * Sanitize a `next` redirect target so only same-origin /admin/* paths
 * are honored. Returns the sanitized path or "/admin" as fallback.
 */
function sanitizeNextParam(raw: string | null): string | undefined {
  if (!raw) return undefined;
  // Must start with /admin/ or equal /admin exactly
  if (!raw.startsWith("/admin/") && raw !== "/admin") return undefined;
  // Reject protocol-relative and absolute URLs
  if (raw.startsWith("//")) return undefined;
  // Reject embedded schemes (e.g. javascript:, http:)
  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(raw)) return undefined;
  return raw;
}

export async function handleAdminLoginGet(
  request: Request,
  _env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const next = sanitizeNextParam(url.searchParams.get("next"));
  const html = renderAdminLoginForm({ next });
  return new Response(html, { status: 200, headers: HTML_HEADERS });
}

// ---------------------------------------------------------------------------
// POST /admin/login
// ---------------------------------------------------------------------------

export async function handleAdminLogin(
  request: Request,
  env: Env,
): Promise<Response> {
  // Get client IP (default "unknown" if not present)
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";

  // Check login rate limit
  const { allowed } = await checkLoginRateLimit(env.STATE, ip);
  if (!allowed) {
    return new Response("Too many login attempts", { status: 429 });
  }

  // Body-size guard
  const contentLengthLogin = request.headers.get("content-length");
  if (contentLengthLogin !== null && Number(contentLengthLogin) > MAX_BODY_BYTES) {
    return new Response("request body too large", { status: 413 });
  }

  // Parse body for `password` and `next` fields — accept JSON or form-encoded
  let password = "";
  let nextRaw: string | null = null;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = await request.json() as Record<string, unknown>;
      password = typeof body.password === "string" ? body.password : "";
      nextRaw = typeof body.next === "string" ? body.next : null;
    } catch {
      return new Response("Invalid JSON body", { status: 400 });
    }
  } else {
    try {
      const form = await request.formData();
      const v = form.get("password");
      password = typeof v === "string" ? v : "";
      const n = form.get("next");
      nextRaw = typeof n === "string" ? n : null;
    } catch {
      return new Response("Invalid form body", { status: 400 });
    }
  }

  // Load password hash from KV
  const storedHash = await env.STATE.get(ADMIN_PASSWORD_HASH_KEY);
  if (storedHash === null) {
    return new Response("Admin password not configured", { status: 401 });
  }

  // Verify password
  const valid = await verifyPassword(password, storedHash);
  if (!valid) {
    await new Promise((r) => setTimeout(r, 500));
    const loginHtml = renderAdminLoginForm({ error: "Invalid password", next: sanitizeNextParam(nextRaw) });
    return new Response(loginHtml, { status: 401, headers: HTML_HEADERS });
  }

  // Issue session cookie
  const setCookie = await createSessionCookie(env.STATE);

  // Redirect to validated next param or fallback to /admin
  const redirectTo = sanitizeNextParam(nextRaw) ?? "/admin";
  return new Response(null, {
    status: 303,
    headers: { "Set-Cookie": setCookie, Location: redirectTo },
  });
}

// ---------------------------------------------------------------------------
// POST /admin/reset
// ---------------------------------------------------------------------------

export async function handleAdminReset(
  request: Request,
  env: Env,
): Promise<Response> {
  // Verify session cookie first
  const session = await verifySessionCookie(request, env.STATE);
  if (session === null) {
    return new Response("Login required", { status: 401 });
  }

  // Body-size guard
  const contentLengthReset = request.headers.get("content-length");
  if (contentLengthReset !== null && Number(contentLengthReset) > MAX_BODY_BYTES) {
    return new Response("request body too large", { status: 413 });
  }

  // Parse body for current_password and confirm
  let current_password = "";
  let confirm = "";
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = await request.json() as Record<string, unknown>;
      current_password = typeof body.current_password === "string" ? body.current_password : "";
      confirm = typeof body.confirm === "string" ? body.confirm : "";
    } catch {
      return new Response("Invalid JSON body", { status: 400 });
    }
  } else {
    try {
      const form = await request.formData();
      const cp = form.get("current_password");
      const cf = form.get("confirm");
      current_password = typeof cp === "string" ? cp : "";
      confirm = typeof cf === "string" ? cf : "";
    } catch {
      return new Response("Invalid form body", { status: 400 });
    }
  }

  // Load password hash from KV
  const storedHash = await env.STATE.get(ADMIN_PASSWORD_HASH_KEY);
  if (storedHash === null) {
    return new Response("Admin password not configured", { status: 401 });
  }

  // Helper to re-render admin form with a reset error
  async function renderResetError(resetError: string): Promise<Response> {
    const cfg = await loadConfig(env);
    if (cfg === null) {
      return new Response(resetError, { status: 400 });
    }
    const html = renderAdminForm({
      email: cfg.access_email,
      resetError,
      prefill: {
        display_name: cfg.display_name,
        headline: cfg.headline,
        cv_markdown: cfg.cv_markdown,
        daily_budget_usd: cfg.daily_budget_usd,
        location: cfg.location,
        linkedin_url: cfg.linkedin_url,
        github_url: cfg.github_url,
        pdf_cv_url: cfg.pdf_cv_url,
        max_msgs_per_hour: cfg.max_msgs_per_hour,
        model: cfg.model,
        accent_color: cfg.accent_color,
        theme: cfg.theme,
      },
    });
    return new Response(html, { status: 200, headers: HTML_HEADERS });
  }

  // Verify current password
  const valid = await verifyPassword(current_password, storedHash);
  if (!valid) {
    await new Promise((r) => setTimeout(r, 500));
    return renderResetError("Invalid password");
  }

  // Check confirm string
  if (confirm !== "DELETE ALL CONFIG") {
    return renderResetError("Confirmation string mismatch — type exactly: DELETE ALL CONFIG");
  }

  // Delete KV keys
  await Promise.all([
    env.STATE.delete("config"),
    env.STATE.delete("secrets"),
    env.STATE.delete("admin_password_hash"),
    env.STATE.delete("cookie_signing_secret"),
  ]);

  // Clear session cookie and redirect to /setup?reset=1
  const setCookie = clearSessionCookie();
  return new Response(null, {
    status: 303,
    headers: { "Set-Cookie": setCookie, "Location": "/setup?reset=1" },
  });
}
