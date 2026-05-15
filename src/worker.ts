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
import type { Env } from "./env";

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "GET") {
      return handleRoot(request, env);
    }

    if (url.pathname === "/setup" && request.method === "POST") {
      return handlePostSetup(request, env);
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return new Response("ok", { status: 200 });
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
