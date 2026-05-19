/**
 * POST /setup — handles the first-time setup form submission.
 * GET  /setup — renders the setup form (no JWT required).
 *
 * Gate order for POST (must remain in this order):
 *   1. Config already in KV → 403 (no re-setup).
   *   2. setup_window_start present AND expired → 403 JSON {error, expired_at, recovery_summary}.
 *   3. Required-field presence and bounds → 400.
 *   4. admin_password length 12..128 → 400 on violation.
 *   5. Anthropic key live test call → 400 on rejection.
 *   6. bcrypt-hash admin_password, generate cookie_signing_secret, persist StoredConfig.
 *   7. 303 redirect to /admin with Set-Cookie.
 *
 * CF Access JWT is OPTIONAL progressive enhancement:
 *   - If cf-access-jwt-assertion header (or CF_Authorization cookie) is present,
 *     it is verified and its claims (email, aud, team_domain) are stored in the
 *     config, enabling CF Access layer on /admin.
 *   - If absent, setup proceeds without Access claims and admin auth uses
 *     the admin password + session cookie only.
 *
 * The Anthropic key is read only from the submitted form body, stored
 * only in KV (under the `config` key), and never echoed back into any
 * HTML response.
 */

import Anthropic from "@anthropic-ai/sdk";
import { SETUP_WINDOW_MS } from "../state/machine";
import {
  REQUIRED_SETUP_FIELDS,
  CV_MIN_LENGTH,
  CV_MAX_LENGTH,
  ALLOWED_MODELS,
  DEFAULT_MODEL,
  type StoredConfig,
  type RequiredSetupField,
} from "../types/config";
import { verifyAccessJwt } from "../auth/access";
import { resolveJwksSource } from "./jwks-source";
import { renderExpiredSetup, renderSetupForm } from "../views";
import { readAccessJwt } from "../auth/access-token";
import { hashPassword } from "../auth/password";
import { createSessionCookie } from "../auth/session";
import { ADMIN_PASSWORD_HASH_KEY } from "../types/auth";
import type { Env } from "../env";

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" } as const;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

const MAX_BODY_BYTES = 100 * 1024; // 100 KiB

/** Minimum and maximum length for admin_password. */
const ADMIN_PASSWORD_MIN = 12;
const ADMIN_PASSWORD_MAX = 128;

function errorResponse(status: number, error: string, field?: string): Response {
  return new Response(JSON.stringify({ error, field }), {
    status,
    headers: JSON_HEADERS,
  });
}

interface ParsedFormBody {
  display_name: string;
  headline: string;
  cv_markdown: string; // max 50_000 chars (CV_MAX_LENGTH)
  anthropic_api_key: string;
  daily_budget_usd: number;
}

function readField(form: FormData, name: string): string {
  const v = form.get(name);
  if (typeof v !== "string") return "";
  return v;
}

/**
 * Attempt to verify an optional CF Access JWT from the request.
 * Returns the identity triple on success, or null if no JWT is present.
 * Throws if a JWT is present but verification fails.
 */
async function tryVerifyAccessJwt(
  request: Request,
  env: Env,
): Promise<{ email: string; aud: string; team_domain: string } | null> {
  const token = readAccessJwt(request);
  if (token.length === 0) {
    return null;
  }
  const source = await resolveJwksSource(env);
  const identity = await verifyAccessJwt(token, source);
  return {
    email: identity.email,
    aud: identity.aud,
    team_domain: identity.team_domain,
  };
}

export async function handlePostSetup(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  // ----- 1. config-exists gate ----------------------------------------
  const existing = await env.STATE.get("config");
  if (existing !== null) {
    return errorResponse(403, "already configured");
  }

  // ----- 2. window-expired gate ---------------------------------------
  const windowRaw = await env.STATE.get("setup_window_start");
  if (windowRaw !== null) {
    const startMs = Number(windowRaw);
    if (Number.isFinite(startMs) && Date.now() - startMs > SETUP_WINDOW_MS) {
      const expiredAt = new Date(startMs + SETUP_WINDOW_MS).toISOString();
      return new Response(
        JSON.stringify({
          error: "setup window expired",
          expired_at: expiredAt,
          recovery_summary:
            "Delete the setup_window_start key from the STATE KV namespace at dash.cloudflare.com to open a new 10-minute setup window.",
        }),
        {
          status: 403,
          headers: JSON_HEADERS,
        },
      );
    }
  }

  // ----- 2b. body-size guard ------------------------------------------
  const contentLengthSetup = request.headers.get("content-length");
  if (contentLengthSetup !== null && Number(contentLengthSetup) > MAX_BODY_BYTES) {
    return errorResponse(413, "request body too large");
  }

  // ----- 3. form parsing + presence + bounds --------------------------
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(400, "invalid form body");
  }

  const parsed: Partial<ParsedFormBody> = {};
  for (const field of REQUIRED_SETUP_FIELDS) {
    const value = readField(form, field);
    if (value === "") {
      return errorResponse(400, `missing required field: ${field}`, field);
    }
    if (field === "daily_budget_usd") {
      const num = Number(value);
      if (!Number.isFinite(num) || num <= 0) {
        return errorResponse(400, "daily_budget_usd must be a positive number", "daily_budget_usd");
      }
      parsed.daily_budget_usd = num;
    } else {
      (parsed as Record<RequiredSetupField, string | number>)[field] = value;
    }
  }

  const cv = parsed.cv_markdown ?? "";
  if (cv.length < CV_MIN_LENGTH || cv.length > CV_MAX_LENGTH) {
    return errorResponse(
      400,
      `cv_markdown must be between ${CV_MIN_LENGTH} and ${CV_MAX_LENGTH} characters`,
      "cv_markdown",
    );
  }

  // ----- 4. admin_password validation ----------------------------------
  const adminPassword = readField(form, "admin_password");
  if (adminPassword.length < ADMIN_PASSWORD_MIN || adminPassword.length > ADMIN_PASSWORD_MAX) {
    return errorResponse(
      400,
      `admin_password must be between ${ADMIN_PASSWORD_MIN} and ${ADMIN_PASSWORD_MAX} characters`,
      "admin_password",
    );
  }

  // ----- 4b. Optional fields: model + accent_color --------------------
  const modelRaw = readField(form, "model");
  const model = (ALLOWED_MODELS as readonly string[]).includes(modelRaw)
    ? modelRaw
    : DEFAULT_MODEL;
  const accentColor = readField(form, "accent_color").trim() || undefined;

  // ----- 5. Anthropic test call ---------------------------------------
  const apiKey = parsed.anthropic_api_key as string;
  try {
    const clientOpts: ConstructorParameters<typeof Anthropic>[0] = {
      apiKey,
      dangerouslyAllowBrowser: true,
    };
    if (env.ANTHROPIC_BASE_URL && env.ANTHROPIC_BASE_URL.length > 0) {
      clientOpts.baseURL = env.ANTHROPIC_BASE_URL;
    }
    const client = new Anthropic(clientOpts);
    await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      system: 'You are a helpful assistant.',
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "anthropic key validation failed";
    return errorResponse(400, `anthropic_api_key rejected: ${msg}`, "anthropic_api_key");
  }

  // ----- optional CF Access JWT verification --------------------------
  // If a JWT is present, verify it and capture claims for CF Access integration.
  // If absent, proceed without CF Access (password-only admin auth mode).
  let cfIdentity: { email: string; aud: string; team_domain: string } | null = null;
  try {
    cfIdentity = await tryVerifyAccessJwt(request, env);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "jwt verification failed";
    return errorResponse(403, `jwt verification failed: ${msg}`);
  }

  // ----- 6. hash admin_password + generate cookie_signing_secret ------
  const adminPasswordHash = await hashPassword(adminPassword);

  // Generate 32-byte base64 cookie signing secret
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const cookieSigningSecret = btoa(String.fromCharCode(...secretBytes));

  // ----- 6b. persist StoredConfig + admin credentials to KV ----------
  const config: StoredConfig = {
    display_name: parsed.display_name as string,
    headline: parsed.headline as string,
    cv_markdown: parsed.cv_markdown as string,
    anthropic_api_key: apiKey,
    daily_budget_usd: parsed.daily_budget_usd as number,
    setup_timestamp: Date.now(),
    model,
    accent_color: accentColor,
    ...(cfIdentity
      ? {
          access_email: cfIdentity.email,
          access_aud: cfIdentity.aud,
          access_team_domain: cfIdentity.team_domain,
        }
      : {}),
  };

  // Persist config and admin credentials atomically
  await env.STATE.put("config", JSON.stringify(config));
  await env.STATE.put(ADMIN_PASSWORD_HASH_KEY, adminPasswordHash);
  await env.STATE.put("cookie_signing_secret", cookieSigningSecret);

  // ----- 7. issue session cookie + 303 redirect to / ------------------
  const sessionCookieHeader = await createSessionCookie(env.STATE);

  const workerUrl = new URL(request.url);
  const rootUrl = `${workerUrl.protocol}//${workerUrl.host}/`;

  return new Response(null, {
    status: 303,
    headers: {
      "Location": rootUrl,
      "Set-Cookie": sessionCookieHeader,
    },
  });
}

/**
 * GET /setup — renders the setup form. CF Access JWT is optional.
 * If config already exists, redirect to /admin.
 * If setup window has expired, show expired page.
 */
export async function handleGetSetup(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const existing = await env.STATE.get("config");
  if (existing !== null) {
    const url = new URL(request.url);
    return Response.redirect(`${url.protocol}//${url.host}/admin`, 302);
  }

  const windowRaw = await env.STATE.get("setup_window_start");
  if (windowRaw !== null) {
    const startMs = Number(windowRaw);
    if (Number.isFinite(startMs) && Date.now() - startMs > SETUP_WINDOW_MS) {
      return new Response(renderExpiredSetup({ setupWindowStart: String(startMs) }), {
        status: 403,
        headers: HTML_HEADERS,
      });
    }
  }

  // Optional: try to extract email from CF Access JWT for personalised greeting
  let email: string | undefined;
  try {
    const cfIdentity = await tryVerifyAccessJwt(request, env);
    if (cfIdentity) {
      email = cfIdentity.email;
    }
  } catch {
    // JWT present but invalid — ignore for GET (don't block the form render)
  }

  const url = new URL(request.url);
  const resetBanner = url.searchParams.get("reset") === "1"
    ? "Configuration has been reset. Please set up askmycv again."
    : undefined;

  return new Response(renderSetupForm({ email, resetBanner }), {
    status: 200,
    headers: HTML_HEADERS,
  });
}

