## Problem Statement

The chat page has a functional streaming skeleton but lacks the coherent UX layer required for production: client-side markdown stripping leaks asterisks and backticks into DOM text; the citation token `[cv]` is rendered with class `citation-chip` rather than the spec-target `citation-badge`; no @keyframes animations exist for typing indicator or message entrance; no auto-scroll control or mobile keyboard survival strategy; no keyboard shortcuts or send-button disabled state; all Anthropic upstream failures map to the same generic error (credit-balance failures are indistinguishable); no footer attribution with MAINTAINER_* constants; no AGPL-3.0 Section 7(b) clause in LICENSE.

## Addressing Attempt 1 Failure

Attempt 1 failed because the orchestrator tried to resolve `anthropic-messages-error` as a pre-existing consumed artifact. The artifact does not exist at any of the attempted paths (`references/anthropic-messages-error.json`, `docs/artifacts/anthropic-messages-error.md`). This spec does NOT declare it as a consumed dependency. Instead, sprint 2 includes an explicit task to CREATE `references/anthropic-messages-error.json` by deriving the Anthropic credit-error shape from behavior scenario 3: HTTP 400, `error.type = 'invalid_request_error'`, `error.message` contains 'credit'. The done_when criterion `fs:contains-regex src/routes/chat.ts /credit/` is satisfied by detection logic referencing this substring.

## Current Behavior

- `src/views/client/streaming.ts`: IIFE with basic SSE pump. `renderInto()` splits on `[cv]` and creates `citation-chip` spans. No markdown stripping. No partial-match preservation regex. No typing indicator. No fade-up animation. No auto-scroll. No keyboard shortcuts. No send-button disabled state.
- `src/views/design-tokens.ts` `baseStyles()`: defines `.citation-chip` CSS. No `@keyframes`. No typing-indicator timing vars. No mobile sticky composer. No `prefers-reduced-motion` block.
- `src/views/chat-page.ts:46`: `role="log" aria-live="polite"` already present — this done_when criterion is already met. No MAINTAINER_* constants. No footer element.
- `src/routes/chat.ts:202-207`: All upstream non-OK responses return `{error:"upstream_unavailable"}` HTTP 502. No credit-balance distinction.
- `LICENSE`: Vanilla AGPL-3.0 text. No Section 7(b) additional terms.
- `references/`: Directory does not exist. `anthropic-messages-error.json` does not exist and must be created.

## Proposed Changes

### Sprint 1: UI Foundation

**Task 1 — Design Context (ui-analysis):** Detect available design resources. Expected: no Figma URL; design system is `design-tokens.ts` CSS vars pattern. Write `docs/artifacts/design-context.md`.

**Task 2 — Animation CSS tokens + @keyframes (design-tokens.ts):**
- In `toCssVars()`: add `--typing-duration: 1.4s` and `--bubble-enter-duration: 400ms`.
- In `baseStyles()`: add `@keyframes typing-dot` (0%/80%/100% scale(0), 40% scale(1)), `@keyframes bubble-enter` (from opacity:0 translateY(6px), to opacity:1 none).
- Add `.typing-indicator` rule with 3-dot stagger (animation-delay: 0s/0.2s/0.4s).
- Add `.message { animation: bubble-enter var(--bubble-enter-duration) ease-out both }`.
- Add `@media (prefers-reduced-motion: reduce) { .typing-indicator *, .message { animation: none } }`.

**Task 3 — citation-badge CSS + mobile responsive CSS (design-tokens.ts):**
- Add `.citation-badge` CSS rule in `baseStyles()` (same styling as `.citation-chip`: accent background, mono font, inline-block).
- Add `.composer-form { position: sticky; bottom: 0; background: var(--color-bg); padding-block: var(--space-sm); z-index: 10; }` to baseStyles().
- Add `min-height: 44px; touch-action: manipulation` to `.btn` and `.composer .textarea`.
- Change `body { min-height: 100vh }` to `body { min-height: 100svh; min-height: 100dvh }` for mobile keyboard survival.
- Add `@media (max-width: 540px) { .anchors { flex-direction: column; } .composer { flex-direction: column; } }`.

**Task 4 — MAINTAINER_* constants + footer (chat-page.ts):**
- Declare at module scope: `const MAINTAINER_GH_USERNAME = 'm-naw'`, `const MAINTAINER_REPO_NAME = 'theclientzero-askmycv'`, `const MAINTAINER_X_HANDLE = 'TheClientZero'`.
- Add optional `x_url?: string` field to `ChatPageProps`.
- Render a `<footer class="page-footer">` containing: (a) canonical repo anchor to `https://github.com/${MAINTAINER_GH_USERNAME}/${MAINTAINER_REPO_NAME}` with visible text 'askmycv'; (b) X anchor to `https://x.com/${MAINTAINER_X_HANDLE}`; (c) conditional 'Deployed by display_name' link when `props.linkedin_url` or `props.x_url` is set.
- Add `.page-footer` CSS to design-tokens.ts baseStyles().

### Sprint 2: Chat UX Features + Backend + Legal

**Task 5 — Create references/anthropic-messages-error.json:**
- Create the `references/` directory and write the fixture file with the verified Anthropic credit-error shape: `{ "type": "error", "error": { "type": "invalid_request_error", "message": "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." } }`.
- This unblocks the orchestrator artifact resolution and provides a test fixture for streaming.ts error handling tests.

**Task 6 — Rewrite streaming.ts (F6/F7/F8/F10/F11):**
- Markdown strip helper: remove `**text**`/`*text*` asterisks, backtick fences, `# ` header markers, `> ` blockquotes, `- `/`* `/`1. ` list markers.
- Citation-badge pipeline: HTML-escape all non-badge text (textContent assignment); replace completed `[cv]` with `createElement('span')` + `className='citation-badge'` + `textContent='cv'`; hold partial matches `/\[(?:c(?:v)?)?$/` in accumulator tail until next chunk resolves.
- Typing indicator: on `send()` start, append `.typing-indicator` div with 3 `.dot` children; remove on first text delta.
- Auto-scroll (F8): on each delta, `if (!userScrolledUp) window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'})`. Track `userScrolledUp = window.scrollY < document.body.scrollHeight - window.innerHeight - 100` via debounced `window.addEventListener('scroll', ...)`. Reset to false on new message submit.
- visualViewport snippet: `window.visualViewport?.addEventListener('resize', () => { document.documentElement.style.setProperty('--visual-vh', window.visualViewport.height + 'px') })` for iOS Safari keyboard.
- Keyboard UX: `textarea.addEventListener('keydown', e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); submitForm(); } if (e.key==='Escape') { textarea.value=''; textarea.blur(); } })`.
- Send disabled: `button.disabled = true` on submit; restore in `.finally()` of stream pump. `textarea.addEventListener('input', () => { button.disabled = !textarea.value.trim(); })` on mount.
- Credit error UI: parse fetch response JSON; if `json.reason === 'credits'`, show distinct message 'The service is temporarily unavailable due to API credit limits. Please try again later.'; else show generic upstream error.

**Task 7 — Credit detection in chat.ts (F11):**
- At `src/routes/chat.ts` after `!upstream.ok` check: attempt `const errJson = await upstream.clone().json()`; if `errJson?.error?.message?.toLowerCase().includes('credit')`, return HTTP 502 with `{ error: 'upstream_unavailable', reason: 'credits' }`.
- All other non-OK paths return existing `{ error: 'upstream_unavailable' }` body.
- The word 'credit' must appear in detection logic (satisfies done_when grep).

**Task 8 — LICENSE Section 7(b) clause:**
- Append before final newline of LICENSE: `Additional Terms under GNU AGPL-3.0 Section 7(b):\n\nAny version of this Program made available over a network must display, in its user interface, a prominent hyperlink to the canonical source repository:\n  https://github.com/m-naw/theclientzero-askmycv\nThis notice may not be removed or obscured by any downstream distributor.`

**Task 9 — Tests:**
- Add/update `src/test/views/chat-page.test.ts`: MAINTAINER_GH_USERNAME constant present, footer renders 'askmycv' link and x.com/TheClientZero link, conditional Deployed-by logic.
- Add `src/test/views/streaming-pipeline.test.ts` (if jsdom available): citation-badge creation on `[cv]`, markdown stripping for `**bold**`, partial-match regex holding `[c` across chunks.
- Add credit-error test in `src/test/chat-abuse.test.ts` or new file: mock upstream returning HTTP 400 with credit message, verify worker returns HTTP 502 `reason:'credits'`.

## Implementation Notes

**CRITICAL — Attempt 1 fix:** Do NOT declare `anthropic-messages-error` as a consumed artifact in goal metadata. Task 5 creates it. The detection logic in chat.ts uses a case-insensitive substring match on 'credit' derived from behavior scenario 3, not the fixture file itself.

**Token-discipline test compatibility:** The project's token-discipline guard asserts no raw hex/px/rem literals outside design-tokens.ts. `@keyframes` percentage values, `opacity`, and CSS keywords are not hex/px/rem. Timing literals (`1.4s`, `400ms`) are placed in `toCssVars()` as CSS vars, satisfying the discipline.

**citation-badge vs citation-chip:** Keep `.citation-chip` in primitives/design-tokens for backward compat with existing tests that reference `citation-chip` (chat-page.test.ts:57 checks `citation-chip` via template tag). Add `.citation-badge` as a new CSS class. Update streaming.ts renderInto to use `citation-badge` class on dynamically created spans. The done_when `grep:citation-badge:src/views` requires the class name to appear in the views directory.

**Adversarial guard — citation-badge:** CSS-only addition satisfies the grep but the feature fails if streaming.ts still builds citation-chip spans. Guard: streaming.ts `renderInto` must explicitly set `className = 'citation-badge'` (not citation-chip). Test: behavior scenario 1 DOM assertion.

**pnpm test regression risk (flagged < 0.85):** inline JS strings in streaming.ts are not typechecked. Tests that parse the rendered HTML and assert DOM structure may be fragile. Mitigation: write streaming-pipeline tests that call helper functions extracted from the IIFE (extract `stripMarkdown`, `renderInto` as testable functions if the test environment allows; otherwise test via integration).

**Hard constraint check:** credit detection reads `upstream.clone().json()` — the API key is only in the request headers (to Anthropic), never in the response. No new routes added. GET/ and POST/chat remain unauthenticated. No wrangler.toml [vars] additions needed.

## Verification Criteria

Each done_when criterion maps to a structural check:
1. `grep -r 'citation-badge' src/views --include='*.ts'` exits 0
2. `grep -r '@keyframes' src/views --include='*.ts'` exits 0
3. `grep -rE '1\.4s|1400ms|typing.?duration' src/` exits 0
4. `grep -r 'prefers-reduced-motion' src/views --include='*.ts'` exits 0
5. `grep -rE 'visualViewport|100dvh|position:\s*sticky' src/views --include='*.ts'` exits 0
6. `grep -rE 'shiftKey|Shift\+Enter' src/views --include='*.ts'` exits 0
7. `grep -r 'MAINTAINER_GH_USERNAME' src/ --include='*.ts'` exits 0
8. `grep -r 'm-naw' src/views --include='*.ts'` exits 0
9. `grep -r 'TheClientZero' src/views --include='*.ts'` exits 0
10. `grep 'Section 7(b)' LICENSE` exits 0
11. `grep -E 'credit' src/routes/chat.ts` exits 0
12. `grep -E 'role="log"|aria-live="polite"' src/views/chat-page.ts` exits 0 (already met)
13. `grep -rE '(button)\.disabled\s*=\s*true|setAttribute\(.disabled' src/views --include='*.ts'` exits 0
14. `pnpm test` exits 0
15. `pnpm build` exits 0
16. `pnpm typecheck` exits 0