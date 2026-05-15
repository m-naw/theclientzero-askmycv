import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./env";

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
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

    if (url.pathname === "/admin" && request.method === "GET") {
      return handleAdmin(request, env);
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleAdmin(request: Request, env: Env): Promise<Response> {
  const jwt = request.headers.get("CF-Access-JWT-Assertion");
  if (!jwt) {
    return new Response("missing access jwt", { status: 403 });
  }

  const jwksUrl = env.ACCESS_JWKS_URL_OVERRIDE && env.ACCESS_JWKS_URL_OVERRIDE.length > 0
    ? env.ACCESS_JWKS_URL_OVERRIDE
    : "https://placeholder.cloudflareaccess.com/cdn-cgi/access/certs";

  // Per-request JWKS client so the in-memory key cache does not leak
  // across tests (the cache is closure-scoped to this call).
  const jwks = createRemoteJWKSet(new URL(jwksUrl));

  try {
    const { payload } = await jwtVerify(jwt, jwks);
    const email = typeof payload.email === "string" ? payload.email : "";
    return new Response(JSON.stringify({ email }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return new Response("access denied", { status: 403 });
  }
}
