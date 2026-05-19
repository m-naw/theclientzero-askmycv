/**
 * Login route handlers.
 *
 * GET  /login — render login form (HTML, no auth required).
 * POST /login — verify password, issue session cookie, 303 redirect to next or /.
 *
 * The Anthropic API key is never read or returned here.
 * The admin plaintext password is never persisted — only compared against
 * the stored bcrypt hash and then discarded.
 *
 * next-param round-trip: GET /login?next=<encoded-path> → form includes hidden
 * <input name="next"> → POST reads it, sanitizes via sanitizeNext, redirects.
 */

import { verifyPassword } from "../auth/password";
import { createSessionCookie } from "../auth/session";
import { ADMIN_PASSWORD_HASH_KEY } from "../types/auth";
import { checkLoginRateLimit } from "../abuse/rate-limit";
import { renderLoginForm } from "../views/login";
import { sanitizeNext } from "../lib/redirect";
import type { Env } from "../env";

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" } as const;

const MAX_BODY_BYTES = 100 * 1024; // 100 KiB

// ---------------------------------------------------------------------------
// GET /login
// ---------------------------------------------------------------------------

export async function handleLoginGet(
  request: Request,
  _env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const rawNext = url.searchParams.get("next");
  const next = rawNext !== null ? sanitizeNext(rawNext) : undefined;

  return new Response(renderLoginForm({ next }), {
    status: 200,
    headers: HTML_HEADERS,
  });
}

// ---------------------------------------------------------------------------
// POST /login
// ---------------------------------------------------------------------------

export async function handleLoginPost(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  // Rate limit by client IP
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const { allowed } = await checkLoginRateLimit(env.STATE, ip);
  if (!allowed) {
    // Emit structured auth_decision log for rate-limit hit
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ event: "auth_decision", outcome: "rate_limit_hit", ip, timestamp: new Date().toISOString() }));
    return new Response("Too many login attempts", { status: 429 });
  }

  // Body-size guard
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > MAX_BODY_BYTES) {
    return new Response("Request body too large", { status: 413 });
  }

  // Parse body — accept form-encoded (standard HTML form POST)
  let adminPassword = "";
  let nextFromBody: string | null = null;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = (await request.json()) as Record<string, unknown>;
      adminPassword = typeof body.admin_password === "string" ? body.admin_password : "";
      nextFromBody = typeof body.next === "string" ? body.next : null;
    } catch {
      return new Response("Invalid JSON body", { status: 400 });
    }
  } else {
    try {
      const form = await request.formData();
      const v = form.get("admin_password");
      adminPassword = typeof v === "string" ? v : "";
      const n = form.get("next");
      nextFromBody = typeof n === "string" ? n : null;
    } catch {
      return new Response("Invalid form body", { status: 400 });
    }
  }

  // Fallback: read next from query param if not in body
  const url = new URL(request.url);
  const rawNext = nextFromBody ?? url.searchParams.get("next");

  // Load stored hash from KV
  const storedHash = await env.STATE.get(ADMIN_PASSWORD_HASH_KEY);
  if (storedHash === null) {
    // Emit structured auth_decision log
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ event: "auth_decision", outcome: "login_fail", reason: "no_hash_configured", ip, timestamp: new Date().toISOString() }));
    return new Response("Admin password not configured", { status: 401 });
  }

  // Verify password against stored bcrypt hash
  const valid = await verifyPassword(adminPassword, storedHash);

  if (!valid) {
    // Timing-safe delay to slow brute force
    await new Promise((r) => setTimeout(r, 500));

    // Emit structured auth_decision log for failed login
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ event: "auth_decision", outcome: "login_fail", reason: "wrong_password", ip, timestamp: new Date().toISOString() }));

    // Re-render login form with error message (401 with form)
    const safeNext = rawNext !== null ? sanitizeNext(rawNext) : undefined;
    return new Response(renderLoginForm({ error: "Invalid password. Please try again.", next: safeNext !== "/" ? safeNext : undefined }), {
      status: 401,
      headers: HTML_HEADERS,
    });
  }

  // Emit structured auth_decision log for successful login
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ event: "auth_decision", outcome: "login_success", ip, timestamp: new Date().toISOString() }));

  // Issue session cookie
  const setCookie = await createSessionCookie(env.STATE);

  // Sanitize and use next param, fallback to /
  const safeNext = sanitizeNext(rawNext);

  return new Response(null, {
    status: 303,
    headers: {
      Location: safeNext,
      "Set-Cookie": setCookie,
    },
  });
}
