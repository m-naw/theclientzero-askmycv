# AskMyCV — Product Specification v2.1

**Version:** 2.1
**Supersedes:** v2.0 (which superseded v1.1)
**Document purpose:** Defines what AskMyCV must do and how it must behave from the user's perspective. This document is the source of truth for acceptance. Technical decisions outside the explicit business constraints are left to the implementer.

This version expands v1 with operationalized UI/UX requirements, replaces mandatory Cloudflare Access with password-based admin authentication (with optional CF Access as progressive enhancement), and introduces structured documentation requirements.

**Changelog v2.0 → v2.1 (post-Confidence-Protocol review):**
- META section strengthened with an explicit "spec is not authoritative on third-party API contracts" rule. Implementers must verify against current docs or empirically before implementing 3rd-party-dependent branches.
- F11 error handling: replaced incorrect "HTTP 402 from Anthropic" claim with verified mapping based on Anthropic's actual API behavior (HTTP 400 with `invalid_request_error` and credit-balance message for insufficient credits). Source: github.com/anthropics/anthropic-sdk-typescript/issues/618.
- F12 password hashing: added Cloudflare Workers V8 isolate compatibility constraint (pure-JS libraries only; native bindings fail to deploy).
- F13 `/admin/reset`: fully specified endpoint contract (request body schema with literal confirmation string, error responses, UI requirements).
- F14 footer attribution: separated `MAINTAINER_GH_USERNAME` (`m-naw`), `MAINTAINER_REPO_NAME` (`theclientzero-askmycv`), and `MAINTAINER_X_HANDLE` (`TheClientZero`) as distinct hardcoded constants. All values confirmed by project owner.
- F6 citation regex: corrected partial-match preservation regex from `/\[c?v?$/` (which matched `[v` standalone) to `/\[(?:c(?:v)?)?$/` (precise to expected streaming sequence).
- F9 mobile keyboard: acknowledged limitation that on-screen keyboard interaction is not autonomously verifiable; added done_when for verifying the implementation made a documented attempt without claiming runtime verification.
- New file required: `docs/SPEC_CORRECTIONS.md` for implementers to record verified deviations from this spec when reality differs.
- New META section: **UX principle: self-contained in-app instructions**. All in-app error/recovery HTML pages must contain full step-by-step instructions inline; no "see docs/X.md" redirects, no `recovery_url` JSON fields pointing to external documentation. F2 (setup-window-expired) and F19 (admin "Forgot password") rewritten to specify exact inline content. Test 9 strengthened and Test 20 added to enforce inline-only verification.

---

## Implementation context

**This is a modification specification for an existing repository, not a from-scratch build.**

The target repository already contains a working AskMyCV implementation. This spec describes the **target state** that the existing implementation must be brought to. The implementer's job is to compute the diff between current state (existing code) and target state (this spec), then apply it.

### Mode of operation

1. **Read the existing codebase first.** Worker source, `wrangler.toml`, docs, package manifests, tests. Existing code IS the baseline — not any prior specification document. Whatever the code does today is what's there.

2. **Read this spec.** For each section below, classify the work:
   - **MODIFIED** sections — existing behavior changes per the listed deltas.
   - **REPLACES** sections — existing behavior is removed and replaced.
   - **NEW** sections (those without a MODIFIED/REPLACES status marker) — features to add from scratch.
   - **Anything not mentioned in this spec is preserved.** If existing code does X and this spec is silent on X, X stays.

3. **Plan in chunks.** Group related changes (e.g., theme system + message formatting + animations as one UI chunk). Each chunk should leave the worker in a deployable state.

4. **Execute.** Apply chunks. Keep diff readable.

### Escalation protocol

Escalate to the human operator before proceeding if:
- Existing code structure makes a required change substantially harder than expected (e.g., the worker has no clear separation that would let admin auth be cleanly replaced).
- An ambiguity in this spec can't be resolved by reading the existing code and the spec together.
- A third-party API behavior referenced by this spec doesn't match what the implementer observes empirically.

Silently working around such issues is forbidden — that's the failure mode this protocol prevents.

### No backward compatibility required

There are no production deployments to preserve. The owner accepts that after migration, the `STATE` KV namespace may need to be wiped and setup re-run. **Do not write backward-compatibility code** for old-shape KV data. If the implementer finds themselves writing "detect old state and migrate" code paths, that's wasted complexity — the owner will wipe and re-setup.

---

## Verification model

Every `done_when` item in this spec must be **autonomously verifiable** by an implementer running tests against a local instance of the Worker (e.g., `wrangler dev`) with mocked external dependencies. Specifically, acceptance is established by:

- **HTTP probing:** sending requests to the running Worker and asserting on status codes, headers, response bodies (parsed HTML, JSON, or SSE streams).
- **KV inspection:** reading and writing to the Worker's KV namespace directly to verify state transitions and set up test fixtures.
- **DOM and CSS inspection:** parsing served HTML for required elements, attributes, classes; computing inline or external CSS values; asserting on specific selectors.
- **Static analysis:** inspecting source files for required strings, file presence, configuration values.
- **Mocking:** stubbing Anthropic API responses and signed Access JWTs (via a controllable JWKS endpoint) to drive deterministic test scenarios.

## UX principle: self-contained in-app instructions (META)

When the worker renders an HTML page that requires the user to take an action — error pages, recovery flows, setup blockers, "forgot password" screens, expired-window pages, "your config needs attention" notices — that page must contain **the full step-by-step instructions inline as visible HTML content**, with concrete details the user can follow without leaving the page.

**Forbidden patterns:**
- "See `docs/UNINSTALL.md` for details." The user is in front of a broken thing right now; they need the fix on the screen, not in a file they have to find.
- "Click here for instructions." Instructions go directly in the rendered HTML.
- "Refer to the documentation." The documentation is referenced material; the page itself must be self-sufficient.
- A `recovery_url` field in a JSON error response that points anywhere except a same-page anchor.

**Required patterns:**
- Step-by-step instructions rendered as ordered list (`<ol>`) or equivalent in the HTML body of the error/recovery page.
- Each step contains exact UI labels and navigation paths for any third-party UI it references, per the Documentation accuracy requirement below. Example acceptable text: "Open `dash.cloudflare.com`. In the left sidebar click **Workers & Pages**. Click your worker's name. Click the **Storage & Databases** section. Click the **KV** tab. Click into the namespace named **STATE**. Find the key named `setup_window_start`, click the **⋯** menu next to it, then click **Delete**."
- Where instructions are long, the page may use disclosure/expandable elements (`<details>/<summary>`) for visual hierarchy — but the content stays inline within the same HTML response. The expandable is collapsed-by-default UI, not a navigation to another page.

**Roles of in-app pages vs `docs/*.md` files:**

| Surface | Audience | Content style |
|---|---|---|
| In-app HTML page | A user who just hit an error or blocker | Self-contained, immediate, actionable |
| `docs/*.md` files | A developer or operator reading documentation independently | Longer-form, reference, narrative |

Both can describe the same recovery procedure. The in-app page is never a redirect to the docs file. Both contain the steps. The docs file may go deeper (history, why-the-design, alternative paths); the in-app page sticks to the immediate next action.

**Per-page acceptance test:** for any HTML error/recovery page the worker can render, the page must pass this gate: *"If a user opened this page with no other context and no internet access (except for the third-party services explicitly named in the steps), could they follow the instructions on this page alone?"* If the answer requires clicking a link to read more, the page fails this principle and must be revised.

## Documentation accuracy requirement (META)

This is a meta-requirement that applies to every user-facing instruction in this product, including in-app pages, README files, error messages, and tooltips:

**Any instruction that requires the user to interact with a third-party service (Cloudflare dashboard, GitHub, Anthropic Console, etc.) must be derived from the current public documentation of that service and verified to be accurate at the time of implementation. Vacuum-filling (inventing UI labels, dashboard paths, button names, or option values) is forbidden.**

Concretely:
- Instructions must include exact button labels and section names as they appear in the current UI (e.g., not "click somewhere" but "click the **Add application** button in the top right").
- Instructions must include the exact navigation path (e.g., "Dashboard → Workers & Pages → click your worker name → **Settings** tab → scroll to **Delete** at the bottom").
- Instructions must include the canonical URL for any third-party page referenced (e.g., `https://dash.cloudflare.com` not just "the Cloudflare dashboard").
- If a third-party UI has multiple acceptable paths to the same action, document the primary one and note alternates only if doing so reduces confusion.
- When a third-party UI changes (which it does), the documentation must be updated. Implementations must document the date of last verification at the bottom of each instruction-heavy doc.

**Acceptance for any instruction touching a 3rd party:** the implementer must cite the source documentation URL in a code comment or a docs comment near the instruction text. This citation is a deliverable, not optional.

### Third-party API contracts: spec is not authoritative

This document occasionally references concrete details about third-party API behavior — HTTP status codes returned by Anthropic for specific error conditions, exact response body shapes, header names, dashboard navigation paths, signup URLs, button labels. **These details are illustrative starting points based on the spec author's research at writing time. They are not authoritative.**

External services change. The spec author may have made errors. Implementers must:

1. **Verify before implementing.** Before implementing any branch that depends on a specific 3rd-party API contract (status code, error type string, header presence, payload shape), the implementer must verify the current behavior against the latest official documentation OR by direct empirical observation (test request against the real API in a sandbox account).

2. **Treat spec claims as hypotheses.** When the spec says "Anthropic returns HTTP X for condition Y," read it as "the spec author believes Anthropic returns HTTP X for condition Y, but you must confirm." If verification shows different behavior, the implementation follows reality, not the spec, AND the implementer files a correction note in `docs/SPEC_CORRECTIONS.md` so future readers know.

3. **Generalize where possible.** Where the spec specifies a concrete error-handling branch (e.g., "on HTTP 402 do X"), the implementation should be defensive: branch on the actual observable signals (status code AND error type string AND payload structure), not just the status code alone. A 400 with `invalid_request_error` and message containing `credit balance` is structurally different from a 400 with `invalid_request_error` and message containing `messages array`.

4. **Investigation is part of done.** A `done_when` criterion that depends on a 3rd-party API contract is only "done" when both the spec criterion AND empirical verification pass. The implementer adds a note in code or docs citing the verification.

**Concretely required investigation surfaces (this list is not exhaustive):**
- Anthropic API error response shapes for: invalid key (401), insufficient credits (currently 400 with `invalid_request_error` + credit-balance message), rate limited (429), overloaded (529), server error (500), and any others encountered.
- Cloudflare Access JWT structure and JWKS endpoint format (verified against the team domain's `/cdn-cgi/access/certs` response).
- Cloudflare Workers KV consistency guarantees within a single Worker request vs. across requests.
- GitHub OAuth scopes requested by the Cloudflare Deploy button flow.
- Cloudflare Deploy button parsing rules for `wrangler.toml` (which sections trigger user prompts, which don't).
- Anthropic pricing per model (input, cached input, output token rates) used in the cost-tracking implementation.

Failure to investigate before implementing in these areas is a failure of the documentation accuracy requirement, regardless of what the spec text claims.

---

## 1. Glossary additions

New terms introduced in this spec:
- **Admin password** — a password set by the owner during initial setup, used to authenticate admin actions. Replaces the mandatory CF Access gate as the primary admin auth.
- **Theme** — one of two visual modes: `light` or `dark`.
- **Citation badge** — the styled inline indicator that follows a sourced claim from the CV; replaces the raw `[cv]` token from the AI's response.
- **Footer bar** — the persistent bottom region of the chat page containing the chat input and attribution links.

## 2. Business constraint changes

Existing constraints (platform stack, distribution model, BYOK, public routes, cost defaults, language) are unchanged.

**Authentication constraint replaced.** Mandatory Cloudflare Access on owner-only routes is replaced with: setup and admin gated by an owner-chosen password validated server-side with secure hashing; Cloudflare Access JWT verification is an optional progressive enhancement layer auto-detected at setup time. Public routes remain unauthenticated.

**New constraints:**
- **Attribution constraint.** The chat page footer must always display a link to the canonical upstream source repository (AGPL-3.0 Section 7(b) attribution clause) and a link to the project maintainer's social account. Details in F14.
- **Admin login rate limit.** Per-IP, 10 attempts per hour (not user-configurable). Details in F12.

## 3. Modified Journey: Owner from zero to live

Existing Owner setup journey (with Cloudflare Access steps) is replaced with this password-based flow:

1. Owner reads the project README on GitHub and clicks the Deploy to Cloudflare button.
2. Owner completes Cloudflare and GitHub OAuth (signing up if needed).
3. Cloudflare forks the source repo to the owner's GitHub, creates the KV namespace, deploys the Worker, and presents the Worker URL.
4. Owner visits the Worker URL.
5. The Worker, detecting no existing configuration, presents the setup form directly (no Cloudflare Access setup steps). The form includes a visible expiration time (absolute UTC timestamp) after which setup will be locked for security reasons.
6. Owner fills the form: display name, headline, Anthropic API key, CV markdown, **admin password (new)**, **preferred theme (new)**, and optional fields.
7. Owner submits. The Worker validates the Anthropic key with a test API call, stores configuration and secrets in KV including the hashed admin password, and presents a confirmation screen with the public URL and the admin URL.
8. Owner copies the public URL and shares it.

The Visitor chat journey and the Owner-edits-config-later journey are unchanged. A new "Owner removes deployment" flow is documented in `docs/UNINSTALL.md` (per F20), not as a numbered journey here.

---

## 4. System states

The Worker operates as a state machine. The current state is determined by KV contents plus the incoming request's authentication credentials.

### State A: `unconfigured`
**Entered when:** KV has no `config` entry.
**Behavior:**
- `GET /` and `GET /setup` render the setup form, gated by the setup window (see F2).
- `POST /setup` accepts a one-time configuration write, gated by the setup window.
- `POST /chat` returns 503 with a JSON body `{"error": "not configured"}`.
- `/admin` paths return 404.

### State B: `configured`
**Entered when:** KV has a `config` entry.
**Behavior:**
- `GET /` renders the chat page using the configured theme, name, headline, and CV.
- `POST /chat` is operational, subject to rate limits and the daily budget cap.
- `POST /setup` returns 403.
- `/admin` paths are operational, gated by admin password authentication (and optionally by CF Access JWT if configured).

### State C: `setup_window_expired`
**Entered when:** KV has no `config` and the configured setup window has elapsed since the first request.
**Behavior:**
- `GET /` renders the setup-window-expired page with absolute UTC timestamp of expiration and step-by-step recovery instructions.
- `POST /setup` returns 403 with a JSON body referencing the same recovery procedure.

---

## 5. Functional requirements

### F2: Setup window with absolute expiration timestamp

**Changes:**

1. **Window duration:** existing window (longer, e.g. 30 min) → **10 minutes (600 seconds)**. The longer duration was for Cloudflare Access setup time; with password-based setup there are no out-of-app steps, so 10 min is sufficient.
2. **Display absolute UTC timestamp** instead of relative time. Format: `Setup must be completed by HH:MM:SS UTC on YYYY-MM-DD`. Plain text, no countdown timer.
3. **Add explanation text:** "This deadline prevents anyone else from claiming your deployment. If it passes, recovery is manual but takes about a minute."
4. **Inline recovery instructions** on the expired-window page (per UX principle META section). The exact procedure:
   1. Open `dash.cloudflare.com` and log in.
   2. In the left sidebar, click **Workers & Pages**.
   3. Click the name of the deployed worker (e.g., `askmycv` or as named by the owner).
   4. Click the **Storage & Databases** section in the worker's navigation, or open the **Settings** tab to find the KV bindings.
   5. Click into the KV namespace bound as `STATE`.
   6. Find the key named `setup_window_start`, click its `⋯` menu, and choose **Delete**.
   7. Return to the worker URL and refresh. A fresh 10-minute setup window starts.

   The implementer must verify the current Cloudflare dashboard navigation path (per Documentation accuracy requirement) and update the rendered HTML if Cloudflare's UI has changed.

5. **JSON 403 response shape change.** `POST /setup` after window expiry now returns body `{"error": "setup_window_expired", "expired_at": "<ISO 8601 UTC>", "recovery_summary": "<inline text describing what to do>"}`. The `recovery_summary` field is required and contains inline recovery text. No `recovery_url` field pointing to external docs.

**done_when:**

- [ ] `GET /` with empty KV and no `setup_window_start` key returns HTTP 200; KV inspection confirms `setup_window_start` was written with a value within 5 seconds of the request time.
- [ ] `GET /` with `setup_window_start` set to a time less than 600 seconds in the past returns HTML containing the substring matching regex `Setup must be completed by \d{2}:\d{2}:\d{2} UTC on \d{4}-\d{2}-\d{2}` and the literal substring `security` or `claiming`.
- [ ] `GET /` with `setup_window_start` set to a time more than 600 seconds in the past returns HTML containing all of: the literal phrase `setup window` and `expired`; an ordered list (`<ol>`) of at least 5 steps; the literal substring `dash.cloudflare.com`; the literal key name `setup_window_start`; the literal word `Delete` (or `delete`); the literal substring `STATE`.
- [ ] The expired-window HTML response does NOT contain any anchor element (`<a href>`) whose `href` points to `docs/` paths or other in-repo documentation files for the purpose of finding the recovery procedure. The recovery procedure is rendered inline. (Anchors to third-party services like `dash.cloudflare.com` are expected and allowed.)
- [ ] `POST /setup` with valid body but `setup_window_start` older than 600 seconds returns HTTP 403 with JSON body containing `expired_at` (ISO 8601 string) and `recovery_summary` (non-empty string mentioning `setup_window_start` and `KV`). The JSON body does NOT contain a `recovery_url` field pointing to external documentation.

### F3: Setup form

**Changes:**

1. **Add two new required fields:**
   - `admin_password` (string, 12–128 chars)
   - `theme` (string, one of `"light"` or `"dark"`)

2. **Remove (if present):** any setup-form field or flow related to Cloudflare Access configuration (audience, team domain prompts). v2.1 setup does not configure CF Access — that's handled separately if the owner chooses to enable it (per F12).

3. **Password hashing on submit:** the form must hash `admin_password` server-side using bcrypt (cost ≥ 12) or argon2id. Pure-JS implementation required (Workers V8 isolate constraint, see F12). Plaintext is never persisted.

4. **New KV writes on successful submission (in addition to existing `config` and `secrets`):**
   - `admin_password_hash` — the bcrypt/argon2 hash
   - `cookie_signing_secret` — random 32-byte secret for signing session cookies

5. **Optional CF Access JWT capture (progressive enhancement):** if a valid `cf-access-jwt-assertion` header is present on the setup POST, record `access_aud`, `access_email`, `access_team_domain` in the persisted config. Without such header, those fields are empty/null. (This is the auto-detection path described in F12.)

**done_when (additions for the new fields and behavior):**

- [ ] `POST /setup` without the `admin_password` field returns HTTP 400 with an error identifying the missing field.
- [ ] `POST /setup` with `admin_password` shorter than 12 characters returns HTTP 400.
- [ ] `POST /setup` with `admin_password` longer than 128 characters returns HTTP 400.
- [ ] `POST /setup` with `theme` value other than `"light"` or `"dark"` returns HTTP 400.
- [ ] `POST /setup` with a valid body writes `admin_password_hash` and `cookie_signing_secret` to KV; the persisted hash must be a valid bcrypt or argon2id hash (verifiable by re-hashing the original password and comparing).
- [ ] After `POST /setup` returns success, KV must not contain the plaintext password anywhere (verifiable by listing all KV keys and inspecting values for substring match against the submitted password).
- [ ] `POST /setup` with a valid Cloudflare Access JWT present in `cf-access-jwt-assertion` header records `access_aud`, `access_email`, `access_team_domain` in the persisted config. Without such header, those fields must be empty strings or null.

### F4: Visitor chat — system prompt addition

The existing chat endpoint and system prompt are preserved. Add one instruction to the existing system prompt:

The system prompt must instruct the model to format responses as plain text only — no markdown syntax. Explicitly tell the model not to emit `**bold**`, `*italic*`, backticks, headers, or lists. The reason: F6 introduces UI-side citation badge rendering that assumes plain text and visually breaks if the model emits markdown.

**done_when:**
- [ ] The Anthropic API request's `system` field contains both literal substrings (case-insensitive): "plain text", "no markdown".

NOTE: F5 (Theme), F6 (Message formatting), F7-F11 (other UI/UX) layer additional behaviors on top of the existing chat. None of them alter the chat API contract.

### F5: Theme system

**Goal:** The product supports two visual themes — light and dark — selected by the owner and applied consistently across all visitor and admin pages.

**Business rules:**

Themes must be implemented with these exact color tokens. The implementer may use any CSS organization (variables, classes, inline styles) but the rendered computed style on the relevant elements must match these values exactly.

**Dark theme tokens:**
- `--bg`: `#181613`
- `--bg-card`: `#1f1c18`
- `--bg-elevated`: `#28241f`
- `--border`: `#3a342f`
- `--text`: `#f5f0e8`
- `--text-dim`: `#a8a098`
- `--text-mute`: `#6b6359`
- `--accent`: configured `accent_hex` value, default `#b45309`
- `--danger`: `#c14a3c`
- `--success`: `#10b981`

**Light theme tokens:**
- `--bg`: `#fafaf7`
- `--bg-card`: `#ffffff`
- `--bg-elevated`: `#f3f1ec`
- `--border`: `#d6d2c8`
- `--text`: `#1a1814`
- `--text-dim`: `#56524a`
- `--text-mute`: `#8b8579`
- `--accent`: configured `accent_hex` value, default `#b45309`
- `--danger`: `#b8302a`
- `--success`: `#0d8a5f`

Behavior:
- The theme selected at setup is applied to all subsequent visitor and admin renders.
- The admin form includes a theme switcher (radio button or equivalent) that persists changes to config on save.
- The HTML `<html>` element must carry a `data-theme` attribute equal to the active theme (`light` or `dark`).
- The page must declare `color-scheme: light` or `color-scheme: dark` to inform the browser of the active scheme (affects scrollbars, default form widgets).

Typography (applied to both themes identically):
- Headings (h1, h2, h3): serif family, specifically `"Fraunces", Georgia, serif`.
- Body text: sans-serif family, specifically `"Instrument Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`.
- Code, citation badges, technical labels: monospace family, specifically `"JetBrains Mono", "SF Mono", Menlo, monospace`.
- Web fonts must be preloaded from a CDN with `<link rel="preconnect">` and `<link rel="preload">` for the primary font weights used above the fold.

**done_when:**
- [ ] After `POST /setup` with `theme: "dark"`, `GET /` returns HTML with `<html data-theme="dark">` attribute.
- [ ] After `POST /setup` with `theme: "light"`, `GET /` returns HTML with `<html data-theme="light">` attribute.
- [ ] After a successful `POST /admin/save` updating the theme from dark to light, the next `GET /` returns HTML with `<html data-theme="light">`.
- [ ] The served HTML for dark theme contains a CSS rule or inline style declaring `background` (or `background-color`) value of `#181613` applied to the `<body>` or its primary container.
- [ ] The served HTML for light theme contains a CSS rule declaring `background` value of `#fafaf7` applied to the same element.
- [ ] The served HTML contains a `<meta name="color-scheme">` or CSS `color-scheme:` declaration matching the active theme.
- [ ] The served HTML contains link tags loading the three named fonts (Fraunces, Instrument Sans, JetBrains Mono) from a public web font CDN (Google Fonts, Bunny Fonts, or equivalent).
- [ ] An admin form fetched via `GET /admin` (with valid auth) contains a control (`<input type="radio">` or `<select>`) for theme selection with both `light` and `dark` options, with the currently configured theme pre-selected.

### F6: Message formatting and citation rendering

**Goal:** AI responses display as clean prose with styled citation indicators, regardless of any markdown artifacts the model might emit.

**Business rules:**

Streaming token handling:
- As tokens arrive from the AI, accumulate them into a buffer per message.
- After each token, re-render the buffer through the formatting pipeline (described below) and update the DOM.

Formatting pipeline (applied to the accumulated text):
1. **Markdown stripping:**
   - `**text**` → `text` (remove the asterisks, keep the content)
   - `*text*` → `text`
   - `` `text` `` → `text`
   - `# text`, `## text`, `### text` (at start of line) → `text`
   - `- text`, `* text` (at start of line) → `text`
   - `1. text`, `2. text`, etc. (at start of line) → `text`
   - The implementer must use the exact regex patterns documented in the implementation (preserved as code comments) so this is auditable.

2. **Citation replacement:**
   - The literal token `[cv]` is replaced with HTML element `<span class="citation-badge">cv</span>` (or equivalent element with that class).
   - Partial citation tokens at the very end of the buffer (`[`, `[c`, `[cv`) are NOT replaced; they remain as raw characters until the closing bracket arrives. This prevents flickering during streaming.
   - The replacement regex is applied as `/\[cv\]/g` against the buffer (replacing all complete tokens).
   - The partial-match preservation regex applied to the END of the buffer is `/\[(?:c(?:v)?)?$/` — this matches the final substring being exactly one of `[`, `[c`, or `[cv` and NOTHING ELSE. If the final substring matches this regex, hold those characters out of the rendered output until the next token arrives. Note: the regex deliberately does not match `[v` standalone, because the streaming sequence only ever produces `[`, `[c`, `[cv`, `[cv]` in order.

3. **HTML escaping:**
   - All accumulated text (except the citation badges injected in step 2) must be HTML-escaped before insertion into the DOM. No `innerHTML` use that would allow script injection.

Citation badge visual style:
- Background: `var(--accent)` at 15% opacity, or equivalent that's visually distinguishable from regular text.
- Text color: `var(--accent)`.
- Padding: `1px 6px`.
- Border-radius: `4px`.
- Font: monospace (per F5 typography).
- Font-size: 10px or 75% of body text size.
- Text-transform: lowercase.
- Letter-spacing: `0.05em`.
- Display: `inline-flex` aligned with text baseline.
- Margin: `0 2px` left/right to provide breathing room from surrounding text.

**done_when:**
- [ ] Given a mocked Anthropic streaming response that emits `"I led a team [cv] of 12 engineers"`, the rendered DOM (after streaming completes) contains a `<span class="citation-badge">` element with text content `cv`, positioned between text nodes `"I led a team "` and `" of 12 engineers"`.
- [ ] Given a mocked response that emits `"It was **important** to me"`, the rendered DOM contains text content `"It was important to me"` with no `**` characters visible and no `<strong>` element.
- [ ] Given a mocked response with intermediate streaming states `["I led ", "[c", "v", "]"]` arriving as separate SSE events: at each intermediate state the DOM never contains the literal text `[c` or `[cv` as visible content — those characters are either invisible/buffered or already replaced by the citation badge by the time the user could observe them. (This is verifiable by tracking innerHTML transitions; intermediate state may contain a partial buffer but it must not be rendered into a visible position. Implementer chooses mechanism: invisible span, deferred render, or final-position regex preservation.)
- [ ] Given a response containing `<script>alert(1)</script>`, the rendered DOM does not execute the script and contains the literal escaped text as visible content.
- [ ] The CSS rules in the served HTML define the citation badge with the specified background, color, padding, border-radius, font, font-size, text-transform, letter-spacing, display, and margin values (verifiable by parsing the stylesheet or inspecting computed style).

### F7: Streaming animations

**Goal:** New text appears with subtle animation that signals liveness without being distracting.

**Business rules:**

- The chat input typing-indicator (shown after submit, before first token arrives) is three dots animating with staggered opacity. The CSS `@keyframes` animation must:
  - Have duration 1.4 seconds.
  - Loop infinitely.
  - Stagger the three dots by 0.2 seconds.
  - Animate opacity between 0.3 and 1.0.

- New message entrances (both visitor and assistant bubbles) animate in with a fade-up effect:
  - Initial state: `opacity: 0`, `transform: translateY(8px)`.
  - Final state: `opacity: 1`, `transform: translateY(0)`.
  - Duration: 400ms.
  - Easing: `ease-out`.

- Streaming text within an assistant message does NOT animate per-character or per-token. It simply appears as the buffer updates. This is intentional — animating each token creates visual noise.

- Respect `prefers-reduced-motion: reduce`. When this media query matches:
  - The fade-up entrance is skipped (immediate appearance).
  - The typing-indicator dots are static (not animated).

**done_when:**
- [ ] The served CSS contains a `@keyframes` rule named `fadeUp` (or equivalent) with `opacity: 0` and `translateY` at start, `opacity: 1` and `translateY(0)` at end.
- [ ] The served CSS contains a `@keyframes` rule for the typing indicator with `1.4s` duration and `infinite` iteration.
- [ ] The typing indicator HTML structure contains exactly 3 child elements that share the animation, with `animation-delay` values that differ by `0.2s` (verifiable by inspecting computed style or inline `style` attribute).
- [ ] The served CSS contains a `@media (prefers-reduced-motion: reduce)` rule that overrides or disables the fade-up and typing-indicator animations (e.g., sets `animation: none` or `transition: none`).
- [ ] Message bubble elements (user or assistant) have a CSS class that triggers the fade-up animation on entrance.

### F8: Auto-scroll behavior

**Goal:** The conversation area scrolls smoothly to follow new content, while respecting the visitor's intent if they have scrolled up to read prior messages.

**Business rules:**

- When a new message is appended (either user or assistant), the conversation container must scroll to keep the latest content visible.
- Scroll behavior: `behavior: 'smooth'`.
- The scroll must be triggered within 100ms of the new message being mounted in the DOM.
- During assistant streaming, the conversation must scroll incrementally as new tokens arrive — but only when the visitor's scroll position is already at (or within 100px of) the bottom of the container. If the visitor has scrolled up by more than 100px, automatic scrolling is suspended until they scroll back near the bottom or submit a new message.
- When the visitor submits a new message, automatic scrolling resumes regardless of current position.

**done_when:**
- [ ] Inspect the rendered chat page JavaScript: there is a function or block that calls `scrollTo` (or `scrollIntoView`) with `behavior: 'smooth'` when a new message DOM node is appended.
- [ ] Inspect the rendered chat page JavaScript: there is a condition that compares the conversation container's `scrollTop + clientHeight` against `scrollHeight - 100` (or equivalent threshold) before auto-scrolling during streaming.
- [ ] Inspect the rendered chat page JavaScript: submitting a new message via the input bar triggers an unconditional scroll-to-bottom (no near-bottom check).

### F9: Mobile responsive view

**Goal:** The chat is fully usable on mobile devices (phones and small tablets).

**Business rules:**

- The page must include `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- The page must render correctly at viewport widths down to 320px (smallest common mobile viewport).
- At viewport widths ≤ 540px:
  - The two-column form layouts (used in admin/setup) collapse to a single column.
  - The chat input bar's textarea remains at least 44px tall (Apple's minimum tap target).
  - The Send button is at least 44×44 px.
  - Padding around the conversation area reduces to 16px (from larger desktop values).
- The footer attribution bar must remain readable at mobile width: links wrap if necessary, font size minimum 11px.
- When the on-screen keyboard appears on mobile (textarea focused), the sticky input bar must remain anchored at the visible viewport bottom (not hidden behind the keyboard). Implementer should use `visualViewport` API or appropriate CSS (`position: sticky` with `bottom: 0`, combined with `100dvh`-based heights) — choice is open.

**Mobile keyboard behavior — limitation acknowledged:** the on-screen keyboard interaction with the sticky input bar is NOT autonomously verifiable in a headless test environment. Implementer must use a sound implementation strategy (the choices listed above are known-good options) but the `done_when` criteria for F9 only test the underlying CSS / meta tag plumbing, not the runtime visual behavior on a real mobile device. Manual smoke-test on actual mobile browser (iOS Safari, Chrome Android) is recommended before declaring the deployment ready for end users, but is not part of the automated acceptance gate.

**done_when:**
- [ ] The served HTML for `GET /` contains the literal substring `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- [ ] The served CSS contains at least one `@media` rule targeting `max-width: 540px` (or similar mobile breakpoint).
- [ ] The Send button selector in the served HTML/CSS has computed `min-width` and `min-height` of at least 44px (verifiable by extracting the rule).
- [ ] The textarea selector has computed `min-height` of at least 44px.
- [ ] The served CSS or JS includes one of the documented mechanisms for mobile keyboard handling: a `visualViewport` API event listener, a `100dvh` (dynamic viewport height) unit in the layout for the chat container, or a `position: sticky; bottom: 0` declaration on the input bar wrapper. (This verifies the implementation made an attempt; it does not verify the attempt works on a real device.)

### F10: Input UX and keyboard interactions

**Goal:** Typing and sending messages feels natural across keyboards and devices.

**Business rules:**

- The chat input is a `<textarea>` (not `<input>`), allowing multi-line content.
- The textarea grows in height as the user types, up to a maximum of 120px, then scrolls internally.
- Pressing Enter sends the message.
- Pressing Shift+Enter inserts a newline without sending.
- Pressing Escape with focus in the textarea clears the input.
- The textarea has placeholder text `Ask about my experience...` (or equivalent indicating the topic scope).
- The Send button is disabled when the textarea is empty or whitespace-only.
- During send (request in flight), the Send button is disabled and shows a visual indicator (spinner or label change) until the response begins streaming.
- Suggested question chips, when clicked, populate the textarea with the question text AND submit immediately (single-click action, not two-step).

**done_when:**
- [ ] The served HTML contains a `<textarea>` element (not `<input>`) within the input bar.
- [ ] The served HTML JavaScript contains an event handler on `keydown` that checks for `Enter` key without Shift modifier, calls `preventDefault()`, and triggers the send action.
- [ ] The served HTML JavaScript contains a `keydown` handler checking for `Shift+Enter` that does NOT call `preventDefault()` (allowing default newline insertion).
- [ ] The served HTML JavaScript contains an event handler that disables the Send button when the textarea value is empty or matches `/^\s*$/`.
- [ ] Clicking a suggested-question chip (via DOM event dispatch in a test) results in a `POST /chat` request being initiated within 100ms.
- [ ] The textarea has the `placeholder` attribute set to a non-empty string ending in ellipsis or question scope cue.

### F11: Loading states and error handling

**Goal:** The visitor always knows what state the app is in; errors degrade gracefully.

**Business rules:**

For chat submission:
- The instant the visitor presses Enter or clicks Send (before any network response): the Send button visually changes (disabled state, optionally a spinner). This must happen synchronously in the same event tick, not waiting for the request to complete.
- The visitor's message bubble appears in the conversation area immediately.
- The assistant's response area shows a typing indicator (three animated dots) until the first response token arrives.
- When the first token arrives, the typing indicator is replaced with the streaming text.

For error responses from `/chat`:
- HTTP 400 (input validation failure): show a small error message below the input bar with text indicating the input was invalid (e.g., "Message too long" or "Please enter a question"). Do NOT show as a chat bubble.
- HTTP 403 (bot detection): show "This request was blocked. Please ensure you're using a standard web browser."
- HTTP 429 (rate limited): show "Too many messages. Please wait a moment and try again." Read the `Retry-After` response header if present and display the wait time.
- HTTP 503 (budget cap or service unavailable): show "This chat is temporarily unavailable. Please try again later."
- HTTP 500 / 502 / network error: show "Something went wrong. Please try again."

Upstream Anthropic error mapping (worker propagates as 502 with body indicating the upstream issue; UI shows generic "service unavailable" message; the worker MUST verify these mappings against current Anthropic API behavior at implementation time, per the META section's third-party verification requirement):

| Anthropic upstream response | Worker response to visitor | UI message |
|---|---|---|
| 400 with `invalid_request_error` AND message containing `credit balance` (insufficient credits) | 502 with JSON `{error: "upstream_unavailable", reason: "credits"}` | "This chat is temporarily unavailable. The owner has been notified." |
| 400 with other `invalid_request_error` types (genuine malformed request from worker) | 500 with JSON `{error: "internal"}` | "Something went wrong. Please try again." |
| 401 (invalid API key) | 500 with JSON `{error: "config_invalid"}` | "This chat is temporarily unavailable due to a configuration issue." |
| 429 (rate limited at Anthropic) | 429 propagated with `Retry-After` header copied | "Too many messages. Please wait a moment and try again." |
| 500/502/503/529 from Anthropic | 502 with JSON `{error: "upstream_unavailable"}` | "Something went wrong. Please try again." |
| Timeout (Anthropic doesn't respond within configured timeout) | 504 with JSON `{error: "upstream_timeout"}` | "The chat is taking too long to respond. Please try again." |

**Verification requirement (per META section):** the implementer must confirm the actual response shapes from Anthropic (status codes, error type strings, message keywords) by either consulting current docs at `https://docs.anthropic.com/en/api/errors` OR by triggering each error condition in a test sandbox. If observed behavior differs from this table, the implementation follows observed behavior AND a correction note is filed in `docs/SPEC_CORRECTIONS.md`.

For all error responses on chat:
- The visitor's typed message remains in the textarea (not cleared) so they can retry without retyping.
- The error message is visually distinct from regular chat (color: `var(--danger)`, smaller font, not in a chat bubble).
- The error message auto-dismisses after 8 seconds OR remains until the next successful interaction (implementer's choice).

For admin login errors:
- Wrong password: show error message "Incorrect password. Please try again." with anti-bruteforce 500ms delay (per F12).
- After 10 failed attempts: show "Too many login attempts. Please try again in an hour."

**done_when:**
- [ ] Mocking `POST /chat` to return HTTP 429 with header `Retry-After: 60`: the chat UI displays a visible error element with text mentioning "60" or "minute" and `class` containing the literal `error` or `danger`.
- [ ] Mocking `POST /chat` to return HTTP 503: the UI shows an error mentioning "unavailable" or "temporarily".
- [ ] Mocking `POST /chat` to return HTTP 500: the UI shows an error and the visitor's original message text is still present in the textarea (not cleared).
- [ ] On submit, the Send button transitions to disabled state within the same JavaScript event tick (verifiable by inspecting the button's `disabled` attribute synchronously after the click handler fires).
- [ ] The typing-indicator element (3-dot animation) is present in the DOM between submit time and first-token arrival; replaced by the streaming text element thereafter.
- [ ] Mocking `POST /admin/login` to return HTTP 401: the response is delayed at least 400ms from request initiation (anti-bruteforce timing).
- [ ] Mocking the Anthropic upstream to return HTTP 400 with body `{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}`: the worker's response to `POST /chat` is HTTP 502 with JSON body containing `reason: "credits"` or equivalent identifier distinguishing this from a generic upstream failure.
- [ ] Mocking the Anthropic upstream to return HTTP 401: the worker's response to `POST /chat` is HTTP 500 with JSON body indicating a configuration issue.
- [ ] Mocking the Anthropic upstream to return HTTP 429 with `Retry-After: 30`: the worker's response is HTTP 429 with `Retry-After: 30` propagated.
- [ ] Mocking the Anthropic upstream to time out (no response within configured timeout): the worker's response is HTTP 504 within a bounded time.
- [ ] The repo contains `docs/SPEC_CORRECTIONS.md` (may be empty initially) as the documented location for filed corrections.

### F12: Admin authentication (password-based with optional CF Access)

This replaces existing admin authentication entirely.

**Remove:**
- The mandatory Cloudflare Access gate on `/admin` and `/setup` routes. (CF Access JWT verification CODE is preserved; mandatory enforcement is removed.)
- Any admin token mechanism (if the existing code uses a separate admin token).

**Add:**

1. **Password-based primary auth.**
   - Admin password hashed at setup time using bcrypt (cost ≥ 12) or argon2id, pure-JS only (Workers V8 isolate constraint). Acceptable libraries: `bcryptjs`, `@noble/hashes` for argon2id. Native bindings forbidden.
   - Hash stored in KV as `admin_password_hash`.
   - Plaintext never persisted.

2. **Session cookie on successful login.**
   - Name: `askmycv_admin_session`.
   - Value: HMAC-SHA256-signed token containing issuance timestamp + expiration, signed with `cookie_signing_secret` from KV.
   - Attributes: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/admin`.
   - TTL: 7 days.

3. **New endpoint `POST /admin/login`.**
   - Accepts JSON `{password: string}`.
   - Rate limit: 10 attempts per IP per hour (tracked in KV). 11th → HTTP 429.
   - Wrong password: artificial 500ms minimum delay, then HTTP 401.
   - Correct password: HTTP 200 with `Set-Cookie` issuing the session cookie.

4. **Two-layer authorization on `/admin` and `/admin/save` (and other admin routes):**

   Step 1: Check session cookie. If absent or invalid (signature fails, expired) → request is unauthenticated → render login form (`GET`) or return HTTP 401 (`POST`).

   Step 2 (conditional): IF `config.access_email` is non-empty (Cloudflare Access was used at setup time, per F3 progressive enhancement) → also verify `cf-access-jwt-assertion` header strictly against stored identity. If this check fails → HTTP 403. If `config.access_email` is empty → skip JWT check entirely.

   Step 3: Grant access only if all applicable checks passed.

**done_when:**

- [ ] `POST /admin/login` with the correct password returns HTTP 200 and includes a `Set-Cookie` header for `askmycv_admin_session` with attributes `HttpOnly`, `Secure`, `SameSite=Lax`.
- [ ] `POST /admin/login` with an incorrect password takes at least 400ms wall-clock time to respond (anti-bruteforce delay) and returns HTTP 401.
- [ ] After 10 failed `POST /admin/login` attempts from the same simulated IP within an hour, the 11th attempt returns HTTP 429.
- [ ] `GET /admin` without a session cookie returns HTML containing a password input field with type `password` and a submit button.
- [ ] `GET /admin` with a valid session cookie returns HTML containing the admin form pre-filled with current config values.
- [ ] `POST /admin/save` without a valid session cookie returns HTTP 401.
- [ ] With `config.access_email` set to a non-empty value, `GET /admin` with a valid session cookie but no `cf-access-jwt-assertion` header returns HTTP 403.
- [ ] With `config.access_email` empty, `GET /admin` with only a valid session cookie (no JWT header) returns HTTP 200 with the admin form.
- [ ] After `POST /admin/save` updating any field, the next `GET /` reflects the updated config (verifiable for the theme field by checking the `data-theme` attribute on the served HTML).

### F13: Admin panel additions

Add to the existing admin panel:

1. **Theme switcher** (radio or `<select>`) for `light`/`dark` selection.
2. **"Sign out" button** that clears the session cookie (sets `Set-Cookie` with past expiration).
3. **Password change fields:**
   - "Current password" input (required when changing password).
   - "New admin password" input (optional; when non-empty AND ≥ 12 chars, worker validates current password and replaces the hash in KV).
4. **"Reset to factory" endpoint and UI** (new `POST /admin/reset`):
   - Request body: `{"current_password": string, "confirm": "DELETE ALL CONFIG"}`. The `confirm` field must be exactly the literal string (case-sensitive) for the request to proceed.
   - Authentication: requires valid admin session cookie (per F12). If `config.access_email` is non-empty, also requires matching CF Access JWT.
   - On all checks passing: deletes `config`, `secrets`, `admin_password_hash`, `cookie_signing_secret` from KV; clears session cookie (`Max-Age=0`).
   - Response 200: `{"ok": true, "redirect": "/"}`. UI redirects to `/` which shows setup form.
   - Response 401 on missing/wrong password: `{"error": "invalid_password"}`.
   - Response 400 on missing/wrong confirm: `{"error": "confirmation_required", "expected": "DELETE ALL CONFIG"}`.
   - UI presentation: button labeled "Reset all configuration" inside a section labeled "Danger zone". Click opens inline form with two inputs (current password + literal-text confirmation). Submit button stays disabled until the user types `DELETE ALL CONFIG` exactly.

**Modify:**

The form auth gate uses the F12 session-cookie + optional-JWT scheme. The form fields and KV persistence flow are otherwise unchanged.

**done_when (for the new behaviors):**

- [ ] `GET /admin` (authenticated) returns HTML containing a theme switcher control with both `light` and `dark` options, with the currently configured theme pre-selected.
- [ ] `GET /admin` (authenticated) returns HTML containing a "Sign out" button or link.
- [ ] `POST /admin/save` with valid `new_admin_password` ≥ 12 chars and correct `current_admin_password` updates `admin_password_hash` in KV.
- [ ] `POST /admin/save` with `new_admin_password` but missing or wrong `current_admin_password` returns HTTP 400 with error.
- [ ] `POST /admin/save` with `new_admin_password` shorter than 12 characters returns HTTP 400.
- [ ] `POST /admin/reset` with valid auth, correct `current_password`, and `confirm: "DELETE ALL CONFIG"` deletes `config`, `secrets`, `admin_password_hash`, and `cookie_signing_secret` from KV; returns HTTP 200 with `Set-Cookie` clearing the session cookie.
- [ ] `POST /admin/reset` with `confirm` value other than the exact literal `"DELETE ALL CONFIG"` returns HTTP 400 and does NOT modify KV.
- [ ] `POST /admin/reset` with wrong `current_password` returns HTTP 401 and does NOT modify KV.
- [ ] `POST /admin/reset` without valid session cookie returns HTTP 401 (per F12) and does NOT modify KV.
- [ ] After a successful `POST /admin/reset`, `GET /` returns the setup form (state has reverted to `unconfigured`).

### F14: Footer bar with attribution

**Goal:** The chat page displays persistent attribution to the canonical project, the maintainer, and (optionally) the deploying owner.

**Business rules:**

The footer is a region at the bottom of the chat page, sticky-positioned with the input bar. It contains three elements visible at all times:

1. **Source attribution** (left or first):
   - Display text: `Powered by askmycv`
   - The text "askmycv" is a link to the canonical source repository at the URL `https://github.com/m-naw/theclientzero-askmycv`.
   - Note: the repository name is `theclientzero-askmycv` (reflecting the project's TheClientZero methodology). The display text remains `askmycv` as the user-facing product brand.
   - This link is enforced as required by AGPL-3.0 Section 7(b) attribution clause.

2. **Maintainer social** (center or second):
   - Display text: `Built by @TheClientZero` (or equivalent attribution phrasing)
   - The handle is a link to `https://x.com/TheClientZero`.

**Project-specific constants:** the implementer must hardcode the following three constants in the worker source as separate values:

```
MAINTAINER_GH_USERNAME = "m-naw"
MAINTAINER_REPO_NAME   = "theclientzero-askmycv"
MAINTAINER_X_HANDLE    = "TheClientZero"
```

All three values are confirmed by the project owner. The canonical repository URL is constructed as `https://github.com/${MAINTAINER_GH_USERNAME}/${MAINTAINER_REPO_NAME}` and resolves to `https://github.com/m-naw/theclientzero-askmycv`.

3. **Deployer attribution** (right or third, optional):
   - Visible only if `config.linkedin_url`, `config.github_url`, or `config.x_url` is set.
   - Text: `Deployed by <display_name>`
   - The display name is a link to the first available of: `config.linkedin_url`, `config.github_url`, `config.x_url`.
   - If none are set, this element is hidden entirely.

Visual style:
- Font: `var(--font-mono)` (JetBrains Mono).
- Font-size: 11px.
- Color: `var(--text-mute)`.
- Padding: 12px above the input bar's bottom edge.
- Links: underlined, color inherits from parent.
- The three elements are arranged horizontally with separators (`·`) on desktop. On mobile (≤ 540px), they may stack vertically if necessary to remain readable.

The footer is positioned within the same sticky container as the input bar — both move together and remain visible at the viewport bottom at all times during chat use.

**done_when:**
- [ ] The worker source contains three distinct hardcoded constants (or equivalent), named `MAINTAINER_GH_USERNAME` (value: `m-naw`), `MAINTAINER_REPO_NAME` (value: `theclientzero-askmycv`), and `MAINTAINER_X_HANDLE` (value: `TheClientZero`).
- [ ] The served HTML for `GET /` contains an anchor element with `href="https://github.com/m-naw/theclientzero-askmycv"` and visible text containing the literal string `askmycv`.
- [ ] The served HTML contains an anchor with `href="https://x.com/TheClientZero"` and visible text containing `TheClientZero`.
- [ ] When `config.linkedin_url` is set, the served HTML contains an anchor whose `href` matches the linkedin URL and visible text includes the owner's `display_name`.
- [ ] When none of `linkedin_url`, `github_url`, `x_url` are set in config, no "Deployed by" element is rendered (verifiable by absence of that text in the HTML).
- [ ] The footer element and the input bar are within the same parent container with CSS `position: sticky` (or `fixed`) and `bottom: 0`, such that both remain in view as the page scrolls.
- [ ] The footer's computed font is the monospace family declared in F5.
- [ ] An AGPL-3.0 Section 7(b) clause exists in the LICENSE file or in an `ADDITIONAL_TERMS.md` referenced from the LICENSE, requiring downstream forks to preserve the source-repo link.

### F15: SEO and social sharing meta tags

**Goal:** When a visitor pastes the worker URL into LinkedIn, Twitter, Slack, etc., the unfurled preview displays the owner's name, headline, and a clear call-to-action.

**Business rules:**

The served HTML for `GET /` (when configured) must include the following meta tags:

```
<title><display_name> — Ask my CV</title>
<meta name="description" content="<headline>. Ask anything about my career.">

<meta property="og:title" content="<display_name> — Ask my CV">
<meta property="og:description" content="<headline>. Ask anything about my career.">
<meta property="og:type" content="website">
<meta property="og:url" content="<worker_url>">

<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="<display_name> — Ask my CV">
<meta name="twitter:description" content="<headline>. Ask anything about my career.">
```

`<display_name>` and `<headline>` must be HTML-escaped to prevent XSS via meta tags.

`<worker_url>` is the absolute URL of the worker (determined from the request URL).

OG image (`og:image`):
- v2 does NOT require dynamic image generation.
- A static fallback OG image may be provided by the implementer or omitted.
- If omitted, the LinkedIn/Twitter preview will use the platform default (acceptable for v2).

**done_when:**
- [ ] `GET /` (configured) returns HTML containing a `<title>` element whose text content includes the configured `display_name`.
- [ ] The HTML contains a `<meta property="og:title">` whose `content` attribute includes the `display_name`.
- [ ] The HTML contains a `<meta property="og:description">` whose `content` attribute includes the `headline`.
- [ ] The HTML contains a `<meta name="twitter:card" content="summary">` element.
- [ ] All meta tag content attributes are HTML-escaped (verifiable by setting `display_name` to a value containing `<`, `>`, `"`, `&` characters and confirming they appear as `&lt;`, `&gt;`, `&quot;`, `&amp;` in the meta tag content).

### F16: Accessibility baseline (WCAG 2.1 AA-aligned)

**Goal:** The product is usable by people relying on keyboards, screen readers, or alternative inputs.

**Business rules:**

Keyboard:
- All interactive elements (links, buttons, form controls, suggested question chips) must be reachable via Tab key navigation.
- Tab order must follow visual flow (top-to-bottom, left-to-right).
- Focused elements must have a visible focus indicator. Outline must be at least 2px wide and use `var(--accent)` or `var(--text)` color.

Semantic HTML:
- Headings use `<h1>`, `<h2>`, etc., not styled divs.
- Form fields have associated `<label>` elements (either wrapping or via `for=` attribute).
- The chat message list is contained in an element with `role="log"` and `aria-live="polite"` so screen readers announce new messages.
- The typing indicator has `aria-label="Assistant is typing"`.
- The Send button has `aria-label="Send message"` if its visible content is only an icon.

Color contrast:
- Body text against background must meet WCAG AA contrast ratio (4.5:1 for normal text, 3:1 for large text).
- The default token combinations in F5 must satisfy this. Implementers must verify.

Reduced motion:
- Per F7, animations respect `prefers-reduced-motion`.

**done_when:**
- [ ] The chat page contains an `<h1>` element (not a div styled as a heading).
- [ ] Form `<input>`, `<textarea>`, and `<select>` elements on the setup and admin pages have associated `<label>` elements (verifiable by parsing the HTML and matching `for` attributes or `<label>` ancestors).
- [ ] The chat message container element has both `role="log"` and `aria-live="polite"` attributes.
- [ ] The typing indicator element has an `aria-label` attribute.
- [ ] The served CSS contains a `:focus-visible` (or `:focus`) rule applying `outline` with width ≥ 2px to interactive elements.
- [ ] Programmatic contrast check: extract the configured foreground and background hex values for body text in both themes; compute the WCAG contrast ratio; assert ≥ 4.5.

### F17: Cost ceiling — preserved

No changes. Existing implementation is the spec.

### F18: Anti-abuse — preserved

No changes. Existing implementation is the spec.

### F19: Error pages and recovery

**Goal:** Every error state the Worker can produce has a documented in-app recovery path.

**Business rules:**

The setup-window-expired page (per F2) must:
- Display the absolute UTC timestamp at which the window expired.
- Provide step-by-step recovery instructions inline as visible HTML content (per the UX principle in META), including the literal KV key name `setup_window_start` and the exact Cloudflare dashboard navigation path. The full content of the recovery procedure is specified in F2; this requirement is that F19 inherits that inline content.
- Must NOT contain a link to an external documentation file or repo MD file for the recovery procedure. The page is self-contained.

The admin-not-authenticated page (when no valid session cookie and no valid CF Access JWT where required) must:
- Display a password input form for login.
- Show no information about the worker's configuration (no `display_name`, no `headline`).
- Include a "Forgot password?" affordance — implemented as an inline `<details>/<summary>` element (or equivalent expandable UI) directly on the login page. When expanded, it reveals step-by-step inline instructions for resetting the admin password. The expandable does NOT navigate away from the login page; the content stays in the same HTML response.

The "Forgot password?" inline instructions content (rendered as an ordered list inside the expandable):
  1. Open `dash.cloudflare.com` and log in.
  2. In the left sidebar, click **Workers & Pages**.
  3. Click the name of this worker.
  4. Click the **Storage & Databases** section, then click the **KV** tab.
  5. Click into the namespace bound as `STATE`.
  6. Find the key named `admin_password_hash`. Click its `⋯` menu and choose **Delete**.
  7. Also delete the key named `cookie_signing_secret` if present.
  8. Return to `<worker_url>/admin` and you will be prompted to set a new admin password using your current Cloudflare Access identity (if Access is configured) or via the standard setup flow if not.

The implementer must verify the current Cloudflare dashboard navigation path (per the Documentation accuracy requirement) and update the rendered HTML if Cloudflare's UI has changed since the spec was written.

The chat-unavailable page (state `unconfigured` or `setup_window_expired`) must:
- Not expose any information about the owner.
- Display a simple message: "This site is not yet configured" or "Setup expired."
- For the unconfigured-but-within-window case, show the setup form directly (per F2).
- For the expired-window case, show the inline recovery instructions per F2 — not a link to docs.

All error responses must include the appropriate HTTP status code:
- 400 for client validation errors
- 401 for missing/invalid authentication
- 403 for forbidden (wrong identity, setup already done, bot detection, IP rate limited)
- 404 for resources that don't exist
- 429 for rate-limited (include `Retry-After` header)
- 500 for unexpected worker errors
- 502 for upstream Anthropic failures (worker successfully called but Anthropic returned 4xx/5xx)
- 503 for service unavailable (budget cap, unconfigured chat endpoint)

**done_when:**
- [ ] The expired-window page HTML contains a timestamp in ISO 8601 format with timezone `Z` or `UTC`.
- [ ] The expired-window page HTML contains an ordered list (`<ol>`) of at least 5 steps with the literal substrings `dash.cloudflare.com`, `setup_window_start`, `Delete`, `STATE` — verifying the inline recovery instructions are present.
- [ ] The expired-window page HTML does NOT contain any anchor element whose `href` points to `docs/` paths or in-repo MD files for the purpose of recovery (anchors to third-party services like `dash.cloudflare.com` are allowed).
- [ ] The admin-not-authenticated page HTML contains a `<details>` or equivalent expandable element with `summary` text matching `Forgot password` (case-insensitive).
- [ ] When that expandable is rendered (or its content inspected directly in the HTML), it contains an ordered list of at least 5 steps with the literal substrings `dash.cloudflare.com`, `admin_password_hash`, `Delete`, `STATE`.
- [ ] The admin-not-authenticated page HTML does NOT contain any anchor element whose `href` points to `docs/` paths or in-repo MD files for the purpose of password recovery.
- [ ] The admin-not-authenticated page HTML does not contain the value of `display_name` from config (verifiable by setting config with a unique sentinel display name and confirming it's absent from the response body).
- [ ] Each documented error condition returns the specified HTTP status code (verifiable by triggering each condition via mocked dependencies or pre-seeded KV state).
- [ ] HTTP 429 responses on `/chat` and `/admin/login` include a `Retry-After` header with a numeric value.

### F20: Documentation structure

**Goal:** Documentation is organized for discoverability — main README orients users, dedicated files provide depth on specific concerns.

**Business rules:**

The repo must contain the following Markdown files, each linked from the main README:

1. **`README.md`** (root): the entry point. Contains:
   - Hero section with one-sentence value prop.
   - Cloudflare Deploy button.
   - "Before you start" preflight checklist (per F21).
   - Quickstart section linking to detailed docs.
   - Cost overview.
   - Security model summary linking to `docs/SECURITY.md`.
   - Links to all docs listed below.
   - License section.

2. **`docs/UNINSTALL.md`**: how to remove a deployment. Must include:
   - Three scenarios: pause, reset, permanent delete (per the conversation context).
   - Step-by-step instructions for each, including exact Cloudflare dashboard navigation, GitHub repository deletion, Anthropic key revocation, and Cloudflare Access app cleanup (if applicable).
   - Each instruction must follow the documentation accuracy requirement (META section at top of this spec).

3. **`docs/SECURITY.md`**: the security model. Must include:
   - Summary of password-based auth.
   - Documentation of optional Cloudflare Access fallback (how to configure, why a user might want it).
   - Threat model: what attacks are mitigated, what is out of scope.
   - Recovery procedures for: lost admin password, expired setup window.

4. **`docs/ACCESS_FALLBACK.md`**: how to add Cloudflare Access as an extra layer. Must include:
   - When this is useful (audience: corporate users, sensitive industries, users already using CF Access).
   - Step-by-step Cloudflare Access setup instructions, current as of implementation date, with source URL citations (per META section).
   - Verification: how to confirm the worker is enforcing JWT verification.

5. **`docs/TROUBLESHOOTING.md`**: common problems. Must include:
   - "I can't deploy" → check accounts exist, repo is public, etc.
   - "Cloudflare prompts for variables" → wrangler.toml `[vars]` issue.
   - "My Anthropic key was rejected" → verify on console.anthropic.com.
   - "Daily budget is too low / too high" → adjust in admin.
   - "Chat returns 503 errors" → budget cap reached, wait until UTC midnight.

6. **`docs/PREFLIGHT.md`**: pre-deployment checklist. Linked from the README "Before you start" section. Contains links and instructions for creating GitHub, Cloudflare, and Anthropic accounts.

7. **`docs/SPEC_CORRECTIONS.md`**: a log of places where this spec's claims about third-party behavior turned out to be incorrect when verified empirically. Initialized as an empty template with the structure:
   ```
   # Spec corrections
   
   When the spec's claims about third-party API behavior (status codes, error
   shapes, dashboard navigation) differ from what implementers observed in
   reality, record the correction here.
   
   ## Template
   
   ### YYYY-MM-DD — <surface>
   - Spec claimed: <quote from spec>
   - Reality: <what was observed>
   - Source: <URL or test that confirms>
   - Implementation: <how the code handles the real behavior>
   ```
   This file exists from day one even if empty; its presence reminds future readers that the spec is not authoritative on 3rd-party contracts.

**done_when:**
- [ ] The repo contains files at the exact paths: `README.md`, `docs/UNINSTALL.md`, `docs/SECURITY.md`, `docs/ACCESS_FALLBACK.md`, `docs/TROUBLESHOOTING.md`, `docs/PREFLIGHT.md`, `docs/SPEC_CORRECTIONS.md`.
- [ ] `README.md` contains markdown links to each of the docs files above.
- [ ] Each docs file contains at least 200 words of content (except `SPEC_CORRECTIONS.md`, which may be a template stub).
- [ ] Each docs file referencing a third-party UI navigation step contains a citation comment (HTML comment or markdown footnote) with the URL of the source documentation it was derived from, and a "Last verified: YYYY-MM-DD" date stamp at the bottom of the file.

### F21: Preflight checklist in README

**Goal:** First-time users understand the three accounts they need before clicking Deploy.

**Business rules:**

The README's "Before you start" section must:
- Be the first substantive section after the hero (before the Deploy button or alongside it).
- List the three required accounts (GitHub, Cloudflare, Anthropic) in a table format.
- For each account: provide the canonical signup URL, an estimated time, and what it's used for in plain English.
- Provide direct links to each signup page (not just landing pages).

URLs to use (verified at the time of writing — implementer should re-verify per META requirement):
- GitHub signup: `https://github.com/signup`
- Cloudflare signup: `https://dash.cloudflare.com/sign-up`
- Anthropic console signup: `https://console.anthropic.com/`

**done_when:**
- [ ] `README.md` contains a section heading containing "Before you start" or equivalent phrasing.
- [ ] That section contains direct hyperlinks to all three signup URLs (or current verified equivalents).

---

## 6. Non-functional requirements

### Streaming responses
- [ ] `POST /chat` responses have `content-type: text/event-stream`.
- [ ] The response body emits SSE events incrementally (verifiable by reading the stream and asserting at least one event is parseable before the mock Anthropic response has finished).

### Anthropic failure handling
- [ ] Mocked Anthropic HTTP 500 → `POST /chat` returns HTTP 502 to the visitor; the worker remains operational for subsequent requests.
- [ ] Mocked Anthropic HTTP 400 with body `{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}` (insufficient credits) → `POST /chat` returns HTTP 502 with JSON error body distinguishing this as a credit/billing issue per F11 mapping, and the chat UI displays the appropriate error message per F11.
- [ ] Mocked Anthropic timeout → `POST /chat` returns a non-2xx response within a bounded time (no hung connections).
- [ ] Mocked KV `put` failures during spend tracking do not break the chat response stream.

### Secrets handling
- [ ] The Anthropic API key never appears in any HTML response served by the worker.
- [ ] The admin password (plaintext) never appears in any persisted KV value.
- [ ] Neither secret appears in the worker's `console.log` / observability output.

### Input bounds
- [ ] `POST /setup` with `cv_markdown` over 50,000 chars returns HTTP 400.
- [ ] `POST /chat` with `messages` array whose total serialized size exceeds 100 KB returns HTTP 400 or 413.

### Informational targets (NOT done_when)

The following are documented intent but not required for acceptance:

- Median cost per visitor conversation at default settings ≈ $0.02 (Haiku + prompt caching).
- Chat page should feel responsive across modern desktop and mobile web browsers.

---

## 7. Documentation accuracy verification

Every user-facing instruction referencing a third-party service must:

- [ ] Cite its source URL in a code comment, markdown comment, or footnote near the instruction. Format: `<!-- Source: https://... (verified YYYY-MM-DD) -->`.
- [ ] Reference exact UI labels and navigation paths as they appear in the current public documentation of that service.
- [ ] Be re-verifiable by a human reader following the same documentation URLs.

The implementer must also include a top-level `docs/SOURCES.md` file listing every third-party documentation URL referenced across all docs, with the date of last verification. This is the master citation index.

**done_when:**
- [ ] `docs/SOURCES.md` exists and lists at least 5 distinct external documentation URLs (covering Cloudflare Workers, Cloudflare KV, Cloudflare Access, GitHub, Anthropic, at minimum).
- [ ] Every step-by-step instruction in `docs/UNINSTALL.md`, `docs/ACCESS_FALLBACK.md`, and `docs/PREFLIGHT.md` is traceable to at least one URL in `docs/SOURCES.md`.
- [ ] No instruction contains placeholder phrases like "go to the dashboard" or "find the setting" without specifying the exact navigation path.

---

## 8. Implementation freedom

**Open for implementer choice:**

- Programming language (any Cloudflare Workers supports).
- HTML rendering approach (templates, JSX, raw template strings).
- Choice of JWT and password-hashing libraries (must be reputable, e.g., `jose` for JWT, `bcrypt` or `argon2` for passwords).
- CSS organization (variables, classes, framework-free, etc.), as long as the rendered output matches the F5 color tokens and F6/F7 animation specs exactly.
- HTML element structure (specific tags), as long as required ARIA, classes, and behavior contracts are met.
- Internal code structure and module organization.
- Wording of error messages beyond keywords required by `done_when` criteria.
- Wording of the AI system prompt beyond the behavioral keywords required by F4.

**Locked by business constraint (the implementer must NOT):**

- Replace Cloudflare Workers, KV, or Anthropic Claude.
- Add a paid tier or central service.
- Skip password hashing or use weak hashing (plain SHA-256, MD5).
- Skip the daily budget cap.
- Skip the rate limit.
- Make `/` or `/chat` require login.
- Hardcode CF Access JWT verification as mandatory (it must be optional, auto-detected).
- Introduce production-visible variables in `wrangler.toml [vars]` for test mocking.
- Skip any of the explicit color tokens, font families, or animation timings in F5/F6/F7.

---

## 9. End-to-end acceptance test scenarios

All scenarios are auto-runnable with a local Worker instance and mocked dependencies (Anthropic API, optional JWKS endpoint).

### Test 1: Cold start with setup window display

**Fixtures:** Empty KV.

**Steps:**
1. `GET /` — expect HTTP 200; HTML contains setup form with absolute UTC expiration timestamp matching `\d{2}:\d{2}:\d{2} UTC on \d{4}-\d{2}-\d{2}`.
2. Inspect KV: `setup_window_start` was created.
3. Manipulate KV to set `setup_window_start` 601 seconds in the past.
4. `GET /` — expect HTML containing wording about expired window and the literal string `setup_window_start`.
5. `POST /setup` with valid body — expect HTTP 403.

### Test 2: Setup with password (no CF Access)

**Fixtures:** Empty KV. Anthropic mock returns 200 on test call.

**Steps:**
1. `POST /setup` with valid body including `admin_password: "secretpassword123"` and `theme: "dark"`.
2. Expect HTTP 200 with response body containing `public_url` and `admin_url`.
3. Inspect KV: `config`, `secrets`, `admin_password_hash`, `cookie_signing_secret` all present. `admin_password_hash` is a valid bcrypt or argon2 hash. `config.access_email` is null/empty. `config.theme` equals `"dark"`.
4. Confirm KV does not contain the plaintext password anywhere.

### Test 3: Setup with password AND CF Access JWT (defense in depth)

**Fixtures:** Empty KV. Mock JWKS issues valid JWTs.

**Steps:**
1. `POST /setup` with a valid Access JWT in header and valid body.
2. Inspect KV `config`: `access_email`, `access_aud`, `access_team_domain` are populated from the JWT.
3. Subsequent `GET /admin` with a valid session cookie but no JWT → HTTP 403 (JWT now required).

### Test 4: Admin login flow

**Fixtures:** Configured worker with password hash for `"secretpassword123"`.

**Steps:**
1. `GET /admin` with no cookie → HTML containing password input form. No `display_name` from config is exposed.
2. `POST /admin/login` with `{password: "wrong"}` — response delayed ≥ 400ms, returns HTTP 401.
3. `POST /admin/login` with `{password: "secretpassword123"}` — HTTP 200 with `Set-Cookie: askmycv_admin_session=...` having `HttpOnly`, `Secure`, `SameSite=Lax`.
4. `GET /admin` with that cookie — HTTP 200, admin form pre-filled.

### Test 5: Admin login rate limit

**Fixtures:** Configured worker.

**Steps:**
1. Send 10 `POST /admin/login` with wrong password from same simulated IP. All return 401.
2. 11th attempt → HTTP 429.

### Test 6: Public chat flow with mocked Anthropic

**Fixtures:** Configured worker, theme `"dark"`. Anthropic mock returns streaming response: `"I led teams [cv] at multiple companies."`

**Steps:**
1. `GET /` — HTML contains `<html data-theme="dark">`, owner's `display_name` in `<h1>`, ≥ 4 suggested-question elements.
2. `POST /chat` with browser UA and valid body → SSE response.
3. Render the SSE events through a DOM emulator (or assert on the JavaScript that would render them); confirm final DOM contains `<span class="citation-badge">cv</span>` between `"I led teams "` and `" at multiple companies."`.
4. Inspect Anthropic mock's captured request: `system` field contains `cv_markdown` and the required behavioral keywords from F4.

### Test 7: Markdown stripping

**Fixtures:** Configured. Anthropic mock returns `"It was **important** to deliver on time."`

**Steps:**
1. `POST /chat`, capture SSE.
2. Process events through the rendering pipeline.
3. Final DOM text content: `"It was important to deliver on time."` — no `**` characters present.

### Test 8: Theme switching via admin

**Fixtures:** Configured with `theme: "dark"`. Valid session cookie.

**Steps:**
1. `GET /` → `<html data-theme="dark">`.
2. `POST /admin/save` with `theme: "light"` and valid auth.
3. `GET /` → `<html data-theme="light">`.

### Test 9: Setup window expiration recovery (inline instructions)

**Fixtures:** Empty KV. `setup_window_start` set 601 seconds ago.

**Steps:**
1. `GET /` → expired page. Assert the HTML body contains:
   - The literal phrase `setup window` and `expired`.
   - An ordered list (`<ol>`) of at least 5 steps.
   - The literal substring `dash.cloudflare.com`.
   - The literal substring `setup_window_start`.
   - The literal substring `STATE`.
   - The literal word `Delete` (case-insensitive match acceptable).
2. Assert the HTML body does NOT contain any `<a href="docs/...">` or `<a href="./docs/...">` anchor element. (Anchors to `dash.cloudflare.com` are expected.)
3. `POST /setup` (with the expired window state) → HTTP 403 with JSON body containing `recovery_summary` (non-empty string mentioning `setup_window_start`) and NOT containing a `recovery_url` field.
4. Delete `setup_window_start` from KV.
5. `GET /` → fresh setup form with new `setup_window_start` and new expiration timestamp visible in the HTML.

### Test 10: Daily budget cap — preserved

Existing test from current implementation is sufficient. No changes.

### Test 11: Anthropic insufficient-credits handling

**Fixtures:** Configured. Anthropic mock returns HTTP 400 with body `{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}`.

**Steps:**
1. `POST /chat` → HTTP 502 with JSON error body containing a distinguishing field (e.g., `reason: "credits"` per F11 mapping table) that identifies this as a credit/billing issue, not a generic upstream failure.
2. Subsequent `POST /chat` (with mock reset to streaming 200 success) → HTTP 200, worker still operational.

The implementer must verify that real Anthropic API responses for this condition still match this shape at implementation time. If they don't, update both the worker handling AND record the discrepancy in `docs/SPEC_CORRECTIONS.md`.

### Test 12: Footer attribution

**Fixtures:** Configured with `linkedin_url: "https://linkedin.com/in/owner"`, `display_name: "Owner Name"`.

**Steps:**
1. `GET /`.
2. HTML contains anchor to `https://github.com/m-naw/theclientzero-askmycv` with text containing `askmycv`.
3. HTML contains anchor to `https://x.com/TheClientZero` with text containing `TheClientZero`.
4. HTML contains anchor to `https://linkedin.com/in/owner` with text containing `Owner Name`.

### Test 13: Footer attribution without owner socials

**Fixtures:** Configured with all of `linkedin_url`, `github_url`, `pdf_cv_url` empty.

**Steps:**
1. `GET /`.
2. HTML still contains the two project-maintainer attributions.
3. No "Deployed by" element is present in the HTML.

### Test 14: SEO meta tags

**Fixtures:** Configured with `display_name: "Test \"User\""`, `headline: "Engineering & ops"`.

**Steps:**
1. `GET /` returns HTML.
2. `<title>` contains `Test "User"` correctly escaped as `Test &quot;User&quot;`.
3. `<meta property="og:title">` content attribute includes the escaped display name.
4. `<meta property="og:description">` content includes the headline with `&amp;` escaping.

### Test 15: Mobile viewport

**Fixtures:** Configured.

**Steps:**
1. `GET /`.
2. HTML contains `<meta name="viewport" content="width=device-width, initial-scale=1">`.
3. CSS contains a media query for `max-width: 540px`.

### Test 16: Accessibility — ARIA on chat container

**Fixtures:** Configured.

**Steps:**
1. `GET /`.
2. Chat message container has `role="log"` and `aria-live="polite"`.
3. Typing indicator template/element has an `aria-label`.

### Test 17: Documentation files presence

**Fixtures:** Repo on filesystem.

**Steps:**
1. Assert presence of `README.md`, `docs/UNINSTALL.md`, `docs/SECURITY.md`, `docs/ACCESS_FALLBACK.md`, `docs/TROUBLESHOOTING.md`, `docs/PREFLIGHT.md`, `docs/SOURCES.md`, `docs/SPEC_CORRECTIONS.md`.
2. Each substantive docs file ≥ 200 words. (`SPEC_CORRECTIONS.md` may be a stub.)
3. `README.md` contains markdown links to each docs file.
4. `README.md` "Before you start" section contains direct links to GitHub, Cloudflare, and Anthropic signup URLs.
5. `docs/SOURCES.md` contains at least 5 distinct https URLs from third-party documentation domains.

### Test 18: WCAG contrast

**Fixtures:** None.

**Steps:**
1. Extract the body-text and background colors for dark theme: `#f5f0e8` on `#181613`. Compute WCAG contrast ratio. Assert ≥ 4.5.
2. Extract for light theme: `#1a1814` on `#fafaf7`. Assert ≥ 4.5.

### Test 19: Reset to factory

**Fixtures:** Configured.

**Steps:**
1. `POST /admin/reset` with auth and confirmation parameters.
2. Inspect KV: `config`, `secrets`, `admin_password_hash`, `cookie_signing_secret` all absent.
3. `GET /` → setup form (state has reverted to `unconfigured`).

### Test 20: Admin "Forgot password" inline instructions

**Fixtures:** Configured. No admin session cookie present in request.

**Steps:**
1. `GET /admin` → HTTP 200 with HTML containing the password login form.
2. Assert the HTML body contains a `<details>` (or equivalent expandable element) with `<summary>` text containing the phrase `Forgot password` (case-insensitive).
3. Assert the content inside that expandable contains an ordered list (`<ol>`) of at least 5 steps.
4. Assert the expandable content contains all literal substrings: `dash.cloudflare.com`, `admin_password_hash`, `STATE`, `Delete` (case variations acceptable).
5. Assert the HTML body does NOT contain any anchor element whose `href` matches `docs/` or `./docs/` path patterns for the purpose of password recovery. (Links to `dash.cloudflare.com` and similar third-party services are expected.)

---

## 10. Migration acceptance checklist

This migration is complete when the new and modified requirements below pass, AND existing functionality not mentioned in this spec continues to work.

### Regression (implicit)

- [ ] After applying the migration, all existing functionality not mentioned in this spec continues to pass its existing tests. The implementer does not rewrite or re-verify these — they're regression-checked by running the existing test suite.

### Migration work (new or modified)

**Modified:**
- [ ] F2 (setup window): 10-minute window, absolute UTC timestamp display, inline recovery instructions per UX principle.
- [ ] F3 (setup form): new fields (`admin_password`, `theme`) and new KV writes (`admin_password_hash`, `cookie_signing_secret`, optional `access_*` from JWT auto-detection).
- [ ] F4 system prompt addition: "plain text only, no markdown" instruction present in system prompt.
- [ ] F12 (admin auth): password-based auth, session cookies, login endpoint with rate limiting and anti-bruteforce delay, optional CF Access JWT verification when `access_email` is set.
- [ ] F13 (admin panel additions): theme switcher, sign-out button, password-change fields, `/admin/reset` endpoint with literal "DELETE ALL CONFIG" confirmation.
- [ ] F19 (error pages with inline recovery): all `done_when` pass — including the requirement that no `<a href="docs/...">` exists for recovery flows.

**New:**
- [ ] F5 (theme system) `done_when` passes — hex tokens, font families, `data-theme` attribute, light/dark switching.
- [ ] F6 (message formatting and citation rendering) `done_when` passes — markdown stripping, citation badge replacement, partial-match preservation regex, HTML escaping.
- [ ] F7 (streaming animations) `done_when` passes — fadeUp, typing indicator, reduced-motion support.
- [ ] F8 (auto-scroll) `done_when` passes — smooth scroll, 100px near-bottom threshold, unconditional scroll on submit.
- [ ] F9 (mobile responsive) `done_when` passes — viewport meta, breakpoint, 44px touch targets, keyboard handling attempt.
- [ ] F10 (input UX) `done_when` passes — textarea, Enter to send, Shift+Enter newline, Escape clear, disabled state on empty, suggested-question single-click.
- [ ] F11 (loading and error UI) `done_when` passes — synchronous disabled state, typing indicator, error mapping for chat HTTP responses including the Anthropic credit-balance case.
- [ ] F14 (footer attribution) `done_when` passes — three hardcoded constants (`MAINTAINER_GH_USERNAME` = `m-naw`, `MAINTAINER_REPO_NAME` = `theclientzero-askmycv`, `MAINTAINER_X_HANDLE` = `TheClientZero`), three attribution elements, sticky positioning, AGPL Section 7(b) LICENSE clause added.
- [ ] F15 (SEO meta tags) `done_when` passes — title, description, OG tags, Twitter card, HTML escaping.
- [ ] F16 (accessibility baseline) `done_when` passes — keyboard navigation, semantic HTML, ARIA on chat log, focus indicators, WCAG AA contrast.
- [ ] F20 (documentation structure) `done_when` passes — all 7 docs files exist (`README.md` updated, `docs/UNINSTALL.md`, `docs/SECURITY.md`, `docs/ACCESS_FALLBACK.md`, `docs/TROUBLESHOOTING.md`, `docs/PREFLIGHT.md`, `docs/SPEC_CORRECTIONS.md` stub, `docs/SOURCES.md`).
- [ ] F21 (preflight checklist in README) `done_when` passes — section heading and three signup URLs.
- [ ] `docs/SOURCES.md` lists ≥ 5 distinct third-party documentation URLs with verification dates.
- [ ] LICENSE has AGPL-3.0 Section 7(b) attribution clause added (requires forks to preserve source-repo footer link per F14).
- [ ] New/modified tests (Tests 1-9, 11-20) pass.

### Universal (apply to entire codebase after migration)

- [ ] No instruction in any docs file or in-app page contains placeholder phrases ("go to the dashboard", "find the setting") without exact navigation paths.
- [ ] Every instruction referencing third-party UI has a citation comment with source URL and verification date.
- [ ] No in-app error/recovery HTML page contains anchor elements pointing to `docs/` paths or in-repo MD files for recovery procedures. All recovery instructions are inline as visible HTML content per the UX principle in META.
- [ ] `docs/SPEC_CORRECTIONS.md` exists (as stub or with filed corrections).

### Out of scope (explicit non-deliverables)

The implementer does NOT produce, verify, or document:

- Backward-compatibility for already-configured workers. The owner accepts wiping the STATE KV namespace and re-running setup.
- Migration of existing KV-shape data into new-shape data. No transformation scripts.
- Preservation of any production deployment continuity. No production users exist.

---

**End of specification.**
