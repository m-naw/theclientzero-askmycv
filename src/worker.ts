import type { Env } from "./env";

export default {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "GET") {
      return new Response("askmycv: foundation placeholder", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return new Response("ok", { status: 200 });
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
