## Problem Statement

The chat page has a working streaming skeleton but is missing the coherent UX layer required for production: client-side markdown stripping is absent (asterisks and backticks leak into rendered DOM text); the citation token `[cv]` is rendered with class `citation-chip` rather than the spec-target `citation-badge`; no @keyframes animations exist for typing indicator or message entrance; no auto-scroll control; no mobile keyboard survival strategy; no keyboard shortcuts or send-button disabled state; all Anthropic upstream failures map to the same generic error; no footer with MAINTAINER_* attribution constants; no AGPL-3.0 Section 7(b) clause in LICENSE.

## Root Cause of Prior Iteration Failures (Attempts 1-3)

All three prior attempts failed with 'Strategy loop error: consumed artifact anthropic-messages-error was not found'. The artifact resolution check reads goal metadata and runs before any sprint executor writes to the workspace. The fix (executed as prerequisite to this spec): created `references/anthropic-messages-error.json` with the Anthropic credit-error shape derived from behavior scenario 3 (HTTP 400, `invalid_request_error`, message contains 'credit') and committed it to the branch. The strategy loop will now find the artifact at its expected path.

## Current Behavior

- `src/views/client/streaming.ts`: IIFE with SSE pump. `renderInto()` splits on `[cv]` and creates `citation-chip` spans. No markdown stripping. No partial-match preservation regex. No typing indicator DOM. No animations. No auto-scroll. No keyboard shortcuts. No send-button disabled state.
- `src/views/design-tokens.ts` `baseStyles()`: defines `.citation-chip` CSS. No `@keyframes`. No typing timing vars in `toCssVars()`. No mobile sticky rules. No `prefers-reduced-motion` block.
- `src/views/chat-page.ts:46`: `role="log" aria-live="polite"` already present (done_when criterion already met). No MAINTAINER_* constants. No `<footer>` element.
- `src/routes/chat.ts:202-207`: All upstream non-OK responses return HTTP 502 `{error:'upstream_unavailable'}`. No credit-balance distinction.
- `LICENSE`: Vanilla AGPL-3.0. No Section 7(b) additional terms.
- `references/anthropic-messages-error.json`: Now exists (created as prerequisite to this iteration) with the Anthropic credit-error shape: HTTP 400, `invalid_request_error`, message 'Your credit balance is too low...'.

## Proposed Changes

### Sprint 1: UI Foundation

**Task 1 — Design Context (ui-analysis):** Detect design resources: Figma URLs, tailwind.config.ts, or other design systems. Write `docs/artifacts/design-context.md` recording that the design system is `src/views/design-tokens.ts` CSS custom properties with no external design tool.

**Task 2 — Animation tokens and @keyframes (design-tokens.ts):**
- In `toCssVars()`: add `--typing-duration: 1.4s` and `--bubble-enter-duration: 400ms`.
- In `baseStyles()`: add `@keyframes typing-dot { 0%,80%,100%{transform:scale(0)} 40%{transform:scale(1)} }` and `@keyframes bubble-enter { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }`.
- Add `.typing-indicator` rule (flex, 4px gap) with child `.dot` elements using `animation: typing-dot var(--typing-duration) infinite` and delays `0s`, `0.2s`, `0.4s`.
- Add `.message { animation: bubble-enter var(--bubble-enter-duration) ease-out both }` to existing `.message` rule.
- Add `@media (prefers-reduced-motion: reduce) { .typing-indicator *, .message { animation: none } }`.

**Task 3 — citation-badge CSS and mobile CSS (design-tokens.ts):**
- Add `.citation-badge` CSS rule in `baseStyles()` with same visual properties as `.citation-chip` (accent background, mono font, inline-block, border-radius, padding). Keep `.citation-chip` intact for backward compat with existing tests.
- Add `min-height: 44px; touch-action: manipulation` to `.btn` and `.composer .textarea` rules.
- Add `.composer-form { position: sticky; bottom: 0; background: var(--color-bg); padding: var(--space-sm) 0; z-index: 10; }`.
- Update body `min-height` to `100svh` with `100dvh` fallback for mobile keyboard survival.
- Add `@media (max-width: 540px) { .composer { flex-direction: column; } .anchors { flex-direction: column; } }`.
- Add `.page-footer { margin-top: var(--space-xl); padding-top: var(--space-md); border-top: 1px solid var(--color-border); font-size: var(--font-sm); color: var(--color-text-muted); display: flex; flex-wrap: wrap; gap: var(--space-md); }`.

**Task 4 — MAINTAINER_* constants and footer (chat-page.ts):**
- Declare module-scope: `const MAINTAINER_GH_USERNAME = 'm-naw'`, `const MAINTAINER_REPO_NAME = 'theclientzero-askmycv'`, `const MAINTAINER_X_HANDLE = 'TheClientZero'`.
- Add optional `x_url?: string` to `ChatPageProps`.
- Render `<footer class="page-footer">` containing: (a) canonical-repo anchor `<a href="https://github.com/${MAINTAINER_GH_USERNAME}/${MAINTAINER_REPO_NAME}">askmycv</a>`; (b) X anchor `<a href="https://x.com/${MAINTAINER_X_HANDLE}">@${MAINTAINER_X_HANDLE}</a>`; (c) conditional 'Deployed by display_name' link when `linkedin_url` or `x_url` is set; no Deployed-by element when neither is set.
- Update `src/test/views/chat-page.test.ts` to assert footer links.

### Sprint 2: Chat UX Logic + Backend + Legal

**Task 5 — Rewrite streaming.ts (F6 markdown + citation-badge pipeline):**
- Add `stripMarkdown(text)` pure function: remove `**`/`*` bold/italic markers, backtick sequences, `# ` header prefixes, `> ` blockquote prefixes, `- `/`* `/`N. ` list item prefixes.
- Rewrite `renderInto` pipeline: hold any tail matching `/\[(?:c(?:v)?)?$/` as `pending` until next chunk; on complete `[cv]`, create `span.citation-badge` with `textContent='cv'`; for all other text, use `createTextNode` (no innerHTML on model output). HTML-escape is implicit via textContent assignment.
- Adversarial guard: streaming.ts must set `span.className = 'citation-badge'` (not 'citation-chip') in the DOM construction code, not only in CSS.

**Task 6 — Animations, auto-scroll, keyboard UX, send-disabled (streaming.ts):**
- Typing indicator: append `.typing-indicator` with 3 `.dot` children on `send()` start; remove on first text delta.
- visualViewport listener: `if (window.visualViewport) { window.visualViewport.addEventListener('resize', function() { document.documentElement.style.setProperty('--visual-vh', window.visualViewport.height + 'px'); }); }`.
- Auto-scroll (F8): track `userScrolledUp` via debounced scroll listener (`true` when `window.scrollY < document.body.scrollHeight - window.innerHeight - 100`); call `window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'})` in pump loop only when `!userScrolledUp`; reset `userScrolledUp = false` on new message submit.
- Keyboard UX: `textarea.addEventListener('keydown', function(e) { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); if (textarea.value.trim()) submitForm(); } else if (e.key==='Escape') { textarea.value=''; textarea.blur(); } })`.
- Send disabled: `btn.disabled = true` on mount when textarea empty; `textarea.addEventListener('input', function() { btn.disabled = !textarea.value.trim(); })`; `btn.disabled = true` on submit; restore in `.finally()`.

**Task 7 — Credit error detection in chat.ts and UI (F11):**
- In `src/routes/chat.ts` after `!upstream.ok` check: `const errBody = await upstream.clone().json().catch(() => null); if (errBody?.error?.message && String(errBody.error.message).toLowerCase().includes('credit')) { return new Response(JSON.stringify({ error: 'upstream_unavailable', reason: 'credits' }), { status: 502, headers: JSON_HEADERS }); }`.
- Shape matches `references/anthropic-messages-error.json`: `{type:'error', error:{type:'invalid_request_error', message:'...credit...'}}`. The word 'credit' appears in detection logic.
- In streaming.ts error handler: if `json && json.reason === 'credits'`, show 'Service temporarily unavailable: API credit limit reached.'; else show generic error.

**Task 8 — LICENSE Section 7(b):**
- Append before final newline: 'Additional Terms under GNU AGPL-3.0 Section 7(b):\n\nAny version of this Program made available over a computer network must display, in its user interface, a prominent link to the canonical source repository:\n  https://github.com/m-naw/theclientzero-askmycv\nThis attribution notice may not be removed or obscured by any downstream distributor or fork.'.

**Task 9 — Tests and regression verification:**
- Add credit-error test in `src/test/chat-abuse.test.ts` or new file: mock Anthropic returning HTTP 400 with credit message, assert worker HTTP 502 with `reason:'credits'`.
- Run `pnpm test`, `pnpm build`, `pnpm typecheck`, `pnpm lint`.

## Implementation Notes

**Token-discipline compatibility:** `@keyframes` percentage/opacity/transform values are not hex/px/rem literals. Timing values (`1.4s`, `400ms`) go into `toCssVars()` as CSS vars (`--typing-duration`, `--bubble-enter-duration`) which is the declared safe zone.

**citation-badge vs citation-chip:** Keep `.citation-chip` CSS for backward compat (existing tests reference it via template tag). Add `.citation-badge` CSS alongside it. Update streaming.ts DOM construction to use `citation-badge` class on new spans.

**Hard constraint checklist:** No new unauthenticated routes. GET/ and POST/chat remain unauthenticated. Anthropic API key not in response bodies (credit detection reads upstream response body only). No wrangler.toml [vars] additions. Admin auth untouched.

**role="log" already met:** `src/views/chat-page.ts:46` already emits `role="log" aria-live="polite"`. Verify this line survives sprint 1 edits.

## Verification Criteria

All done_when criteria map to deterministic structural checks.