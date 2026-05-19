/**
 * URL validation helpers (SDD-4).
 *
 * `isSafeUrl` is the legacy boolean check used in tests. `normalizeUrl` is the
 * preferred input-boundary helper: it accepts bare hostnames (e.g.
 * "linkedin.com/in/jane") and prepends "https://" so users don't have to type
 * a scheme, while still rejecting any value that would render as a dangerous
 * <a href="..."> (javascript:, data:, vbscript:, protocol-relative //, values
 * with embedded whitespace, etc.).
 *
 * Reject rules (apply to both helpers):
 *   - Value with leading/trailing whitespace.
 *   - Value with embedded whitespace (space, tab, newline, CR).
 *   - Value starting with "/" (protocol-relative or absolute path).
 *   - Value with any scheme other than http:// or https://.
 *
 * Empty string is accepted; caller treats it as "field absent".
 */

interface NormalizeResult {
  ok: boolean;
  /** Canonical form to persist. Empty string when input was empty. */
  value: string;
}

export function normalizeUrl(raw: string): NormalizeResult {
  if (typeof raw !== "string") return { ok: false, value: "" };

  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, value: "" };
  if (trimmed !== raw) return { ok: false, value: "" };
  if (/\s/.test(trimmed)) return { ok: false, value: "" };
  if (trimmed.startsWith("/")) return { ok: false, value: "" };

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    return { ok: true, value: trimmed };
  }

  // Reject any value that already declares a non-http(s) scheme.
  // RFC-3986 scheme syntax: ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) ":"
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return { ok: false, value: "" };
  }

  // Bare host or host+path — assume https://.
  return { ok: true, value: `https://${trimmed}` };
}

export function isSafeUrl(value: string): boolean {
  return normalizeUrl(value).ok;
}
