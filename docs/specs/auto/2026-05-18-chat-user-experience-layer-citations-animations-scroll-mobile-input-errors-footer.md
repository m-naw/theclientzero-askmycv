# G5 Specification: Chat User Experience Layer

## Overview

G5 implements the full client-side UX layer for the askmycv chat interface, covering seven discrete features: markdown stripping and citation-badge rendering (F6), streaming animations (F7), auto-scroll (F8), mobile-responsive layout (F9), keyboard UX (F10), credit-distinct error handling (F11), and footer attribution (F14).

All CSS timing literals (1.4s, 400ms) must live in `design-tokens.ts` as CSS custom properties; raw values must not appear elsewhere. The `citation-chip` class must be preserved for backward compatibility with existing tests.

---

## Feature Specifications

### F6 — Markdown Stripping + Citation-Badge Pipeline

**File:** `src/views/client/streaming.ts`

The `renderInto(node, text)` function must:
1. Strip markdown before rendering: remove `**bold**`, `*italic*`, `` `code` ``, `# heading`, `- list item` patterns using a `stripMarkdown(text: string): string` helper that applies regex replacements.
2. Buffer partial `[cv]` tokens at the end of accumulator: use regex `/\[(?:c(?:v)?)?$/` to detect a partial citation token in progress and withhold that suffix from rendering until the next chunk completes or closes it.
3. Split the stripped text on `[cv]` (full match) to produce alternating text/badge nodes.
4. For each `[cv]` split: create a `<span class="citation-chip citation-badge">` element (keeping `citation-chip` for compat, adding `citation-badge` as additional class).
5. Use `document.createTextNode()` for all plain text segments — no `innerHTML` on streamed model output.

### F7 — Streaming Animations

**File:** `src/views/design-tokens.ts`

Add to `toCssVars()` output:
- `--typing-duration: 1.4s`
- `--bubble-enter-duration: 400ms`

Add to `baseStyles()` output:
- `@keyframes typing-dot` — three-dot pulsing indicator:
  - Dots animate opacity 0.2 → 1 → 0.2 over `var(--typing-duration)` with `infinite` iteration.
  - Three `.dot` children get `animation-delay: 0s`, `0.2s`, `0.4s` respectively.
- `@keyframes bubble-enter` — message fade-up on arrival:
  - `from { opacity: 0; transform: translateY(8px); }`
  - `to { opacity: 1; transform: translateY(0); }`
  - Duration: `var(--bubble-enter-duration)`; easing: `ease-out`; fill-mode: `both`.
- `.message` rule: `animation: bubble-enter var(--bubble-enter-duration) ease-out both;`
- `.typing-indicator` rule: `display: flex; gap: 4px; padding: 8px 12px;`
- `.typing-indicator .dot` rule: `width: 8px; height: 8px; border-radius: 50%; background: currentColor; opacity: 0.2; animation: typing-dot var(--typing-duration) infinite;`
- `@media (prefers-reduced-motion: reduce)` block:
  - `*, *::before, *::after { animation: none !important; transition: none !important; }`

**File:** `src/views/client/streaming.ts`

Typing indicator lifecycle:
- Before `fetch('/chat')` resolves: append a `<div class="typing-indicator">` with three `<span class="dot">` children to `.message-list`.
- On first streamed delta: remove the typing indicator element.
- On stream error: remove the typing indicator element.

### F8 — Auto-Scroll

**File:** `src/views/client/streaming.ts`

Auto-scroll behavior:
- After every `renderInto()` call: if `(document.documentElement.scrollHeight - window.scrollY - window.innerHeight) < 100` then call `window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })`.
- This 100px threshold prevents jumping when the user has scrolled up to read earlier messages.

### F9 — Mobile-Responsive Layout

**File:** `src/views/design-tokens.ts`

Add to `baseStyles()` CSS:
- `body, .page { min-height: 100dvh; }` with fallback `min-height: 100vh;` for browsers without `dvh` support.
- `.composer-form { position: sticky; bottom: 0; background: var(--color-surface); padding: 8px; }`
- `.btn, .composer .textarea { min-height: 44px; }` — ensures 44px touch targets.
- `@media (max-width: 540px)` breakpoint:
  - `.page { padding: 8px; }`
  - `.composer-form { padding: 4px; }`
- `.page-footer { text-align: center; padding: 16px 0; font-size: 0.75rem; opacity: 0.6; }`

**File:** `src/views/client/streaming.ts`

Visual viewport (iOS Safari keyboard survival):
- Listen to `window.visualViewport?.addEventListener('resize', handler)` if `visualViewport` is available.
- Handler: set `document.body.style.height = window.visualViewport.height + 'px'` to contract the body when the soft keyboard pushes the viewport up.

### F10 — Keyboard UX

**File:** `src/views/client/streaming.ts`

- Attach `keydown` listener to the textarea:
  - `Enter` (without `shiftKey`): `e.preventDefault(); form.requestSubmit();`
  - `Shift+Enter`: allow default (inserts newline).
  - `Escape`: `input.blur();`
- Send-button disabled state:
  - Before `fetch('/chat')` call: `btn.disabled = true; btn.textContent = 'Sending…';`
  - After stream completes (done or error): `btn.disabled = false; btn.textContent = 'Send';`
  - Locate button via `form.querySelector('button[type="submit"]')`.

### F11 — Credit-Distinct Error Handling

**File:** `src/routes/chat.ts`

In the handler that proxies the Anthropic upstream response:
- When upstream returns a non-OK status: read the response body as JSON.
- If `body?.error?.message?.toLowerCase().includes('credit')` is true: return HTTP 502 with `{ error: 'upstream_unavailable', reason: 'credits' }`.
- Otherwise: return HTTP 502 with `{ error: 'upstream_unavailable' }` (existing behavior).
- Reference shape: `references/anthropic-messages-error.json`.

**File:** `src/views/client/streaming.ts`

Client-side credit error display:
- After `fetch('/chat')` resolves: check `res.status === 502` and parse body JSON.
- If `data?.reason === 'credits'`: set `bubble.textContent = 'Chat is temporarily unavailable — credit limit reached.'`
- Else for other non-OK status: set `bubble.textContent = 'Something went wrong. Please try again.'`

### F14 — Footer Attribution

**File:** `src/views/chat-page.ts`

At module scope (not inside the render function), declare:
```typescript
const MAINTAINER_GH_USERNAME = 'm-naw';
const MAINTAINER_REPO_NAME = 'theclientzero-askmycv';
const MAINTAINER_X_HANDLE = 'TheClientZero';
```

Append to the page body a `<footer class="page-footer">` element containing:
- A canonical repo link: `<a href="https://github.com/${MAINTAINER_GH_USERNAME}/${MAINTAINER_REPO_NAME}">Source on GitHub</a>`
- Attribution text referencing the maintainer
- An X.com link: `<a href="https://x.com/${MAINTAINER_X_HANDLE}">@${MAINTAINER_X_HANDLE}</a>`
- AGPL-3.0 notice text

**File:** `LICENSE`

Append an AGPL-3.0 Section 7(b) additional terms clause:
```
Additional Terms (Section 7(b) of AGPL-3.0)

As an additional requirement under Section 7(b) of the GNU Affero General
Public License v3.0, you must preserve the attribution notice and canonical
repository link appearing in the footer of all user-facing HTML pages served
by this software. The canonical repository URL is:
  https://github.com/m-naw/theclientzero-askmycv
This notice must remain visible and unmodified in all modified versions.
```

---

## Security Invariants (must be preserved)

- Anthropic API key never appears in any HTML response or worker console output.
- Admin plaintext password is never persisted in any KV value; only bcrypt/argon2id hash is stored.
- Daily Anthropic spend cap and per-IP chat rate limit are enforced on every chat request; no bypass path.
- GET / and POST /chat remain unauthenticated; admin login is never required to view public chat.
- Cloudflare Access JWT verification is auto-detected and optional; never hardcoded as mandatory.
- No production-visible variable used for test mocking is introduced into wrangler.toml [vars].

---

## Token Discipline

- `design-tokens.ts` is the ONLY file allowed to contain raw hex/px/rem/timing literals.
- Animation durations 1.4s and 400ms must be CSS vars (`--typing-duration`, `--bubble-enter-duration`).
- All other files reference these via `var(--typing-duration)` etc.