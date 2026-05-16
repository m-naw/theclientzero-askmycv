/**
 * Extract a Cloudflare Access JWT from an incoming request.
 *
 * Access injects the JWT into the `Cf-Access-Jwt-Assertion` request header
 * on protected paths, AND sets a `CF_Authorization` cookie on the hostname
 * that persists across paths. On `*.workers.dev` deployments and in some
 * Access app configurations, the header is not always present on every
 * gated request even when the user is authenticated. Reading the cookie as
 * a fallback lets the worker accept the same JWT regardless of which
 * channel Access chose, without weakening verification — the cookie value
 * is still cryptographically verified downstream.
 */
export function readAccessJwt(request: Request): string {
  const header = request.headers.get("cf-access-jwt-assertion");
  if (header && header.length > 0) return header;

  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return "";

  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === "CF_Authorization") {
      return part.slice(eq + 1).trim();
    }
  }
  return "";
}
