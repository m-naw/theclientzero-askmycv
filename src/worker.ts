/**
 * Worker entry point. Routes requests by method + path.
 *
 * Public routes (no auth): GET /, GET /health, POST /chat.
 * Owner routes (Access JWT required): GET /setup-not-actually,
 * POST /setup, GET /admin, POST /admin/save.
 *
 * Detailed auth is enforced in the route handlers — this file only
 * dispatches.
 */

import { handleRoot } from "./routes/index";
import { handlePostSetup } from "./routes/setup";
import { handlePostChat } from "./routes/chat";
import { resolveJwksSource } from "./routes/jwks-source";
import { verifyAccessJwt } from "./auth/access";
import type { Env } from "./env";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

async function handleAdmin(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) {
    return new Response(JSON.stringify({ error: "missing jwt" }), {
      status: 403,
      headers: JSON_HEADERS,
    });
  }
  const source = await resolveJwksSource(env);
  let identity;
  try {
    identity = await verifyAccessJwt(token, source);
  } catch {
    return new Response(JSON.stringify({ error: "jwt verification failed" }), {
      status: 403,
      headers: JSON_HEADERS,
    });
  }
  return new Response(JSON.stringify({ email: identity.email }), {
    status: 200,
    headers: JSON_HEADERS,
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "GET") {
      return handleRoot(request, env, ctx);
    }

    if (url.pathname === "/setup" && request.method === "POST") {
      return handlePostSetup(request, env, ctx);
    }

    if (url.pathname === "/chat" && request.method === "POST") {
      return handlePostChat(request, env, ctx);
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return new Response("ok", { status: 200 });
    }

    if (url.pathname === "/admin" && request.method === "GET") {
      return handleAdmin(request, env, ctx);
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
