/**
 * Central response builders with baseline security headers (SDD-5).
 *
 * Every HTTP response that leaves the worker should be built with one of these
 * helpers so a single audit can confirm the security-header baseline is in
 * place. Bare `new Response(...)` returns are forbidden in route handlers.
 *
 * Headers set on every response:
 *
 *   X-Content-Type-Options: nosniff
 *     Stops browsers from sniffing a non-HTML body as HTML.
 *
 *   X-Frame-Options: DENY
 *     Belt-and-braces complement to CSP frame-ancestors for older browsers.
 *
 *   Referrer-Policy: no-referrer
 *     The setup/admin pages contain a target="_blank" link to
 *     platform.claude.com (the API-key hint). Without this header the Referer
 *     would leak the visitor's host (and potentially the setup token) to a
 *     third party.
 *
 *   Content-Security-Policy:
 *     default-src 'self'        — block off-origin script/img/iframe/etc.
 *     style-src 'self' 'unsafe-inline' https://fonts.googleapis.com
 *                               — views inject inline <style> blocks via
 *                                 renderLayout; eliminating 'unsafe-inline'
 *                                 here would require extracting every style
 *                                 block to an external stylesheet (out of
 *                                 scope for SDD-5).
 *     font-src https://fonts.gstatic.com — webfont source.
 *     script-src 'self' 'unsafe-inline'
 *                               — same trade-off as style-src: layout.ts
 *                                 renders inline <script> tags for theme
 *                                 boot + chat client. Eliminating
 *                                 'unsafe-inline' for scripts would require
 *                                 extracting them to same-origin .js files,
 *                                 which is a follow-up refactor, not a
 *                                 defense-in-depth fix.
 *     connect-src 'self'        — XHR/fetch/EventSource may only hit our
 *                                 origin (the /chat SSE call is same-origin).
 *     frame-ancestors 'none'    — no other origin may embed our pages
 *                                 (clickjacking defense for the chat page).
 *     base-uri 'self'           — block <base href="..."> injection.
 *     form-action 'self'        — POSTs from our forms may only target us.
 */

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; " +
    "script-src 'self' 'unsafe-inline'; " +
    "connect-src 'self'; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'",
};

/**
 * Merge baseline security headers with a Content-Type and any caller-supplied
 * init.headers. Caller-supplied headers win, so a caller can still emit
 * Set-Cookie, Location, Retry-After, or override Content-Type for special
 * cases (e.g. SSE).
 *
 * Set-Cookie multiplicity:
 *   The Fetch spec collapses repeated header names when constructing
 *   `new Headers(record)` from a plain object, which would silently drop
 *   additional Set-Cookie values in multi-cookie flows (logout + re-login).
 *   To emit multiple Set-Cookie values, callers MUST pass init.headers as
 *   an Array of tuples:
 *
 *     init: { headers: [['Set-Cookie', 'a=1'], ['Set-Cookie', 'b=2']] }
 *
 *   A `Headers` instance is also supported via `getSetCookie()`. Passing a
 *   `Record<string,string>` only supports a single Set-Cookie value.
 */
function mergeHeaders(contentType: string, init?: ResponseInit): Headers {
  const headers = new Headers();
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    headers.set(k, v);
  }
  headers.set("Content-Type", contentType);

  const supplied = init?.headers;
  if (!supplied) return headers;

  const isSetCookie = (k: string) => k.toLowerCase() === "set-cookie";

  if (Array.isArray(supplied)) {
    // Canonical multi-Set-Cookie form: Array<[name, value]>.
    for (const [key, value] of supplied) {
      if (isSetCookie(key)) {
        headers.append("Set-Cookie", value);
      } else {
        headers.set(key, value);
      }
    }
  } else if (supplied instanceof Headers) {
    // Headers preserves Set-Cookie multiplicity via getSetCookie().
    const cookies =
      typeof supplied.getSetCookie === "function"
        ? supplied.getSetCookie()
        : [];
    for (const c of cookies) headers.append("Set-Cookie", c);
    supplied.forEach((value, key) => {
      if (!isSetCookie(key)) headers.set(key, value);
    });
  } else {
    // Record<string,string> — Set-Cookie can only carry a single value here.
    for (const [key, value] of Object.entries(supplied)) {
      if (isSetCookie(key)) {
        headers.append("Set-Cookie", value);
      } else {
        headers.set(key, value);
      }
    }
  }

  return headers;
}

/** HTML response with text/html; charset=utf-8 + security headers. */
export function htmlResponse(body: string, init?: ResponseInit): Response {
  return new Response(body, {
    status: init?.status,
    statusText: init?.statusText,
    headers: mergeHeaders("text/html; charset=utf-8", init),
  });
}

/** Plain-text response with text/plain; charset=utf-8 + security headers. */
export function textResponse(body: string | null, init?: ResponseInit): Response {
  return new Response(body, {
    status: init?.status,
    statusText: init?.statusText,
    headers: mergeHeaders("text/plain; charset=utf-8", init),
  });
}

/** JSON response — `body` is JSON-stringified by this helper. */
export function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status,
    statusText: init?.statusText,
    headers: mergeHeaders("application/json; charset=utf-8", init),
  });
}

/**
 * SSE response — keeps text/event-stream + caller-supplied SSE headers
 * (cache-control, x-accel-buffering) but still rides the security baseline.
 * Used by POST /chat. The streaming body is passed through unchanged.
 */
export function sseResponse(body: BodyInit | null, init?: ResponseInit): Response {
  return new Response(body, {
    status: init?.status,
    statusText: init?.statusText,
    headers: mergeHeaders("text/event-stream; charset=utf-8", init),
  });
}
