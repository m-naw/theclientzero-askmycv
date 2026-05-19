## Problem Statement

Ten operator-reported regressions in the G9 checkpoint review prevent acceptance of the v2 migration. Issues span: admin theme save never persisting to KV or rendering; admin save requiring a password change unconditionally; the danger zone rendering outside the `.page` width container; reset errors returning bare text instead of inline HTML; the default accent clashing with the warm parchment palette; the homepage leading with CF Access configuration instead of AskMyCV description; the `/setup` form lacking a `platform.claude.com` API key link; the chat error message missing "later"; the admin save showing no success banner; and `/admin/login` returning bare "Invalid password" text.

## Current Behavior

Verified from codebase snapshot:

- **Issue 1** (`src/routes/admin.ts:216-230`): `updated` object omits `theme`; `renderAdminForm` call at :91-105 and :235-249 omit `theme` from prefill; `renderConfigForm` at `src/views/setup-form.ts:169` passes only `accentColor` to `renderLayout`.
- **Issue 2** (`src/views/setup-form.ts:71-74`): admin_password rendered with unconditional `required` and hardcoded name `admin_password`; `handleAdminSave` never reads a password field.
- **Issue 3** (`src/views/admin-form.ts:55`): danger zone injected via `.replace("</body>", …)` — lands outside `</main>`, outside `.page` max-width container.
- **Issue 4** (`src/routes/admin.ts:408-414, 426`): bad-password, confirm-mismatch, and success all return `new Response(text, …)` — bare text, not HTML.
- **Issue 5** (`src/views/design-tokens.ts:73`): `DEFAULT_ACCENT = "#3b5bdb"` is cool cobalt; clashes with `--surface #fafaf7`.
- **Issue 6** (`src/views/setup-instructions.ts:15`): headlines "Configure Cloudflare Access" as primary action; CF Access is optional since G3+G4.
- **Issue 7** (`src/views/setup-form.ts:185-192`): no `apiKeyHint` passed; `primitives/index.ts:46` escapes hint text, blocking trusted HTML links.
- **Issue 8** (`src/views/client/streaming.ts:~98`): error ends "Please try again." — missing "later".
- **Issue 9** (`src/views/admin-form.ts:7-10`): `AdminFormProps` has no `successMessage` field; no success banner rendered after save.
- **Issue 10** (`src/routes/admin.ts:338-341`): bare text 401 on login failure; `src/views/admin-login.ts:42-43` uses undefined `.centered-form` class double-wrapping layout.

## Proposed Changes

### Fix 1 — Theme persistence + render (src/types/config.ts field already exists)
- **1B** `src/routes/admin.ts:handleAdminSave` — add `const theme = (readField(form, 'theme') === 'dark' ? 'dark' : 'light') as 'light' | 'dark';` and include `theme` in `updated`.
- **1C** `src/routes/admin.ts:91-105, 235-249` — add `theme: config.theme` to both `renderAdminForm` prefill calls.
- **1D** `src/views/setup-form.ts:renderConfigForm` — pass `theme: p.theme` to `renderLayout(…)`.

### Fix 2 — Password optional in admin mode
- **2A** `src/views/setup-form.ts:70-74` — render admin_password field conditionally: in `setup` mode keep `required` and name `admin_password`; in `admin` mode: `required=false`, name=`new_admin_password`, label="New admin password (optional — leave blank to keep current)".
- **2B** `src/routes/admin.ts:handleAdminSave` — read `new_admin_password`; if non-empty and ≥12 chars: `hashPassword(…)` then `env.STATE.put(ADMIN_PASSWORD_HASH_KEY, hash)`. If blank: skip.

### Fix 3 — Danger zone inside .page
- `src/views/admin-form.ts:55` — change `.replace("</body>", …)` to `.replace("</main>", …)`.

### Fix 4 — Reset inline errors + 303 redirect
- **4A** `src/routes/admin.ts:406-414` — on bad password or confirm mismatch: load config, call `renderAdminForm({…, resetError: msg})`, return 200 HTML.
- **4B** `src/routes/admin.ts:425-428` — on success: `new Response(null, { status: 303, headers: { Location: '/setup?reset=1', 'Set-Cookie': clearSessionCookie() } })`.
- **4C** `src/views/admin-form.ts` — add `resetError?: string` to `AdminFormProps`; render `.error-banner` inside danger zone form when set.
- **4D** `src/routes/setup.ts:handleGetSetup` — read `?reset=1` query param; pass `resetBanner` to `renderSetupForm`.
- **4E** `src/views/setup-form.ts:renderSetupForm` — accept optional `resetBanner?: string`; render as `.success-banner` at top of body when set.

### Fix 5 — Warm default accent
- `src/views/design-tokens.ts:73` — change `DEFAULT_ACCENT` from `"#3b5bdb"` to `"#b85c38"` (terracotta, WCAG AA 4.6:1 vs white).
- Update literal fallback at line ~125: `--message-user-bg: #b85c38;`.

### Fix 6 — Homepage rewrite
- `src/views/setup-instructions.ts` — rewrite body: intro paragraph explaining AskMyCV, bullet list of what to configure, primary CTA `<a class="btn" href="/setup">Set up AskMyCV →</a>`, `<details>` labelled "Optional: Cloudflare Access (defense-in-depth)" containing existing CF Access steps reframed as optional.

### Fix 7 — API key hint with platform.claude.com link
- **7A** `src/views/primitives/index.ts` — add `hintHtml?: string` to `InputProps`; when set, render `<span class="field-hint">${hintHtml}</span>` without escaping (trusted static string only; safety comment required).
- **7B** `src/views/setup-form.ts:renderConfigForm` — for the anthropic_api_key input in setup mode, pass `hintHtml: 'Get your API key at <a href="https://platform.claude.com" target="_blank" rel="noopener noreferrer">platform.claude.com</a>. Free tier available.'`.

### Fix 8 — Chat error wording
- `src/views/client/streaming.ts:~98` — append ` later` → "Please try again later."

### Fix 9 — Admin save success banner
- **9A** `src/views/admin-form.ts` — add `successMessage?: string` to `AdminFormProps`; inject `.success-banner` above form when set.
- **9B** `src/routes/admin.ts:235` — add `successMessage: 'Configuration saved.'` to post-save `renderAdminForm` call.
- **9C** `src/views/design-tokens.ts:baseStyles()` — add `.success-banner` CSS: `background: var(--success-bg); color: var(--text-primary); border-left: 3px solid var(--color-accent); border-radius: var(--radius); padding: var(--space-4); margin-bottom: var(--space-4);`.

### Fix 10 — Admin login inline error + layout fix
- **10A** `src/routes/admin.ts:338-341` — replace bare `new Response("Invalid password", {status:401})` with `new Response(renderAdminLoginForm({error: 'Invalid password'}), {status:401, headers: HTML_HEADERS})`.
- **10B** `src/views/admin-login.ts:42-43` — remove `<main class="centered-form">` wrapper; replace with plain `<div>` or remove entirely.

## Implementation Notes

**Accent choice rationale (ui-ux-pro-max):** Terracotta `#b85c38` passes WCAG AA (4.6:1 vs white), harmonizes with warm parchment `#fafaf7`, and contrasts strongly against dark surface `#15130f` (~9:1). Amber `#c47a3a` fails AA (3.2:1). Warm brown `#8b5e3c` passes but less visually distinctive.

**hintHtml safety:** Only used in `renderConfigForm` with a static string literal, never from user input. Co-locate safety comment at the bypass point.

**Adversarial guard:** `renderLayout` must accept `theme` parameter to emit `data-theme="dark"`. Verify `src/views/layout.ts` signature before implementing Fix 1D.

**Reset 303 pattern:** `new Response(null, { status: 303, headers: { Location: '/setup?reset=1', 'Set-Cookie': clearSessionCookie() } })` — do not use `Response.redirect` as it does not accept extra headers.

**Danger zone inject (Fix 3):** `.replace("</main>", dangerZone + "</main>")` places the section before closing `</main>`, inside the `.page` container.

**Success-banner CSS token discipline:** Use `var(--success-bg)`, `var(--color-accent)`, `var(--radius)`, `var(--space-4)` — no raw literals, per token-discipline guardrail.

## Verification Criteria

All 10 acceptance items verifiable by single-line grep + build/test commands:
1. Theme: `grep 'readField.*theme\|theme.*readField' src/routes/admin.ts` returns hit
2. Optional password: `grep 'new_admin_password' src/views/setup-form.ts src/routes/admin.ts` returns hits in both
3. Danger zone: `grep '</main>' src/views/admin-form.ts` returns injection hit; `grep '</body>' src/views/admin-form.ts` returns no injection
4. Reset HTML: `grep 'resetError' src/routes/admin.ts src/views/admin-form.ts` returns hits; `grep 'setup?reset=1' src/routes/admin.ts` returns hit
5. Accent: `grep 'DEFAULT_ACCENT' src/views/design-tokens.ts` returns `#b85c38`
6. Homepage: `grep 'Configure Cloudflare Access' src/views/setup-instructions.ts` returns no match
7. API link: `grep 'platform.claude.com' src/views/setup-form.ts src/views/primitives/index.ts` returns hit
8. Chat error: `grep 'try again later' src/views/client/streaming.ts` returns hit
9. Success banner: `grep 'successMessage\|Configuration saved' src/routes/admin.ts src/views/admin-form.ts` returns hits
10. Login form: `grep 'renderAdminLoginForm.*error\|error.*Invalid' src/routes/admin.ts` returns hit; `grep 'centered-form' src/views/admin-login.ts` returns no match
- Build: `pnpm build` exits 0
- Tests: `pnpm test` exits 0; integration tests exit 0