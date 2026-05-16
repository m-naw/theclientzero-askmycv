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
import { handlePostSetup, handleGetSetup } from "./routes/setup";
import { handlePostChat } from "./routes/chat";
import { handleAdminGet, handleAdminSave } from "./routes/admin";
import type { Env } from "./env";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "GET") {
      return handleRoot(request, env, ctx);
    }

    if (url.pathname === "/setup" && request.method === "GET") {
      return handleGetSetup(request, env, ctx);
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
      return handleAdminGet(request, env, ctx);
    }

    if (url.pathname === "/admin/save" && request.method === "POST") {
      return handleAdminSave(request, env, ctx);
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
