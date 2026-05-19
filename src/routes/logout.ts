/**
 * Logout route handler.
 *
 * GET /logout — clear the session cookie and rotate the cookie_signing_secret
 *               so a stolen/cached cookie cannot be reused. 303 → /login.
 * POST /logout — same behaviour (some browsers send POST for logout buttons).
 *
 * Rotating the signing secret on logout invalidates every previously issued
 * session token, not just the one being cleared. This is defence in depth:
 * if a session cookie was intercepted, it becomes useless the moment the
 * operator logs out.
 */

import { clearSessionCookie } from "../auth/session";
import type { Env } from "../env";

/** KV key under which the cookie-signing secret is stored. */
const SIGNING_SECRET_KEY = "cookie_signing_secret";

/**
 * Handle GET or POST /logout. Always clears the cookie + rotates the secret,
 * then 303-redirects to /login with a flash banner via query param.
 */
export async function handleLogout(
  _request: Request,
  env: Env,
): Promise<Response> {
  // Rotate the signing secret so any prior session token becomes invalid.
  // The next request that needs to verify a session will see no secret
  // and (per verifySessionCookie) return null; the next login call will
  // regenerate the secret on-demand via getOrCreateSigningSecret.
  await env.STATE.delete(SIGNING_SECRET_KEY);

  // Clear the session cookie on the operator's browser.
  const setCookie = clearSessionCookie();

  return new Response(null, {
    status: 303,
    headers: {
      "Set-Cookie": setCookie,
      Location: "/login?logged_out=1",
    },
  });
}
