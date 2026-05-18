## Problem Statement

The chat page has a working streaming skeleton but is missing the coherent UX layer that makes it production-grade: markdown stripping (asterisks, backticks, headers leak into DOM text), citation-badge rendering (existing renderInto uses citation-chip but the goal targets citation-badge), no @keyframes animations, no auto-scroll control, no mobile keyboard handling, no keyboard shortcuts (Enter/Shift+Enter/Escape), no send-button disabled state, no credit-distinct error handling, and no footer attribution. LICENSE carries no AGPL-3.0 Section 7(b) additional terms clause.

## Current Behavior

- `src/views/client/streaming.ts`: single IIFE, basic SSE pump, `renderInto()` splits on `[cv]` only, no markdown strip, no partial-match regex, constructs `citation-chip` spans. No typing indicator, no fade-up, no auto-scroll, no keyboard shortcuts, no send-disabled state.
- `src/views/design-tokens.ts`: defines CSS vars and `baseStyles()`. Has `.citation-chip` CSS. No `@keyframes`, no typing-indicator timing vars, no mobile-specific rules.
- `src/views/chat-page.ts:46`: `role="log" aria-live="polite"` already present (criterion already met). No footer with MAINTAINER_* constants. No `x_url` prop.
- `src/routes/chat.ts:202-207`: all upstream non-OK responses map to `{error:"upstream_unavailable"}` with HTTP 502 — no credit-balance distinction.
- `LICENSE`: vanilla AGPL-3.0, no Section 7(b) additional terms.

## Proposed Changes

### Sprint 1: UI Foundation

**Task 1 — Design Context (ui-analysis):** Inspect available design resources (Figma URL, tailwind.config.ts). Write `docs/artifacts/design-context.md` recording available tokens. Expected: no Figma URL found; design system is `design-tokens.ts` with CSS vars.

**Task 2 — Animation tokens and @keyframes:** In `design-tokens.ts`:
- Add CSS var `--anim-typing-duration: 1.4s` and `--anim-bubble-enter: 400ms` to `toCssVars()`.
- Add `@keyframes typing-dot { 0%,80%,100%{transform:scale(0)}40%{transform:scale(1)} }` in `baseStyles()`.
- Add `@keyframes bubble-enter { from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none} }` in `baseStyles()`.
- Add `.typing-indicator` (3-dot wrapper with staggered `animation-delay: 0s, 0.2s, 0.4s`) and `.message { animation: bubble-enter var(--anim-bubble-enter) ease-out both }` CSS rules.
- Add `@media (prefers-reduced-motion: reduce) { .typing-indicator *, .message { animation: none } }` block.

**Task 3 — citation-badge CSS class:** In `design-tokens.ts` `baseStyles()`, add `.citation-badge` CSS rule identical to existing `.citation-chip` styling (inline-block, accent background, mono font). The class name `citation-badge` is the target for the done_when grep; keep `.citation-chip` for backward compat with existing tests.

**Task 4 — Mobile-responsive CSS:** In `design-tokens.ts` `baseStyles()`:
- Add `.composer-form { position: sticky; bottom: 0; background: var(--color-bg); padding-block: var(--space-sm); }`.
- Add `min-height: 44px; touch-action: manipulation` to `.btn` and `.composer .textarea`.
- Add `@media (max-width: 540px) { .anchors { flex-direction: column; gap: var(--space-sm); } }`.
- Add `100dvh` fallback: `body { min-height: 100svh; min-height: 100dvh; }` (overrides `100vh`).

**Task 5 — MAINTAINER_* constants and footer in chat-page.ts:**
- Declare `const MAINTAINER_GH_USERNAME = 'm-naw'`, `const MAINTAINER_REPO_NAME = 'theclientzero-askmycv'`, `const MAINTAINER_X_HANDLE = 'TheClientZero'` at module level.
- Add `ChatPageProps.x_url?: string` to the interface (optional, for conditional Deployed-by link).
- Render a `<footer>` element inside the body HTML containing: canonical repo link to `https://github.com/${MAINTAINER_GH_USERNAME}/${MAINTAINER_REPO_NAME}` (visible text includes 'askmycv'), X link to `https://x.com/${MAINTAINER_X_HANDLE}`, and conditional "Deployed by" link when `props.linkedin_url` or `props.x_url` is set.

### Sprint 2: Feature Logic + Backend + Legal

**Task 6 — Rewrite streaming.ts (F6 markdown + citation-badge pipeline):**
- Add markdown-stripping helper: strip `**`, `*`, `` ` ``, `##+`, `> `, list markers (`- `, `* `, `1. `).
- Replace `renderInto` split logic: HTML-escape all non-badge content; replace literal `[cv]` with `<span class="citation-badge">cv</span>`.
- Add partial-match preservation: hold back tail of accumulator matching `/\[(?:c(?:v)?)?$/` until next chunk arrives or stream ends.
- Use DOM construction (createElement + textContent) for safe non-badge text, innerHTML only for badge span (already safe — hardcoded literal, not model text).

**Task 7 — Typing indicator DOM (F7):**
- On `send()` start, append a `.typing-indicator` div with 3 `.dot` children; remove it when first text delta arrives.
- Bubble `.message` elements get class `message-enter` triggering `bubble-enter` keyframe via CSS `.message` rule.

**Task 8 — Auto-scroll (F8):**
- Track user scroll offset on the `window` (or `.message-list` scroll parent).
- `userScrolledUp = window.scrollY < document.body.scrollHeight - window.innerHeight - 100`.
- Auto-scroll only when `!userScrolledUp`; unconditionally scroll on new message submit.

**Task 9 — Keyboard UX (F10):**
- `textarea.addEventListener('keydown')`: if `Enter` without `shiftKey`, call `e.preventDefault()` and submit; `Shift+Enter` inserts newline (default browser behavior, no interception); `Escape` clears and blurs textarea.
- Suggested chip click calls `send(question)` directly (already implemented; verify it clears the textarea).
- Send button: set `button.disabled = true` on submit; restore on stream complete/error. Also set disabled when textarea value is whitespace-only (input event listener).

**Task 10 — Credit-error distinction in chat.ts (F11):**
- After `await fetch(...)` for the Anthropic upstream, when `!upstream.ok`, attempt to parse the upstream JSON body.
- If parsed body contains `error.message` that includes `'credit'` (case-insensitive), return HTTP 502 with `{ error: 'upstream_unavailable', reason: 'credits' }`.
- All other non-OK upstreams return existing `{ error: 'upstream_unavailable' }` with no `reason` field.
- In streaming.ts error handler: detect `reason === 'credits'` in the parsed error response and render a distinct credit-specific user message.

**Task 11 — LICENSE Section 7(b) clause:**
- Append to LICENSE (before "END OF TERMS AND CONDITIONS"):
  ```
  Additional Terms under Section 7(b):

  Any modified version of this Program that is made available to users
  interacting over a network must display, in the user interface, a
  prominent link to the canonical source repository:
  https://github.com/m-naw/theclientzero-askmycv
  This requirement may not be removed by any downstream distributor.
  ```

**Task 12 — Tests:** Add/update vitest tests in `src/test/views/chat-page.test.ts` and a new `src/test/views/streaming.test.ts` covering: citation-badge rendering on `[cv]`, partial-match regex behavior, markdown stripping, MAINTAINER_* constants presence in rendered HTML, footer links, send-button disabled state (DOM assertions via jsdom if available), credit error shape detection in chat.ts.

## Implementation Notes

**IMPLEMENTATION_NOTES — Flagged criteria (confidence < 0.85):**

1. **Credit error shape (F11):** No `references/anthropic-messages-error.json` fixture found (references/ directory does not exist). The detection must be derived from Anthropic API documentation: HTTP 400 with `error.type = 'invalid_request_error'` and `error.message` containing 'credit'. The done_when only requires `grep /credit/ src/routes/chat.ts` — implementation must ensure the word 'credit' appears in the detection logic. Risk: if Anthropic changes the error message, detection breaks silently. Mitigation: use case-insensitive substring match, not exact string.

2. **citation-badge vs citation-chip naming:** The existing code uses `citation-chip` in primitives, design-tokens, and streaming.ts. The done_when requires `citation-badge`. The adversarial guard is: both the CSS class definition in design-tokens.ts AND the DOM construction in streaming.ts renderInto must use `citation-badge` — a CSS-only addition would satisfy the grep but break the visual. Plan: add `.citation-badge` CSS alongside `.citation-chip`; update streaming.ts renderInto to use `citation-badge` class on new span elements. Do not remove `citation-chip` (existing tests reference it in the template tag).

3. **Token-discipline test compatibility:** `@keyframes` can contain percentage values and CSS keywords — these are not hex/px/rem literals so the token-discipline guard test will not fire. Timing values (1.4s, 400ms) will be defined as CSS vars in `toCssVars()`, which is the declared safe zone for raw literals.

4. **visualViewport API:** The done_when regex includes `visualViewport`. Adding `position: sticky` and `100dvh` in CSS satisfies the criterion. Additionally, include a small inline JS snippet in streaming.ts that reads `window.visualViewport?.height` to set `--visual-vh` CSS var — this handles the iOS Safari on-screen keyboard collapse case without requiring a framework.

5. **Already-met criterion:** `src/views/chat-page.ts:46` already emits `role="log" aria-live="polite"`. No work needed for this criterion; verify it survives the Sprint 1 chat-page.ts edits.

## Verification Criteria

See verificationCriteria field.