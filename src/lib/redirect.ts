/**
 * Safe redirect helper.
 *
 * sanitizeNext validates a raw `next` query-param value before using it as a
 * post-login redirect destination. Only same-origin relative paths are accepted.
 */

const MAX_NEXT_LENGTH = 512;

/**
 * Accept a raw `next` string (from a query param or form field) and return a
 * safe relative path, or "/" as a fallback.
 *
 * Acceptance rules:
 *   - Must start with "/"
 *   - Must NOT start with "//" (protocol-relative URL)
 *   - Must NOT start with "/\" (backslash-relative, IE quirk)
 *   - Must NOT contain a scheme colon (":" before first "/") — blocks "javascript:", "https:", etc.
 *   - URL-decoded once before validation (guards against encoded bypasses)
 *   - Length capped at 512 characters (before and after decoding)
 */
export function sanitizeNext(raw: string | null | undefined): string {
  if (raw == null || raw.length === 0) {
    return "/";
  }

  // Cap raw length early — don't bother decoding overlong input.
  if (raw.length > MAX_NEXT_LENGTH) {
    return "/";
  }

  // URL-decode once to catch encoded bypasses like %2F%2Fevil.com
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return "/";
  }

  // Cap decoded length as well.
  if (decoded.length > MAX_NEXT_LENGTH) {
    return "/";
  }

  // Must start with "/"
  if (!decoded.startsWith("/")) {
    return "/";
  }

  // Reject "//" (protocol-relative) and "/\" (IE backslash trick)
  if (decoded.startsWith("//") || decoded.startsWith("/\\")) {
    return "/";
  }

  // Reject anything that has a scheme colon before any path separator.
  // "javascript:alert(1)" starts with "/" when encoded tricks are used —
  // catch it here by looking for ":" in the first segment.
  const firstSegmentEnd = decoded.indexOf("/", 1);
  const firstSegment =
    firstSegmentEnd === -1 ? decoded.slice(1) : decoded.slice(1, firstSegmentEnd);
  if (firstSegment.includes(":")) {
    return "/";
  }

  return decoded;
}
