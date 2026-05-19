# Spec: G8b — Chat UI Redesign

## Problem Statement

The chat page renders with no intentional visual design: message bubbles are unstyled, dark mode is dead (theme never forwarded through the render chain), the design token set has no semantic message/surface slots, and there is no deploy script. The result fails the "visibly intentional" bar needed for operator screenshot review (G9).

## Current Behavior

- `src/views/chat-page.ts`: `ChatPageProps` has no `theme` field; `renderChatPage` at line 90 calls `renderLayout({...})` without passing `theme`, so `layout.ts:20` always defaults to `'light'`. Dark mode is permanently dead on the chat page even when `cfg.theme === 'dark'`.
- `src/routes/index.ts:105-114`: The `ChatPageProps` object constructed at the `State.C_CONFIGURED` branch does not include `theme`, so even if the config carries `theme: 'dark'`, it is silently dropped.
- `src/views/layout.ts`: Already correct — LayoutProps already has `theme?: 'light' | 'dark'` and emits `data-theme="${theme}"`. No change needed here.
- `src/types/config.ts`: Already has `theme?: 'light' | 'dark'` in `StoredConfig`. No change needed.
- `src/views/design-tokens.ts` (`toCssVars()`): Provides `--color-bg`, `--color-surface`, `--color-text`, `--color-text-muted`, `--color-accent`, `--color-accent-fg`, `--color-error`, `--color-border` and a partial dark override. Missing: dedicated message-bubble tokens (`--message-user-bg/text`, `--message-assistant-bg/text`), `--surface-2`, `--border-subtle`, `--text-primary`, `--text-secondary`, `--code-bg/text`, `--error-bg/text`, `--success-bg`, `--font-display`, `--font-body`, `--space-1..8` baseline scale.
- `baseStyles()` in design-tokens.ts: `.message-user` uses `var(--color-accent)` not a dedicated token; `.message-assistant` has no background; composer is not elevated on `--surface-2`; no `:focus-visible` rule; send button hover not inside `@media (hover:hover)`; no disabled state visual.
- `package.json`: `scripts` has no `"deploy"` key — only `"build"` (dry-run).

## Proposed Changes

### Sprint 1 — UI Foundation

**Task 1.1 — Design Context Analysis (type: ui-analysis)**
Write `docs/artifacts/design-context.md` capturing: (a) no Figma artifact exists, (b) font stack already loaded (Fraunces display, Instrument Sans body, JetBrains Mono), (c) existing token names in `TOKENS` export, (d) target aesthetic: editorial/refined-minimal — warm neutral palette, strong typographic hierarchy, bubble-chat layout with right-aligned user messages.

**Task 1.2 — Semantic Token Expansion (type: ui)**
Expand `toCssVars()` in `src/views/design-tokens.ts` (additive — keep all existing `--color-*` vars):

```
:root {
  /* --- existing vars preserved --- */

  /* Surface hierarchy */
  --surface:          #fafaf7;   /* page bg */
  --surface-2:        #f0efeb;   /* elevated card / composer */

  /* Text roles */
  --text-primary:     #1a1a1f;
  --text-secondary:   #4a4a55;
  --text-muted:       #6b6b78;

  /* Border hierarchy */
  --border:           #e3e3e8;
  --border-subtle:    #eeede9;

  /* Accent (same as --color-accent; alias for semantic clarity) */
  --accent:           <dynamic from accentColor>;
  --accent-foreground:#ffffff;

  /* Message bubbles */
  --message-user-bg:    <accent color>;
  --message-user-text:  #ffffff;
  --message-assistant-bg: #f0efeb;
  --message-assistant-text: #1a1a1f;

  /* Code blocks */
  --code-bg:   #f0efeb;
  --code-text: #2d2d35;

  /* Semantic status */
  --error-bg:    #fff0f0;
  --error-text:  #c92a2a;
  --success-bg:  #f0faf4;

  /* Typography stacks */
  --font-display: 'Fraunces', Georgia, serif;
  --font-body:    'Instrument Sans', system-ui, -apple-system, sans-serif;
  --font-mono:    'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

  /* 8px baseline spacing scale */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;

  /* Radius (existing, retained) */
  --radius-sm: 4px;
  --radius:    8px;
  --radius-lg: 16px;
}

[data-theme="dark"] {
  --surface:          #181613;
  --surface-2:        #242220;
  --text-primary:     #ededeb;
  --text-secondary:   #c0bfb8;
  --text-muted:       #9b9b94;
  --border:           #3a3834;
  --border-subtle:    #2f2d2a;
  --message-assistant-bg:   #242220;
  --message-assistant-text: #ededeb;
  --code-bg:    #242220;
  --code-text:  #d4d4c8;
  --error-bg:   #2d1212;
  --error-text: #f87171;
  --success-bg: #0f2318;
}
```

Note: `--accent` and `--message-user-bg` are driven by the sanitized `accentColor` argument so their dark-mode values stay the same (user bubbles retain the accent color in dark mode). `--accent-foreground` and `--message-user-text` remain white in both themes.

Also write `docs/artifacts/design-context.md` (the design-context artifact).

Include `.strategos/skill-load-receipt.json` in this commit (file already written by planner).

### Sprint 2 — Visual Assembly & Wiring

**Task 2.1 — Theme Wiring**

`src/views/chat-page.ts`:
- Extend `ChatPageProps` interface: add `theme: 'light' | 'dark'`.
- In `renderChatPage`, forward `theme: props.theme` to `renderLayout({..., theme: props.theme})`.

`src/routes/index.ts`:
- In the `State.C_CONFIGURED` branch (line ~105), add `theme: cfg.theme ?? 'light'` to the `ChatPageProps` object.

**Task 2.2 — Visual Component CSS (baseStyles)**

Update `baseStyles()` in `src/views/design-tokens.ts`:

- Message bubbles:
  ```css
  .message-user {
    background: var(--message-user-bg);
    color: var(--message-user-text);
    align-self: flex-end;
    border-radius: var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg);
    max-width: 80%;
  }
  .message-assistant {
    background: var(--message-assistant-bg);
    color: var(--message-assistant-text);
    align-self: flex-start;
    border-radius: var(--radius-lg) var(--radius-lg) var(--radius-lg) var(--radius-sm);
    max-width: 85%;
  }
  ```

- Composer elevated card:
  ```css
  .composer-form {
    background: var(--surface-2);
    border-top: 1px solid var(--border);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }
  .composer-form:focus-within {
    box-shadow: 0 0 0 2px var(--accent);
  }
  ```

- Send button — hover, focus-visible, disabled:
  ```css
  @media (hover: hover) {
    .btn:hover { filter: brightness(0.88); transform: translateY(-1px); }
  }
  .btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    filter: none;
    transform: none;
  }
  ```

- Global `:focus-visible`:
  ```css
  :focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }
  ```

- Citation chip hover with `border-subtle`:
  ```css
  .citation-chip:hover {
    border-color: var(--accent);
    background: var(--surface-2);
  }
  ```

- Code blocks using `--code-bg`, `--code-text`:
  ```css
  code, pre {
    background: var(--code-bg);
    color: var(--code-text);
  }
  ```

**Task 2.3 — Deploy Script**

`package.json`: add `"deploy": "wrangler deploy"` alongside existing `"build"` (dry-run stays intact).

## Implementation Notes

**Approach selected: Additive Semantic Layer.** All existing `--color-*` CSS custom properties are PRESERVED — the TOKENS export object in design-tokens.ts references them by name, and existing test grep-checks (token-discipline.test.ts) rely on them. New semantic slots are additions only; component CSS rules are updated to reference new tokens. This avoids a rename/migration blast radius.

**Token naming:** The goal spec asks for `--surface`, `--text-primary`, etc. (without `--color-` prefix). These are net-new names, not renamings, so no backward compat breakage.

**Adversarial check:** "How could visual criteria pass while the goal actually fails?" — An implementer could add the token definitions but leave `.message-user` still using `var(--color-accent)`. Guard: verification grep must specifically check `baseStyles()` for `var(--message-user-bg)` and `var(--message-assistant-bg)` usage.

**Dark mode --accent/-foreground:** These follow the accent color set via `accentColor` param, which is user-configured. The dark `[data-theme]` override block intentionally does NOT redefine `--accent` or `--message-user-bg` so they remain user-controlled regardless of theme.

**FLAGGED (confidence 0.72):** G9 screenshot review tests visual quality subjectively. No structural gate exists for this. Mitigated by: following ui-ux-pro-max aesthetic rules (WCAG contrast, 44px touch targets, `@media (hover:hover)` guards, reduced-motion existing rule), the warm neutral editorial palette, and bubble rounding asymmetry for visual distinctiveness.

**FLAGGED (confidence 0.70):** Dark mode WCAG AA contrast (`--text-primary` #ededeb on `--surface` #181613). Computed contrast ratio: approximately 13.8:1 — well above AA. Light mode `--text-primary` #1a1a1f on `--surface` #fafaf7: approximately 17.5:1. Both pass. Error text (`--error-text` #f87171 on `--error-bg` #2d1212 in dark): approx 4.7:1 — passes AA.

## Verification Criteria

1. `grep 'theme.*light.*dark\|light.*dark.*theme' src/views/chat-page.ts` — matches the literal union type in ChatPageProps interface.
2. `grep 'theme.*props\.theme' src/views/chat-page.ts` — confirms theme forwarded to renderLayout.
3. `grep 'theme.*cfg\.theme' src/routes/index.ts` — confirms theme passed in ChatPageProps construction.
4. `grep 'message-user-bg' src/views/design-tokens.ts | wc -l` — returns ≥2 (defined in :root and used in baseStyles).
5. `grep 'message-assistant-bg' src/views/design-tokens.ts | wc -l` — returns ≥2.
6. `grep 'data-theme.*dark' src/views/design-tokens.ts | wc -l` — returns ≥1 (dark override block exists).
7. `grep ':focus-visible' src/views/design-tokens.ts` — returns non-empty match.
8. `grep 'hover.*hover' src/views/design-tokens.ts` — returns `@media (hover: hover)` block.
9. `grep '"deploy"' package.json` — returns `"deploy": "wrangler deploy"` without --dry-run.
10. `test -f .strategos/skill-load-receipt.json` — exits 0.
11. `pnpm build && pnpm typecheck && pnpm lint` — all exit 0.
12. `pnpm test` — all existing tests pass, none regress.