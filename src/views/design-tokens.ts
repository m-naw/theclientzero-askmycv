/**
 * Design tokens — the ONLY file in src/views/ allowed to contain raw
 * hex, px, or rem literals. Every other view file references these
 * tokens by name (as CSS `var(--…)` strings) or via the rendered
 * stylesheet returned by `baseStyles()`.
 *
 * A grep-based guard test asserts this discipline; see
 * src/test/views/token-discipline.test.ts.
 */

export const TOKENS = {
  font: {
    sm: "var(--font-sm)",
    base: "var(--font-base)",
    lg: "var(--font-lg)",
    xl: "var(--font-xl)",
    mono: "var(--font-mono)",
  },
  color: {
    bg: "var(--color-bg)",
    surface: "var(--color-surface)",
    text: "var(--color-text)",
    textMuted: "var(--color-text-muted)",
    accent: "var(--color-accent)",
    accentFg: "var(--color-accent-fg)",
    error: "var(--color-error)",
    border: "var(--color-border)",
  },
  space: {
    xs: "var(--space-xs)",
    sm: "var(--space-sm)",
    md: "var(--space-md)",
    lg: "var(--space-lg)",
    xl: "var(--space-xl)",
  },
  radius: {
    sm: "var(--radius-sm)",
    md: "var(--radius-md)",
    lg: "var(--radius-lg)",
  },
  motion: {
    fast: "var(--motion-fast)",
    normal: "var(--motion-normal)",
    typingDuration: "var(--typing-duration)",
    bubbleEnterDuration: "var(--bubble-enter-duration)",
  },
} as const;

const DEFAULT_ACCENT = "#3b5bdb";
const DEFAULT_ACCENT_FG = "#ffffff";

function sanitizeAccent(accent?: string): string {
  if (!accent) return DEFAULT_ACCENT;
  const trimmed = accent.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed) || /^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed;
  }
  return DEFAULT_ACCENT;
}

/**
 * Produces a `:root { --foo: value; }` block (no surrounding <style> tag).
 * Caller wraps in <style>. Optional `accentColor` overrides --color-accent.
 */
export function toCssVars(accentColor?: string): string {
  const accent = sanitizeAccent(accentColor);
  return `:root {
  --font-sm: 0.875rem;
  --font-base: 1rem;
  --font-lg: 1.25rem;
  --font-xl: 2rem;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

  --color-bg: #fafaf7;
  --color-surface: #ffffff;
  --color-text: #1a1a1f;
  --color-text-muted: #6b6b78;
  --color-accent: ${accent};
  --color-accent-fg: ${DEFAULT_ACCENT_FG};
  --color-error: #c92a2a;
  --color-border: #e3e3e8;

  --space-xs: 0.25rem;
  --space-sm: 0.5rem;
  --space-md: 1rem;
  --space-lg: 1.5rem;
  --space-xl: 2.5rem;

  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 16px;

  --motion-fast: 120ms ease-out;
  --motion-normal: 220ms ease-out;
  --typing-duration: 1.4s;
  --bubble-enter-duration: 400ms;
}

[data-theme="dark"] {
  --color-bg: #181613;
  --color-surface: #242220;
  --color-text: #ededeb;
  --color-text-muted: #9b9b94;
  --color-border: #3a3834;
}`;
}

/**
 * Shared stylesheet body (no <style> wrapper). References tokens via
 * `var(--…)` and is the single sink for layout/sizing primitives so
 * page templates remain literal-free.
 */
export function baseStyles(): string {
  return `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: 'Instrument Sans', system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: var(--font-base);
  line-height: 1.5;
  min-height: 100vh;
  min-height: 100dvh;
}
.page { max-width: 720px; margin: 0 auto; padding: var(--space-xl) var(--space-md); min-height: 100vh; min-height: 100dvh; }
h1 { font-size: var(--font-xl); margin: 0 0 var(--space-sm); font-family: 'Fraunces', serif; }
h2 { font-size: var(--font-lg); margin: 0 0 var(--space-sm); font-family: 'Fraunces', serif; }
p  { margin: 0 0 var(--space-md); }
a  { color: var(--color-accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.muted { color: var(--color-text-muted); font-size: var(--font-sm); }
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  margin-bottom: var(--space-md);
}
.btn {
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--color-accent); color: var(--color-accent-fg);
  border: none; border-radius: var(--radius-md);
  padding: var(--space-sm) var(--space-md);
  font: inherit; font-weight: 600; cursor: pointer;
  transition: filter var(--motion-fast);
}
.btn:hover { filter: brightness(0.95); }
.btn-ghost {
  background: transparent; color: var(--color-accent);
  border: 1px solid var(--color-border);
}
.input, .textarea {
  width: 100%; display: block;
  background: var(--color-surface); color: var(--color-text);
  border: 1px solid var(--color-border); border-radius: var(--radius-md);
  padding: var(--space-sm) var(--space-md);
  font: inherit;
  transition: border-color var(--motion-fast);
}
.input:focus, .textarea:focus { outline: none; border-color: var(--color-accent); }
.textarea { min-height: 6rem; resize: vertical; font-family: var(--font-mono); }
.field { display: block; margin-bottom: var(--space-md); }
.field-label { display: block; font-size: var(--font-sm); font-weight: 600; margin-bottom: var(--space-xs); }
.field-hint { display: block; font-size: var(--font-sm); color: var(--color-text-muted); margin-top: var(--space-xs); }
.chip {
  display: inline-block;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: var(--space-xs) var(--space-md);
  font-size: var(--font-sm);
  cursor: pointer;
  transition: border-color var(--motion-fast), color var(--motion-fast);
}
.chip:hover { border-color: var(--color-accent); color: var(--color-accent); }
.citation-chip {
  display: inline-block;
  background: var(--color-accent);
  color: var(--color-accent-fg);
  border-radius: var(--radius-sm);
  padding: 0 var(--space-xs);
  font-size: var(--font-sm);
  font-family: var(--font-mono);
  margin: 0 var(--space-xs);
  vertical-align: baseline;
}
.error-banner {
  background: var(--color-error); color: var(--color-accent-fg);
  border-radius: var(--radius-md); padding: var(--space-md);
  margin-bottom: var(--space-md);
}
.warn-banner {
  background: var(--color-surface); color: var(--color-text);
  border: 2px solid var(--color-error);
  border-radius: var(--radius-md); padding: var(--space-md);
  margin-bottom: var(--space-md);
}
.suggestions { display: flex; flex-wrap: wrap; gap: var(--space-sm); margin-bottom: var(--space-md); }
.message-list { display: flex; flex-direction: column; gap: var(--space-md); margin-bottom: var(--space-lg); }
.message {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-md);
  white-space: pre-wrap;
}
.message-user { background: var(--color-accent); color: var(--color-accent-fg); align-self: flex-end; }
.message-assistant { align-self: flex-start; }
.composer { display: flex; gap: var(--space-sm); }
.composer .textarea { flex: 1; min-height: 3rem; }
.anchors { display: flex; flex-wrap: wrap; gap: var(--space-md); margin-bottom: var(--space-lg); }
details.advanced { border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-md); margin-bottom: var(--space-md); }
details.advanced summary { cursor: pointer; font-weight: 600; }
details.advanced[open] summary { margin-bottom: var(--space-md); }
code { font-family: var(--font-mono); font-size: var(--font-sm); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 0 var(--space-xs); }

.citation-badge {
  display: inline-block;
  background: var(--color-accent);
  color: var(--color-accent-fg);
  border-radius: var(--radius-sm);
  padding: 0 var(--space-xs);
  font-size: var(--font-sm);
  font-family: var(--font-mono);
  margin: 0 var(--space-xs);
  vertical-align: baseline;
}

@keyframes typing-dot {
  0%, 100% { opacity: 0.2; transform: translateY(0); }
  50% { opacity: 1; transform: translateY(-2px); }
}
@keyframes bubble-enter {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.message { animation: bubble-enter var(--bubble-enter-duration) ease-out both; }
.typing-indicator { display: inline-flex; gap: 4px; padding: 8px 12px; align-items: center; }
.typing-indicator .dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: currentColor; opacity: 0.2;
  animation: typing-dot var(--typing-duration) infinite ease-in-out;
}
.typing-indicator .dot:nth-child(1) { animation-delay: 0s; }
.typing-indicator .dot:nth-child(2) { animation-delay: 0.2s; }
.typing-indicator .dot:nth-child(3) { animation-delay: 0.4s; }

.btn { min-height: 44px; min-width: 44px; }
.composer .textarea { min-height: 44px; }
.composer-form {
  position: sticky;
  bottom: 0;
  background: var(--color-bg);
  padding: var(--space-sm) 0;
  z-index: 10;
}

.page-footer {
  text-align: center;
  padding: var(--space-lg) var(--space-md);
  font-size: 0.75rem;
  color: var(--color-text-muted);
}
.page-footer a { color: var(--color-text-muted); text-decoration: underline; }
.page-footer .sep { margin: 0 var(--space-sm); opacity: 0.5; }

@media (max-width: 540px) {
  .page { padding: var(--space-md) var(--space-sm); }
  .composer-form { padding: var(--space-xs) 0; }
  .composer { flex-direction: column; }
  .anchors { flex-direction: column; }
  .page-footer { font-size: 0.6875rem; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
  }
}
`;
}
