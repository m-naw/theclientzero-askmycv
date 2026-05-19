/**
 * URL validation helpers (SDD-4).
 *
 * `isSafeUrl` is used at the input boundary (POST /setup and POST /admin/save)
 * to reject any value that, when rendered as an `<a href="...">`, could
 * execute attacker-controlled script in a visitor's session.
 *
 * Accept rules:
 *   - Empty string (after trim) — caller treats this as "field absent".
 *   - `http://...` or `https://...` (case-insensitive scheme).
 *
 * Reject everything else, including:
 *   - `javascript:` / `data:` / `vbscript:` / `file:` and any other scheme
 *   - protocol-relative `//host`
 *   - bare hostnames / relative paths
 *   - leading whitespace followed by a scheme (e.g. " javascript:...")
 *
 * Rejection is the default — only the two-prefix allow-list permits a value.
 *
 * Note: output-side escaping (escapeHtml) does NOT block dangerous schemes —
 * it only encodes `<>&"'`. A `javascript:alert(1)` href survives escapeHtml
 * intact and fires on click. The fix must live at the input boundary so the
 * dangerous value never reaches KV in the first place.
 */
export function isSafeUrl(value: string): boolean {
  // Treat null/undefined as empty (caller never passes them today, but
  // defending against drift is cheap).
  if (typeof value !== "string") return false;

  // Empty (or whitespace-only) → accept; caller stores it as "absent".
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;

  // If trim changed the value, the original had leading/trailing whitespace.
  // Reject — a stored "  javascript:..." value would render as
  // <a href="  javascript:..."> which still executes in browsers that tolerate
  // leading whitespace in href schemes.
  if (trimmed !== value) return false;

  // Reject any embedded whitespace (newline, tab, CR, space, etc.). Legitimate
  // http(s) URLs never contain whitespace; an embedded `\n` could otherwise
  // sneak a `javascript:` payload past the startsWith() prefix check and land
  // in href= where some parsers tolerate the newline.
  if (/\s/.test(trimmed)) return false;

  // Allow-list: only http:// and https:// (case-insensitive scheme).
  const lower = trimmed.toLowerCase();
  return lower.startsWith("http://") || lower.startsWith("https://");
}
