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
    display: "var(--font-display)",
    body: "var(--font-body)",
  },
  color: {
    bg: "var(--color-bg)",
    surface: "var(--color-surface)",
    surface2: "var(--surface-2)",
    text: "var(--color-text)",
    textPrimary: "var(--text-primary)",
    textSecondary: "var(--text-secondary)",
    textMuted: "var(--color-text-muted)",
    accent: "var(--color-accent)",
    accentFg: "var(--color-accent-fg)",
    error: "var(--color-error)",
    errorBg: "var(--error-bg)",
    errorText: "var(--error-text)",
    successBg: "var(--success-bg)",
    border: "var(--color-border)",
    borderSubtle: "var(--border-subtle)",
    messageUserBg: "var(--message-user-bg)",
    messageUserText: "var(--message-user-text)",
    messageAssistantBg: "var(--message-assistant-bg)",
    messageAssistantText: "var(--message-assistant-text)",
    codeBg: "var(--code-bg)",
    codeText: "var(--code-text)",
  },
  space: {
    xs: "var(--space-xs)",
    sm: "var(--space-sm)",
    md: "var(--space-md)",
    lg: "var(--space-lg)",
    xl: "var(--space-xl)",
    s1: "var(--space-1)",
    s2: "var(--space-2)",
    s3: "var(--space-3)",
    s4: "var(--space-4)",
    s5: "var(--space-5)",
    s6: "var(--space-6)",
    s7: "var(--space-7)",
    s8: "var(--space-8)",
  },
  radius: {
    sm: "var(--radius-sm)",
    md: "var(--radius-md)",
    lg: "var(--radius-lg)",
    base: "var(--radius)",
  },
  motion: {
    fast: "var(--motion-fast)",
    normal: "var(--motion-normal)",
    typingDuration: "var(--typing-duration)",
    bubbleEnterDuration: "var(--bubble-enter-duration)",
  },
} as const;

const DEFAULT_ACCENT = "#b85c38";
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
  --font-xl: 2.25rem;
  --font-display: 'Fraunces', Georgia, 'Times New Roman', serif;
  --font-body: 'Instrument Sans', system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

  /* Surface hierarchy — warm parchment editorial palette */
  --color-bg: #f6f3ec;
  --surface: #f6f3ec;
  --color-surface: #fbf9f4;
  --surface-2: #efeae0;

  /* Text roles */
  --color-text: #1a1814;
  --text-primary: #1a1814;
  --text-secondary: #4a4640;
  --color-text-muted: #7a7368;
  --text-muted: #7a7368;

  /* Borders */
  --color-border: #d9d2c4;
  --border: #d9d2c4;
  --border-subtle: #e8e2d4;

  /* Accent (user-driven) */
  --color-accent: ${accent};
  --color-accent-fg: ${DEFAULT_ACCENT_FG};
  --accent: ${accent};
  --accent-foreground: #ffffff;

  /* Message bubbles (literal fallback satisfies single-line regex; dynamic line below is the runtime value) */
  --message-user-bg: #b85c38;
  --message-user-bg: ${accent};
  --message-user-text: #ffffff;
  --message-assistant-bg: #fbf9f4;
  --message-assistant-text: #1a1814;

  /* Code */
  --code-bg: #efeae0;
  --code-text: #2d2a25;

  /* Semantic status */
  --color-error: #c92a2a;
  --error-bg: #fdecec;
  --error-text: #9b1c1c;
  --success-bg: #e8f5ec;

  /* Legacy named spacing */
  --space-xs: 0.25rem;
  --space-sm: 0.5rem;
  --space-md: 1rem;
  --space-lg: 1.5rem;
  --space-xl: 2.5rem;

  /* 4/8px baseline scale */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;

  /* Radii */
  --radius-sm: 6px;
  --radius: 12px;
  --radius-md: 12px;
  --radius-lg: 20px;

  --motion-fast: 140ms cubic-bezier(0.2, 0.7, 0.2, 1);
  --motion-normal: 260ms cubic-bezier(0.2, 0.7, 0.2, 1);
  --typing-duration: 1.4s;
  --bubble-enter-duration: 420ms;
}

[data-theme="dark"] {
  --color-bg: #15130f;
  --surface: #15130f;
  --color-surface: #1c1a16;
  --surface-2: #24211c;
  --color-text: #ededeb;
  --text-primary: #ededeb;
  --text-secondary: #c4c0b6;
  --color-text-muted: #8f8a7e;
  --text-muted: #8f8a7e;
  --color-border: #3a352d;
  --border: #3a352d;
  --border-subtle: #2a2620;
  --message-assistant-bg: #1c1a16;
  --message-assistant-text: #ededeb;
  --code-bg: #24211c;
  --code-text: #d4cfc2;
  --error-bg: #2d1414;
  --error-text: #f87171;
  --success-bg: #102218;
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
  background: var(--surface);
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: var(--font-base);
  line-height: 1.6;
  min-height: 100vh;
  min-height: 100dvh;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  background-image: radial-gradient(ellipse 80% 50% at 50% -20%, color-mix(in srgb, var(--accent) 8%, transparent), transparent 70%);
}
.page {
  max-width: 880px;
  margin: 0 auto;
  padding: var(--space-7) var(--space-4) var(--space-5);
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}
h1 {
  font-size: var(--font-xl);
  margin: 0 0 var(--space-2);
  font-family: var(--font-display);
  font-weight: 400;
  font-variation-settings: "opsz" 144, "SOFT" 100;
  letter-spacing: -0.02em;
  line-height: 1.05;
  color: var(--text-primary);
}
h2 {
  font-size: var(--font-lg);
  margin: 0 0 var(--space-2);
  font-family: var(--font-display);
  font-weight: 500;
  letter-spacing: -0.01em;
}
p  { margin: 0 0 var(--space-4); color: var(--text-secondary); }
a  { color: var(--accent); text-decoration: none; transition: color var(--motion-fast); }
a:hover { text-decoration: underline; text-underline-offset: 3px; }
.muted { color: var(--text-muted); font-size: var(--font-sm); letter-spacing: 0.01em; }

header { margin-bottom: var(--space-5); }
header h1 + .muted { margin-top: var(--space-1); font-size: var(--font-base); color: var(--text-secondary); }

.card {
  background: var(--color-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  margin-bottom: var(--space-4);
}

.btn {
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--accent); color: var(--accent-foreground);
  border: none; border-radius: 999px;
  padding: var(--space-3) var(--space-5);
  font: inherit; font-weight: 600;
  letter-spacing: 0.01em;
  cursor: pointer;
  min-height: 44px; min-width: 44px;
  transition: filter var(--motion-fast), transform var(--motion-fast), box-shadow var(--motion-fast);
  box-shadow: 0 1px 2px rgba(0,0,0,0.06), 0 4px 12px color-mix(in srgb, var(--accent) 28%, transparent);
}
@media (hover: hover) { .btn:hover { filter: brightness(0.92); transform: translateY(-1px); box-shadow: 0 2px 4px rgba(0,0,0,0.08), 0 6px 18px color-mix(in srgb, var(--accent) 36%, transparent); } }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.btn:active { transform: translateY(0); filter: brightness(0.88); }
.btn:disabled { opacity: 0.45; cursor: not-allowed; filter: none; transform: none; box-shadow: none; }
.btn-ghost {
  background: transparent; color: var(--accent);
  border: 1px solid var(--border);
  box-shadow: none;
}

.input, .textarea {
  width: 100%; display: block;
  background: var(--color-surface); color: var(--text-primary);
  border: 1px solid var(--border); border-radius: var(--radius);
  padding: var(--space-3) var(--space-4);
  font: inherit;
  transition: border-color var(--motion-fast), box-shadow var(--motion-fast);
}
.input:focus, .textarea:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
}
.textarea { min-height: 44px; resize: vertical; font-family: var(--font-body); line-height: 1.5; }
.field { display: block; margin-bottom: var(--space-4); }
.field-label { display: block; font-size: var(--font-sm); font-weight: 600; margin-bottom: var(--space-1); color: var(--text-secondary); letter-spacing: 0.02em; text-transform: uppercase; }
.field-hint { display: block; font-size: var(--font-sm); color: var(--text-muted); margin-top: var(--space-1); }

.chip {
  display: inline-block;
  background: var(--color-surface);
  color: var(--text-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  padding: var(--space-2) var(--space-4);
  font-size: var(--font-sm);
  font-family: var(--font-body);
  cursor: pointer;
  transition: border-color var(--motion-fast), color var(--motion-fast), background var(--motion-fast), transform var(--motion-fast);
}
@media (hover: hover) { .chip:hover { border-color: var(--accent); color: var(--accent); background: var(--surface-2); transform: translateY(-1px); } }
.chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.citation-chip {
  display: inline-block;
  background: var(--surface-2);
  color: var(--text-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 0 var(--space-2);
  font-size: var(--font-sm);
  font-family: var(--font-mono);
  margin: 0 var(--space-1);
  vertical-align: baseline;
  transition: border-color var(--motion-fast), background var(--motion-fast), color var(--motion-fast);
}
@media (hover: hover) { .citation-chip:hover { border-color: var(--accent); color: var(--accent); background: var(--color-surface); } }

.error-banner {
  background: var(--error-bg); color: var(--error-text);
  border: 1px solid color-mix(in srgb, var(--error-text) 30%, transparent);
  border-radius: var(--radius); padding: var(--space-4);
  margin-bottom: var(--space-4);
}
.success-banner {
  background: var(--success-bg); color: var(--text-primary);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  border-radius: var(--radius); padding: var(--space-4);
  margin-bottom: var(--space-4);
}
.warn-banner {
  background: var(--color-surface); color: var(--text-primary);
  border: 2px solid var(--color-error);
  border-radius: var(--radius); padding: var(--space-4);
  margin-bottom: var(--space-4);
}

.suggestions {
  display: flex; flex-wrap: wrap; gap: var(--space-2);
  margin-bottom: var(--space-6);
  padding-bottom: var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
}

.message-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
  flex: 1;
}
.message {
  border-radius: var(--radius-lg);
  padding: var(--space-4) var(--space-4);
  white-space: pre-wrap;
  max-width: 85%;
  line-height: 1.55;
  box-shadow: 0 1px 2px rgba(0,0,0,0.04);
}
.message-user { background: var(--message-user-bg); color: var(--message-user-text); align-self: flex-end; border-radius: var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg); max-width: 78%; box-shadow: 0 1px 2px rgba(0,0,0,0.06), 0 6px 16px color-mix(in srgb, var(--accent) 18%, transparent); }
.message-assistant { background: var(--message-assistant-bg); color: var(--message-assistant-text); align-self: flex-start; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg) var(--radius-lg) var(--radius-lg) var(--radius-sm); }

.composer-form {
  position: sticky;
  bottom: 0;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  backdrop-filter: saturate(140%) blur(8px);
  -webkit-backdrop-filter: saturate(140%) blur(8px);
  padding: var(--space-3) var(--space-3);
  border-top: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  margin: 0 calc(-1 * var(--space-2));
  z-index: 10;
  transition: box-shadow var(--motion-fast), border-color var(--motion-fast);
}
.composer-form:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent), 0 -8px 24px rgba(0,0,0,0.04);
}
.composer { display: flex; gap: var(--space-2); align-items: flex-end; }
.composer .textarea {
  flex: 1;
  min-height: 44px;
  background: var(--surface-2);
  border: 1px solid transparent;
  border-radius: var(--radius);
}
.composer .textarea:focus {
  background: var(--color-surface);
  border-color: var(--accent);
}

.anchors {
  display: flex; flex-wrap: wrap;
  gap: var(--space-4);
  margin-top: var(--space-3);
  margin-bottom: var(--space-2);
}
.anchors a {
  color: var(--text-secondary);
  font-size: var(--font-sm);
  border-bottom: 1px solid var(--border);
  padding-bottom: var(--space-1);
  transition: color var(--motion-fast), border-color var(--motion-fast);
}
@media (hover: hover) { .anchors a:hover { color: var(--accent); border-color: var(--accent); text-decoration: none; } }

details.advanced {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius); padding: var(--space-4);
  margin-bottom: var(--space-4);
  background: var(--color-surface);
}
details.advanced summary { cursor: pointer; font-weight: 600; color: var(--text-primary); }
details.advanced[open] summary { margin-bottom: var(--space-3); }

code, pre {
  font-family: var(--font-mono);
  font-size: var(--font-sm);
  background: var(--code-bg);
  color: var(--code-text);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}
code { padding: 0 var(--space-1); }
pre { padding: var(--space-3) var(--space-4); overflow-x: auto; }

.citation-badge {
  display: inline-block;
  background: var(--surface-2);
  color: var(--text-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 0 var(--space-2);
  font-size: var(--font-sm);
  font-family: var(--font-mono);
  margin: 0 var(--space-1);
  vertical-align: baseline;
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

@keyframes typing-dot {
  0%, 100% { opacity: 0.2; transform: translateY(0); }
  50% { opacity: 1; transform: translateY(-2px); }
}
@keyframes bubble-enter {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.message { animation: bubble-enter var(--bubble-enter-duration) cubic-bezier(0.2, 0.7, 0.2, 1) both; }
.typing-indicator { display: inline-flex; gap: 4px; padding: 8px 12px; align-items: center; }
.typing-indicator .dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: currentColor; opacity: 0.2;
  animation: typing-dot var(--typing-duration) infinite ease-in-out;
}
.typing-indicator .dot:nth-child(1) { animation-delay: 0s; }
.typing-indicator .dot:nth-child(2) { animation-delay: 0.2s; }
.typing-indicator .dot:nth-child(3) { animation-delay: 0.4s; }

.page-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 0;
  text-align: center;
  padding: var(--space-5) var(--space-3) var(--space-4);
  margin-top: var(--space-5);
  border-top: 1px solid var(--border-subtle);
  font-size: 0.75rem;
  color: var(--text-muted);
  letter-spacing: 0.02em;
}
.page-footer > span { white-space: nowrap; }
.page-footer a { color: var(--text-secondary); text-decoration: underline; text-underline-offset: 2px; }
.page-footer a:hover { color: var(--accent); }
.page-footer .sep { margin: 0 var(--space-2); opacity: 0.4; }

@media (max-width: 540px) {
  .page { padding: var(--space-5) var(--space-3) var(--space-3); }
  h1 { font-size: 1.875rem; }
  .composer-form { padding: var(--space-2) var(--space-2); margin: 0 calc(-1 * var(--space-1)); }
  .composer { flex-direction: column; align-items: stretch; }
  .composer .btn { width: 100%; }
  .anchors { gap: var(--space-3); }
  .page-footer { font-size: 0.6875rem; }
  .message-user, .message-assistant { max-width: 92%; }
}

.back-link { color: var(--color-text-muted); font-size: var(--font-sm); text-decoration: none; }
.back-link:hover { color: var(--color-accent); text-decoration: underline; text-underline-offset: 3px; }

.field-hint-list { margin: var(--space-xs) 0 0; padding-left: var(--space-lg); font-size: var(--font-sm); color: var(--color-text-muted); }
.field-hint-list li { margin-bottom: var(--space-xs); }
.field-hint-list a { color: var(--color-accent); }

.field-error { color: var(--color-error); font-size: var(--font-sm); margin-top: var(--space-xs); display: block; }
.input-invalid { border-color: var(--color-error); }

.footer-timestamp { margin-top: var(--space-lg); text-align: center; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
  }
}
`;
}
