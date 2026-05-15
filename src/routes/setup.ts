/**
 * POST /setup — handles the first-time setup form submission.
 *
 * Gate order (must remain in this order):
 *   1. JWT cryptographically verified via verifyAccessJwt → 403 on failure.
 *   2. Config already in KV → 403 (no re-setup).
 *   3. setup_window_start present AND > 30 min old → expired page.
 *   4. Required-field presence and bounds → 400.
 *   5. Anthropic key live test call → 400 on rejection.
 *   6. Persist StoredConfig to KV.
 *   7. 200 HTML with worker URL + admin URL.
 *
 * The Anthropic key is read only from the submitted form body, stored
 * only in KV (under the `config` key), and never echoed back into the
 * 200 HTML response.
 */

import Anthropic from "@anthropic-ai/sdk";
import { SETUP_WINDOW_MS } from "../state/machine";
import {
  REQUIRED_SETUP_FIELDS,
  CV_MIN_LENGTH,
  CV_MAX_LENGTH,
  type StoredConfig,
  type RequiredSetupField,
} from "../types/config";
import { verifyAccessJwt } from "../auth/access";
import { resolveJwksSource } from "./jwks-source";
import { renderExpiredSetup } from "../views";
import { escapeHtml } from "../views/escape";
import type { Env } from "../env";

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" } as const;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

function errorResponse(status: number, error: string, field?: string): Response {
  return new Response(JSON.stringify({ error, field }), {
    status,
    headers: JSON_HEADERS,
  });
}

interface ParsedFormBody {
  display_name: string;
  headline: string;
  cv_markdown: string;
  anthropic_api_key: string;
  daily_budget_usd: number;
}

function readField(form: FormData, name: string): string {
  const v = form.get(name);
  if (typeof v !== "string") return "";
  return v;
}

export async function handlePostSetup(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  // ----- 1. JWT --------------------------------------------------------
  const headerToken = request.headers.get("cf-access-jwt-assertion") ?? "";
  if (headerToken.length === 0) {
    return errorResponse(403, "missing cf-access-jwt-assertion header");
  }

  const source = await resolveJwksSource(env);
  let identity;
  try {
    identity = await verifyAccessJwt(headerToken, source);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "jwt verification failed";
    return errorResponse(403, `jwt verification failed: ${msg}`);
  }

  // ----- 2. config-exists gate ----------------------------------------
  const existing = await env.STATE.get("config");
  if (existing !== null) {
    return errorResponse(403, "already configured");
  }

  // ----- 3. window-expired gate ---------------------------------------
  const windowRaw = await env.STATE.get("setup_window_start");
  if (windowRaw !== null) {
    const startMs = Number(windowRaw);
    if (Number.isFinite(startMs) && Date.now() - startMs > SETUP_WINDOW_MS) {
      // Spec asks for the expired page when the owner attempts setup
      // after the window. Return 403 status with the expired page body
      // so HTTP semantics still indicate refusal.
      return new Response(renderExpiredSetup({ setupWindowStart: String(startMs) }), {
        status: 403,
        headers: HTML_HEADERS,
      });
    }
  }

  // ----- 4. form parsing + presence + bounds --------------------------
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

  // ----- 6. persist StoredConfig --------------------------------------
  const config: StoredConfig = {
    display_name: parsed.display_name as string,
    headline: parsed.headline as string,
    cv_markdown: parsed.cv_markdown as string,
    anthropic_api_key: apiKey,
    daily_budget_usd: parsed.daily_budget_usd as number,
    access_email: identity.email,
    access_aud: identity.aud,
    access_team_domain: identity.team_domain,
    setup_timestamp: Date.now(),
  };

  await env.STATE.put("config", JSON.stringify(config));

  // ----- 7. success HTML ----------------------------------------------
  const workerUrl = new URL(request.url);
  const publicUrl = `${workerUrl.protocol}//${workerUrl.host}/`;
  const adminUrl = `${workerUrl.protocol}//${workerUrl.host}/admin`;

  // IMPORTANT: never include the Anthropic key in this body.
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Setup complete — askmycv</title></head>
<body>
  <h1>Setup complete</h1>
  <p>Your CV chat is live at <a href="${escapeHtml(publicUrl)}">${escapeHtml(publicUrl)}</a>.</p>
  <p>Manage your configuration at <a href="${escapeHtml(adminUrl)}">/admin</a>.</p>
</body>
</html>`;

  return new Response(html, { status: 200, headers: HTML_HEADERS });
}
