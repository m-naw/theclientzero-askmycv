## Problem Statement

The chat page has a working streaming skeleton but is missing the coherent UX layer required for production: client-side markdown stripping is absent (asterisks and backticks leak into rendered text); citation tokens render with class `citation-chip` rather than the spec-target `citation-badge`; no @keyframes animations exist for typing indicator or message entrance; no auto-scroll control; no mobile keyboard survival strategy; no keyboard shortcuts or send-button disabled state; all Anthropic upstream failures map to the same generic error (credit-balance failures are indistinguishable); no footer with MAINTAINER_* attribution constants; no AGPL-3.0 Section 7(b) clause in LICENSE.

## Addressing Prior Iteration Failures

Attempts 1 and 2 failed at the strategy-loop level due to an unresolvable artifact dependency declared in goal metadata. The resolution for attempt 3: this spec contains NO reference to the missing artifact file path. F11 credit error detection is implemented by parsing the Anthropic HTTP 400 error body inline — behavior scenario 3 provides the complete shape description: `invalid_request_error` type, message containing the substring 'credit'. No fixture file path is referenced in any structured field of this spec. The done_when criterion `fs:contains-regex src/routes/chat.ts /credit/` is satisfied by the detection logic alone.

## Current Behavior

- `src/views/client/streaming.ts`: IIFE with basic SSE pump. `renderInto()` splits on `[cv]` and creates spans with class `citation-chip`. No markdown stripping. No partial-match preservation. No typing indicator DOM. No fade-up animation. No auto-scroll. No keyboard shortcuts. No send-button disabled state.
- `src/views/design-tokens.ts` `baseStyles()`: defines `.citation-chip` CSS. No `@keyframes` rules. No typing-indicator timing vars in `toCssVars()`. No mobile sticky composer CSS. No `prefers-reduced-motion` media query.
- `src/views/chat-page.ts:46`: `role="log" aria-live="polite"` already present on `.message-list` — this done_when criterion is already met. No MAINTAINER_* constants declared. No `<footer>` element.
- `src/routes/chat.ts:202-207`: All upstream non-OK responses return HTTP 502 `{error:"upstream_unavailable"}`. No credit-balance distinction logic.
- `LICENSE`: Vanilla AGPL-3.0 text ends at standard FSF footer. No Section 7(b) additional terms.

## Proposed Changes

### Sprint 1: UI Foundation

**Task 1 — Design Context (ui-analysis):** Check for Figma URLs, tailwind.config.ts, or other design resources. Write `docs/artifacts/design-context.md` recording that the design system is `src/views/design-tokens.ts` CSS custom properties, no external design tool found.

**Task 2 — Animation CSS: @keyframes and timing tokens (design-tokens.ts):**
- In `toCssVars()`: add `--typing-duration: 1.4s` and `--bubble-enter-duration: 400ms`.
- In `baseStyles()`: add `@keyframes typing-dot { 0%,80%,100%{transform:scale(0)} 40%{transform:scale(1)} }` and `@keyframes bubble-enter { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }`.
- Add `.typing-indicator { display:flex; gap:4px; padding:var(--space-sm) }` with three `.dot` children styled via `animation: typing-dot var(--typing-duration) infinite` and delays `0s, 0.2s, 0.4s`.
- Add `.message { animation: bubble-enter var(--bubble-enter-duration) ease-out both }`.
- Add `@media (prefers-reduced-motion: reduce) { .typing-indicator *, .message { animation: none } }`.

**Task 3 — Citation-badge CSS and mobile responsive CSS (design-tokens.ts):**
- Add `.citation-badge` CSS rule in `baseStyles()`: same visual as `.citation-chip` (accent background, mono font, inline-block, border-radius var(--radius-sm), padding 0 var(--space-xs)). Keep `.citation-chip` intact for backward compat.
- Add `min-height: 44px; touch-action: manipulation` to `.btn` and `.composer .textarea` rules.
- Add `.composer-form { position: sticky; bottom: 0; background: var(--color-bg); padding: var(--space-sm) 0; z-index: 10; }` rule.
- Update body rule to use `min-height: 100svh; min-height: 100dvh` (progressive enhancement over `100vh`).
- Add `@media (max-width: 540px) { .composer { flex-direction: column; } .anchors { flex-direction: column; } }`.
- Add `.page-footer { margin-top: var(--space-xl); padding-top: var(--space-md); border-top: 1px solid var(--color-border); font-size: var(--font-sm); color: var(--color-text-muted); display: flex; flex-wrap: wrap; gap: var(--space-md); }` rule.

**Task 4 — MAINTAINER_* constants and footer element (chat-page.ts):**
- Declare at module scope: `const MAINTAINER_GH_USERNAME = 'm-naw'`, `const MAINTAINER_REPO_NAME = 'theclientzero-askmycv'`, `const MAINTAINER_X_HANDLE = 'TheClientZero'`.
- Add optional `x_url?: string` field to `ChatPageProps`.
- Render a `<footer class="page-footer">` containing: (a) canonical-repo anchor `<a href="https://github.com/${MAINTAINER_GH_USERNAME}/${MAINTAINER_REPO_NAME}">askmycv</a>` and `<a href="https://x.com/${MAINTAINER_X_HANDLE}">@TheClientZero</a>`; (b) conditional `Deployed by <display_name>` link when `props.linkedin_url` or `props.x_url` is set; when neither is set, no Deployed-by element renders.
- Update chat-page.test.ts to assert footer anchor presence and conditional Deployed-by logic.

### Sprint 2: Chat UX Logic + Backend + Legal

**Task 5 — Rewrite streaming.ts (F6 markdown + citation-badge pipeline):**
- Extract a pure `stripMarkdown(text: string): string` function: remove `**`/`*` wrappers (bold/italic asterisks), backtick sequences, `# `+ prefix (header markers), `> ` prefix (blockquotes), `- `/`* `/`N. ` prefix (list items).
- Replace `renderInto` with a safe DOM-construction pipeline: for each chunk of the accumulated buffer: (1) apply `stripMarkdown`; (2) hold any tail matching `/\[(?:c(?:v)?)?$/` in a `pending` variable until the next chunk resolves the bracket; (3) on full `[cv]` match, create `span.citation-badge` with `textContent='cv'`; (4) for all other content, `createTextNode(text)` (no innerHTML on model text).
- Adversarial guard: `citation-badge` class must appear in `span.className` assignment in streaming.ts (not only in design-tokens.ts CSS) — otherwise the grep passes but the DOM is wrong.

**Task 6 — Streaming animations, auto-scroll, keyboard UX (streaming.ts continued):**
- Typing indicator: on `send()` invocation, append `.typing-indicator` div with 3 child `.dot` spans; remove on first text delta arrival.
- Auto-scroll (F8): track `userScrolledUp` via debounced `window.addEventListener('scroll', ...)` — set true when `window.scrollY < document.body.scrollHeight - window.innerHeight - 100`; call `window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'})` in pump loop only when `!userScrolledUp`; reset `userScrolledUp = false` unconditionally on new message submit.
- visualViewport snippet: `if (window.visualViewport) { window.visualViewport.addEventListener('resize', function() { document.documentElement.style.setProperty('--visual-vh', window.visualViewport.height + 'px'); }); }` — provides CSS var for mobile keyboard compensation.
- Keyboard UX: `textarea.addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (textarea.value.trim()) submitForm(); } else if (e.key === 'Escape') { textarea.value = ''; textarea.blur(); } })`.
- Send disabled state: `var btn = form.querySelector('button[type=submit]'); textarea.addEventListener('input', function() { btn.disabled = !textarea.value.trim(); }); btn.disabled = true;` on init; `btn.disabled = true` on submit; restore in stream `.finally()`.

**Task 7 — Credit error detection in chat.ts (F11):**
- After `!upstream.ok` check at line ~202: clone the upstream response and attempt JSON parse. If `body.error?.message` (case-insensitive) includes the substring `credit`, return HTTP 502 with `{ error: 'upstream_unavailable', reason: 'credits' }`. All other non-OK paths return existing `{ error: 'upstream_unavailable' }` (no reason field).
- The word `credit` must appear in the detection conditional (satisfies done_when grep).
- In streaming.ts error handler: parse fetch response; if `json && json.reason === 'credits'`, display distinct message 'Service temporarily unavailable: API credit limit reached. Please try again later.'; else display generic error.
- Hard constraint check: the Anthropic API key is never in the response body; credit detection only reads the upstream response body (not headers containing the key).

**Task 8 — LICENSE Section 7(b) clause:**
- Append to LICENSE before final newline: 'Additional Terms under GNU AGPL-3.0 Section 7(b):\n\nAny version of this Program made available over a computer network must display, in its user interface, a prominent link to the canonical source repository: https://github.com/m-naw/theclientzero-askmycv\nThis attribution notice may not be removed or obscured by any downstream distributor or fork.'.

**Task 9 — Tests and regression verification:**
- Update `src/test/views/chat-page.test.ts`: assert MAINTAINER_GH_USERNAME constant presence in rendered HTML; assert footer contains 'askmycv' link and x.com/TheClientZero link; assert conditional Deployed-by logic.
- Add credit-error test: mock Anthropic upstream returning HTTP 400 with `{error:{type:'invalid_request_error',message:'credit balance too low'}}`, verify worker returns HTTP 502 `{error:'upstream_unavailable',reason:'credits'}`.
- Run `pnpm test`, `pnpm build`, `pnpm typecheck`, `pnpm lint`.

## Implementation Notes

**ATTEMPT 3 FIX — No artifact file path referenced:** This spec intentionally omits all references to the missing fixture file path. F11 credit detection is derived from behavior scenario 3 inline: HTTP 400, `invalid_request_error` type, message containing 'credit'. The done_when criterion `fs:contains-regex src/routes/chat.ts /credit/` is satisfied by substring detection logic alone. No pre-existing fixture file is required.

**citation-badge vs citation-chip naming:** Keep `.citation-chip` in CSS and primitives for backward compat (existing tests reference citation-chip template tag). Add `.citation-badge` as new CSS class. Update streaming.ts `renderInto` to create spans with `className = 'citation-badge'` for new dynamic renders. Adversarial guard: grep for `citation-badge` must hit streaming.ts (DOM construction), not only design-tokens.ts (CSS definition).

**Token-discipline test compatibility:** `@keyframes` percentage values, `opacity`, `transform` keywords are not hex/px/rem literals. Timing values `1.4s` and `400ms` go into `toCssVars()` as CSS vars (`--typing-duration`, `--bubble-enter-duration`) which is the declared safe zone for raw literals in this project.

**role="log" aria-live="polite" already met:** `src/views/chat-page.ts:46` already emits these attributes. Verify they survive sprint 1 edits to chat-page.ts.

**Hard constraint checklist:** No new unauthenticated routes added. GET/ and POST/chat remain unauthenticated. No wrangler.toml [vars] changes. Anthropic API key never appears in response bodies (credit detection only reads upstream response body). Admin password handling untouched.

## Verification Criteria

1. `grep -r 'citation-badge' src/views --include='*.ts' | grep -q .` — falsified if only CSS defined but streaming.ts still uses citation-chip class
2. `grep -r '@keyframes' src/views --include='*.ts' | grep -q .` — falsified if design-tokens.ts has no @keyframes block
3. `grep -rE '1\.4s|1400ms|typing.?duration' src/ --include='*.ts' | grep -q .` — satisfied by --typing-duration:1.4s in toCssVars()
4. `grep -r 'prefers-reduced-motion' src/views --include='*.ts' | grep -q .` — falsified if no @media block
5. `grep -rE 'visualViewport|100dvh|position:\s*sticky' src/views --include='*.ts' | grep -q .` — satisfied by any two of the three techniques
6. `grep -rE 'shiftKey' src/views --include='*.ts' | grep -q .` — falsified if keydown handler does not branch on shiftKey
7. `grep -r 'MAINTAINER_GH_USERNAME' src/ --include='*.ts' | grep -q .` — falsified if constant not declared
8. `grep -r 'm-naw' src/views --include='*.ts' | grep -q .` — falsified if footer anchor href does not contain 'm-naw'
9. `grep -r 'TheClientZero' src/views --include='*.ts' | grep -q .` — falsified if x.com link not rendered
10. `grep -c 'Section 7(b)' LICENSE | awk '{exit ($1 == 0)}'` — falsified if no Section 7(b) text in LICENSE
11. `grep -E 'credit' src/routes/chat.ts | grep -q .` — falsified if detection conditional does not use 'credit' substring
12. `grep -rE 'role="log"|aria-live="polite"' src/views --include='*.ts' | grep -q .` — already met at chat-page.ts:46
13. `grep -rE 'button\.disabled\s*=\s*true|setAttribute\(.disabled' src/views --include='*.ts' | grep -q .` — falsified if send button not disabled on submit
14. `pnpm test` exits 0
15. `pnpm build` exits 0
16. `pnpm typecheck` exits 0