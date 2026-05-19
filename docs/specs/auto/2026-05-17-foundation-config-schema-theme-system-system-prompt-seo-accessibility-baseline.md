# G2 Spec (Attempt 4): Full Implementation from Baseline

## Problem Statement

The workspace is at the original baseline state. Three prior sprints worked on discarded branches. This attempt plans a complete, precise implementation starting from scratch. All 17 done_when criteria must be satisfied by the end of Sprint 2. The key risk in prior attempts was incomplete implementation (attempt 1) and sprint execution failures (attempts 2-3 on reset branches). This spec provides file-level precision to minimize execution ambiguity.

## Current Behavior

- **`src/views/design-tokens.ts:63-93`** — `toCssVars()` emits one `:root {}` block (light palette only). `--font-mono: ui-monospace, SFMono-Regular, Menlo, monospace`. No `[data-theme="dark"]` override, no `#181613`, no Fraunces/Instrument Sans/JetBrains Mono. Note: `#fafaf7` already present at line 72 (criterion 5 already satisfied).
- **`src/views/layout.ts:15-28`** — `<html lang="en">` with no `data-theme` attribute. Only charset + viewport meta. No OG tags, no Twitter card, no Google Fonts link.
- **`src/views/setup-form.ts:7-20`** — `SetupFormFields` interface has no `admin_password` or `theme` field. `renderConfigForm()` renders no password input or theme selector.
- **`src/views/chat-page.ts:46`** — `.message-list` section has `aria-live="polite"` but no `role="log"`.
- **`src/prompts/system.ts:17-23`** — `BEHAVIORAL_INSTRUCTIONS` has clauses (a)-(e) but no clause (f) containing the literal substrings "plain text" and "no markdown".
- **`src/types/config.ts`** — `StoredConfig` has no `theme` or `admin_password_hash` fields.

## Proposed Changes

### Sprint 1 — Design System Layer

**`src/views/design-tokens.ts` — dark theme + web fonts**

CRITICAL: `src/test/views/token-discipline.test.ts` enforces that hex literals (`/#[0-9a-fA-F]{3,8}/`) appear ONLY in this file. All dark-theme hex values MUST land here. Font names are CSS strings (not hex) so they are safe anywhere, but placing them here satisfies all three `fs:contains-regex src/views` font criteria.

In `toCssVars()`, after the closing `}` of `:root`, append:
```
[data-theme="dark"] {
  --color-bg: #181613;
  --color-surface: #242220;
  --color-text: #ededeb;
  --color-text-muted: #9b9b94;
  --color-border: #3a3834;
}
```

In `baseStyles()`, make three targeted changes:
1. Body `font-family`: change to `'Instrument Sans', system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
2. Update `--font-mono` in `:root`: change to `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace`
3. Add to h1 and h2 rules: `font-family: 'Fraunces', Georgia, serif;`

This places `Fraunces`, `Instrument Sans` (with space), and `JetBrains Mono` (with space) as CSS string values in `src/views/design-tokens.ts`, satisfying all three font regex criteria. The Google Fonts URL in layout.ts uses `Instrument+Sans` (URL-encoded, no space) which does NOT match `\s+`, so design-tokens.ts is the authoritative source for these font grep criteria.

**`src/views/layout.ts` — data-theme, SEO meta, font link**

Extend `LayoutProps` interface:
```ts
theme?: 'light' | 'dark';
description?: string;
```

In `renderLayout()`, make these changes:
1. Change `<html lang="en">` to `<html lang="en" data-theme="${props.theme ?? 'light'}">`
2. After `<title>` line, add:
```
<meta property="og:title" content="${escapeHtml(props.title)}" />
<meta property="og:type" content="website" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="${escapeHtml(props.title)}" />
```
3. After the above meta tags, add Google Fonts link:
```
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;1,9..144,400&family=Instrument+Sans:wght@400;600&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet" />
```

All dynamic meta values use `escapeHtml()` (already imported at line 2). The Google Fonts URL and HTML attributes contain no hex/px/rem patterns, so token-discipline test is not affected.

### Sprint 2 — Feature Changes & Verification

**`src/views/setup-form.ts` — admin_password + theme fields**

Add to `SetupFormFields` interface:
```ts
admin_password?: string;
theme?: 'light' | 'dark';
```

In `renderConfigForm()`, add to the `requiredFields` array (before or after the existing API key field):
- A theme `<select>` input named `theme` with options `light` and `dark`, required
- A `password` input named `admin_password`, required, autocomplete off, hint "12–128 characters"

Both additions must use the existing `input()` primitive pattern or equivalent inline HTML. The `name="admin_password"` attribute satisfies `fs:contains-regex src/views/setup-form.ts /admin_password/`.

**`src/prompts/system.ts` — plain-text instruction**

Append clause `(f)` to `BEHAVIORAL_INSTRUCTIONS` after clause (e):
```
(f) Reply in plain text only — no markdown syntax. Do not use headings (#), bullet dashes (*), asterisks for bold (**), backtick code fences, or any other markdown formatting. Visitors read responses as plain text; markdown characters appear literally and harm readability.
```

This adds the literal substrings `plain text` and `no markdown` (both case-insensitively present) to satisfy both `fs:contains` criteria.

**`src/views/chat-page.ts` — role=log on message container**

Change line 46 from:
```html
<section class="message-list" aria-live="polite" aria-label="Conversation"></section>
```
To:
```html
<section class="message-list" role="log" aria-live="polite" aria-label="Conversation"></section>
```

**`src/types/config.ts` — theme + admin_password_hash schema**

Add to `StoredConfig` interface:
```ts
/** UI color scheme. Optional; defaults to 'light'. */
theme?: 'light' | 'dark';
/** Bcrypt/argon2id hash of the admin password. KV-only; never echoed. */
admin_password_hash?: string;
```
Update `parseStoredConfig()` to accept these as valid optional fields (no breaking change to existing validation).

**Verification gate**

Run all four toolchain commands:
- `pnpm test` — must pass with ≥214 tests, no regression
- `pnpm build` — must exit 0
- `pnpm typecheck` — must exit 0
- `pnpm lint` — must exit 0

## Implementation Notes

**Token-discipline constraint is absolute.** The test at `src/test/views/token-discipline.test.ts` sweeps all `src/views/**/*.ts` with regex `/#[0-9a-fA-F]{3,8}\b/` and fails if any file other than `design-tokens.ts` contains a hex literal. All dark-theme hex values (`#181613`, surface/text/border variants) MUST go into `design-tokens.ts:toCssVars()` ONLY. Never add hex to `layout.ts`.

**Font grep criteria require space, not URL encoding.** `fs:contains-regex src/views /Instrument\s+Sans/` matches `"Instrument Sans"` (space) but NOT `Instrument+Sans` (URL-encoded form in Google Fonts href). The font-family declarations in `design-tokens.ts:baseStyles()` must use the unencoded names with spaces.

**`#fafaf7` is already present.** `design-tokens.ts:72` has `--color-bg: #fafaf7` in the existing `:root` block. Criterion `grep:#fafaf7:src` is already satisfied and must not be regressed.

**admin_password vs admin_password_hash.** The form input is named `admin_password` (client-submitted plaintext, never stored). `StoredConfig` stores `admin_password_hash` (G3's responsibility to write). G2 only renders the form field and defines the schema shape.

**Existing callers of `renderLayout()` remain valid.** Adding optional `theme` and `description` fields to `LayoutProps` is non-breaking. No callers need updating for the structural grep criteria to pass. The default `theme ?? 'light'` ensures backward compat.

## Verification Criteria

| # | Criterion | Command | Expected |
|---|---|---|---|
| 1 | admin_password in setup-form.ts | `grep -P 'admin_password' src/views/setup-form.ts` | exits 0 |
| 2 | theme in setup-form.ts | `grep -P 'name="theme"\|theme.*select' src/views/setup-form.ts` | exits 0 |
| 3 | data-theme in src/ | `grep -r 'data-theme' src/` | exits 0 (layout.ts) |
| 4 | #181613 in src/ | `grep -r '#181613' src/` | exits 0 (design-tokens.ts) |
| 5 | #fafaf7 in src/ | `grep -r '#fafaf7' src/` | exits 0 (design-tokens.ts:72, already present) |
| 6 | plain text in system.ts | `grep -i 'plain text' src/prompts/system.ts` | exits 0 |
| 7 | no markdown in system.ts | `grep -i 'no markdown' src/prompts/system.ts` | exits 0 |
| 8 | og:title in src/views/ | `grep -r 'og:title' src/views/` | exits 0 (layout.ts) |
| 9 | twitter:card in src/views/ | `grep -r 'twitter:card' src/views/` | exits 0 (layout.ts) |
| 10 | role="log" in src/views/ | `grep -r 'role="log"' src/views/` | exits 0 (chat-page.ts) |
| 11 | Fraunces in src/views/ | `grep -rP 'Fraunces' src/views/` | exits 0 (design-tokens.ts) |
| 12 | Instrument Sans in src/views/ | `grep -rP 'Instrument\s+Sans' src/views/` | exits 0 (design-tokens.ts) |
| 13 | JetBrains Mono in src/views/ | `grep -rP 'JetBrains\s+Mono' src/views/` | exits 0 (design-tokens.ts) |
| 14 | pnpm test | `pnpm test` | exits 0, ≥214 pass |
| 15 | pnpm build | `pnpm build` | exits 0 |
| 16 | pnpm typecheck | `pnpm typecheck` | exits 0 |
| 17 | pnpm lint | `pnpm lint` | exits 0 |