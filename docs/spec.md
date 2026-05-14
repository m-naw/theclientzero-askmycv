# AskMyCV — Product Specification

**Version:** 1.1
**Document purpose:** Defines what AskMyCV must do and how it must behave from the user's perspective. This document is the source of truth for acceptance. Technical decisions outside the explicit business constraints are left to the implementer.

## Verification model

Every `done_when` item in this spec must be **autonomously verifiable** by an implementer running tests against a local instance of the Worker (e.g., `wrangler dev`) with mocked external dependencies (Anthropic API, Cloudflare Access JWKS). Specifically, acceptance is established by:

- **HTTP probing:** sending requests to the running Worker and asserting on status codes, headers, response bodies (parsed HTML, JSON, or SSE streams).
- **KV inspection:** reading and writing to the Worker's KV namespace directly to verify state transitions and set up test fixtures.
- **Static analysis:** inspecting source files for required strings, file presence, configuration values.
- **Mocking:** stubbing Anthropic API responses and signed Access JWTs (via a controllable JWKS endpoint) to drive deterministic test scenarios.

Out of scope for autonomous verification — and therefore intentionally absent from this spec:

- Visual quality, aesthetic polish, design taste.
- Wall-clock perceived performance ("loads in under 1.5 seconds").
- End-to-end flows through third-party UIs (Cloudflare Deploy button click-through, OAuth flows, manual Cloudflare Access dashboard configuration).
- Specific browser rendering behavior across vendors.
- Human-elapsed time for owner-driven setup steps.

If a behavior matters but cannot be auto-verified, it is described as context only and does not appear in `done_when` criteria.

---

## 1. Product summary

AskMyCV is a self-hosted, single-page web product that turns a person's CV into an interactive AI chat. The owner publishes a public URL; visitors (typically recruiters and hiring managers) ask questions about the owner's career, and an AI assistant responds in the owner's voice, grounded only in the owner's CV.

The product is open source and designed for one-click self-deployment to the owner's own cloud account. Each owner runs their own isolated instance with their own AI provider key. There is no central service operated by the project maintainers.

**Primary use case:** A job-seeking software professional uses AskMyCV as a richer alternative to a static PDF CV. They share their AskMyCV URL on LinkedIn, in cover letters, and in job applications. Recruiters can ask specific questions ("largest team led?", "compensation expectations?") and get accurate, source-cited answers without scheduling a screening call.

---

## 2. Why this product exists

A static PDF CV gives a recruiter 30 seconds of skimming before they decide. An AskMyCV URL gives them 5 minutes of dynamic, query-driven exploration tailored to what they care about. Owners get more meaningful first contacts; recruiters get faster signal.

Secondary use case: the open-source nature makes AskMyCV itself a portfolio piece — especially for owners applying to AI-leaning engineering roles.

---

## 3. Glossary

- **Owner** — the person who deploys AskMyCV and whose CV is the subject of the chat.
- **Visitor** — anyone the owner shares the URL with; typically recruiters, hiring managers, or peers.
- **Worker** — a deployed instance of AskMyCV running on the owner's Cloudflare account.
- **Worker URL** — the public address of the Worker, e.g., `https://krzysiek-cv.workers.dev`.
- **Cloudflare Access** — Cloudflare's identity-based access control product. Used to gate owner-only routes.
- **Access JWT** — a signed token issued by Cloudflare Access to authenticated users; carried in a request header.
- **CV** — the owner's career history, provided as markdown text.
- **Anthropic key** — an API key from Anthropic that allows calls to the Claude API on the owner's account.
- **BYOK** — "Bring Your Own Key." Each owner provides their own Anthropic API key.

---

## 4. Business constraints (fixed — not for the implementer to choose)

These decisions have been made and are out of scope for re-evaluation. The implementer must honor all of them.

### Platform and stack
- The product is deployed as a **Cloudflare Worker** running on the owner's own Cloudflare account.
- Configuration and runtime state are persisted in a **Cloudflare KV namespace** bound to that Worker.
- The AI provider is **Anthropic Claude**, accessed via Anthropic's HTTP API. No other providers in v1.

### Distribution model
- Each owner runs their own single-tenant instance. There is no shared service.
- Deployment is **one-click via Cloudflare's Deploy-to-Cloudflare button**, which forks the source repository to the owner's GitHub account, creates the KV namespace, and deploys the Worker.
- The product is licensed **AGPL-3.0**.

### Key handling (BYOK)
- The owner provides their own **Anthropic API key**. The key is stored in the owner's KV namespace.
- The product never operates a shared inference service, never aggregates keys, and never sends the owner's key anywhere except to Anthropic.

### Authentication and access control
- All owner-only routes (setup and admin) are gated by **Cloudflare Access**, configured by the owner on their own account.
- The Worker independently validates the Access JWT on every request to those routes — signature, issuer, audience, and email — and does not trust the header existence alone.
- Public-facing routes (the chat page, the chat API, the health endpoint) must remain accessible without any login. Recruiters must never see a login screen.

### Cost and abuse safety
- Each instance must enforce a **daily spend cap** on AI inference, configurable by the owner, as a hard upper bound on Anthropic billing per day.
- Each instance must enforce **per-visitor rate limits** on chat requests.
- Each instance must include input validation and bot detection sufficient to make casual scripted abuse uneconomical for the attacker.

### Language and accessibility
- All in-app UI text, code comments, and documentation are in **English**.

---

## 5. Out of scope (non-goals)

The product explicitly does NOT include the following in v1. Implementers must not add them:

- A multi-tenant SaaS offering.
- A WYSIWYG CV editor. Owners provide CV content as raw markdown.
- PDF parsing or upload functionality.
- LinkedIn API integration. (Free-tier LinkedIn API does not expose work history; this is intentionally excluded.)
- Custom domain support. The Worker runs on the `*.workers.dev` subdomain.
- Persistent per-visitor conversation history across sessions.
- Analytics dashboards.
- Multi-language UI.
- Voice or video interaction.
- Email notifications.
- Support for AI providers other than Anthropic Claude.

---

## 6. User personas

### Persona 1: The Owner (primary user)

- Mid-level or senior software engineer or engineering leader.
- Active in a job search or open to one.
- Has or can create a GitHub account and a Cloudflare account.
- Has or is willing to create an Anthropic account and top up ~$5 in credits.
- Will invest 5–10 minutes in setup if the product earns it.
- Cares about: cost predictability, control over their data, and signaling sophistication to recruiters.

### Persona 2: The Visitor (secondary user)

- Recruiter, hiring manager, or technical interviewer.
- Has received the link directly from the owner.
- Has no account anywhere; just clicks a link in their browser.
- Will tolerate: 1–2 seconds for an answer to start streaming.
- Will NOT tolerate: a login screen, a captcha, signing up for anything, or a CAPTCHA-style proof-of-personhood.

---

## 7. End-to-end user journeys

### Journey A: Owner from zero to live (the critical path)

1. Owner reads the project README on GitHub and clicks the "Deploy to Cloudflare" button.
2. Owner is prompted to authorize Cloudflare on their GitHub account (sign-up flow if needed).
3. Owner is prompted to log into Cloudflare (sign-up flow if needed).
4. Cloudflare forks the source repo to the owner's GitHub, creates a KV namespace, deploys the Worker, and presents the owner with a Worker URL.
5. Owner visits the Worker URL.
6. The Worker, detecting no existing configuration and no Cloudflare Access JWT in the request, presents a clear step-by-step guide explaining that the owner must configure Cloudflare Access on the `/setup` and `/admin` paths before continuing.
7. Owner follows the in-app guide and configures Cloudflare Access in the Cloudflare dashboard (~3 minutes).
8. Owner returns to the Worker URL. Cloudflare prompts them to authenticate via the Access policy.
9. After authentication, the Worker validates the Access JWT and presents the setup form.
10. Owner pastes their Anthropic API key and CV markdown, fills in name, headline, and any optional fields, and submits.
11. The Worker validates the Anthropic key with a real test call, stores configuration and secrets in KV (locked to the JWT's identity), and presents a confirmation screen showing the public URL and the admin URL.
12. Owner copies the public URL and shares it on LinkedIn or in a job application.

> The journeys in this section are descriptive context, not acceptance criteria. They explain why the system behaves the way it does. Acceptance comes from sections 9, 10, and 12.

### Journey B: Visitor chats with the CV

1. Visitor clicks a link from LinkedIn, an email signature, or wherever the owner posted it.
2. The browser loads a chat page. The owner's name, headline, and a brief intro are immediately visible.
3. Several suggested starter questions appear (e.g., "Tell me about a hard technical decision," "Salary expectations?").
4. Visitor clicks a suggestion or types their own question.
5. The first tokens of the response appear within ~1.5 seconds and stream into view.
6. The response cites the CV as its source (e.g., a `[cv]` marker on factual claims).
7. Visitor continues the conversation for up to 12 turns.

### Journey C: Owner edits configuration later

1. Owner navigates to `<worker-url>/admin`.
2. Cloudflare Access prompts for login.
3. After authentication, the Worker presents a pre-filled edit form.
4. Owner updates a field (e.g., adds a new role to the CV) and submits.
5. The change is live on the public chat within seconds, with no redeploy.

### Journey D: Recovery from a stuck state

If the owner gets the Worker into an unusable state — setup window expired, configuration locked to a wrong identity, lost access — the recovery path involves at most: deleting one or more known KV entries via the Cloudflare dashboard, then refreshing. The recovery path is documented inside the Worker's own error pages.

---

## 8. System states

The Worker operates as a state machine. The current state is determined entirely by the contents of KV plus the incoming request's Cloudflare Access JWT.

### State A: `unconfigured_no_access`
**Entered when:** KV has no `config` entry and the incoming request has no valid Cloudflare Access JWT.
**Behavior:**
- HTML requests render the Access setup instructions page.
- POST to `/setup` is refused with a clear "Access required" error.
- `/chat` returns a service-unavailable response.
- On the first such request, the Worker records a timestamp to start the setup window timer.

### State B: `unconfigured_with_access`
**Entered when:** KV has no `config` entry AND the incoming request carries a valid Cloudflare Access JWT (signature, issuer, expiration verified).
**Behavior:**
- HTML requests render the setup form, pre-filled with the JWT's email so the owner sees who they're authenticated as.
- POST to `/setup` is accepted if the setup window has not expired.

### State C: `configured`
**Entered when:** KV has a `config` entry.
**Behavior:**
- Public HTML requests render the chat page.
- `/chat` is fully operational, subject to rate limits and the daily budget cap.
- POST to `/setup` returns "already configured."
- `/admin` and `/admin/save` require a valid Cloudflare Access JWT that strictly matches the identity recorded during setup (same team domain, same audience, same email).

### State D: `setup_window_expired`
**Entered when:** The setup window has elapsed (default: 30 minutes from first request) and `unconfigured_no_access` still applies.
**Behavior:**
- HTML requests render an expired-window page with explicit recovery instructions.
- POST to `/setup` returns an expired-window error.

---

## 9. Functional requirements

Each requirement carries a `done_when` checklist that defines acceptance.

### F1: One-click deployment

**Goal:** An owner deploys the product without touching a terminal, editing config files, or running shell commands.

**Business rules:**
- The README must contain a Cloudflare Deploy button link that triggers Cloudflare's fork-and-deploy flow.
- The deploy must create the Worker, the KV namespace, and the binding between them.
- No secrets, environment variables, or wrangler commands must be required from the owner before reaching the first running Worker URL.

**done_when:**
- [ ] The repo contains a README with a Cloudflare Deploy button link whose target is a valid `deploy.workers.cloudflare.com` URL referencing the repo.
- [ ] The repo's `wrangler.toml` declares the `STATE` KV binding and does not embed any secrets.
- [ ] The Worker source code does not read any secret from environment variables or `vars` blocks — all secrets are read from KV.
- [ ] No `wrangler secret put` or terminal step is documented as required for setup.

### F2: Initial onboarding (Access setup guidance)

**Goal:** A first-time owner who has never used Cloudflare Access can successfully gate the right routes by following only the on-page instructions.

**Business rules:**
- An owner visiting the Worker URL without a valid Access JWT must see step-by-step instructions, not a setup form.
- The instructions must cover: opening Cloudflare Zero Trust, creating a self-hosted Access application, scoping that application to `/setup` and `/admin/*` paths only, and creating an Allow policy for the owner's own email.
- The instructions must explicitly warn against gating the chat page (`/`) or the chat API (`/chat`), because doing so would lock recruiters out.
- The instructions must include a clearly visible action ("I configured Access — continue") that the owner can use once they've finished.
- The page should automatically detect when the owner has authenticated (e.g., by polling and detecting an Access cookie) and update the UI without forcing the owner to manually reload, or at minimum offer a one-click way to continue.

**done_when:**
- [ ] `GET /` with empty KV (no `config`) and no Access JWT returns HTTP 200 with HTML containing: (a) the literal string `Cloudflare Access`, (b) the literal path `/setup`, (c) the literal path `/admin`, and (d) a visible warning string referencing the chat/root path that must NOT be gated.
- [ ] `GET /` with empty KV and no Access JWT does NOT contain any input field for an Anthropic key or CV content (i.e., it is not a setup form).
- [ ] `GET /` with empty KV and a valid Access JWT (signature verified against a controllable JWKS, issuer matching `*.cloudflareaccess.com`) returns HTML containing input fields for at least: `display_name`, `headline`, `anthropic_api_key`, `cv_markdown`.
- [ ] The instructions page exposes a way for the page to detect that the owner has authenticated and respond (e.g., a `/health` poll or a reload trigger); this is verifiable by inspecting the rendered HTML/JS source for the polling or reload mechanism.

### F3: Setup form

**Goal:** The owner can submit all required configuration in a single form, with validation and a verified Anthropic key, in a single attempt.

**Business rules:**
- Required fields: display name, headline, Anthropic API key, CV markdown.
- Optional fields: location, LinkedIn URL, GitHub URL, PDF CV URL, accent color.
- Advanced/collapsible fields: Claude model choice (default: Haiku; option: Sonnet), daily budget in USD (default: $5; min $0.50, max $100), per-IP messages per hour (default: 30; min 5, max 300).
- The Anthropic key must be validated against the Anthropic API with a real minimal request before being persisted. If the key is invalid, has no credits, or is rate-limited, the form must show a specific error and not persist any data.
- The CV markdown must have a sensible minimum length (~200 characters) and a maximum size (~50 KB) to prevent abuse and keep prompt costs bounded.
- The setup form submission must require a valid Cloudflare Access JWT.
- On successful submission, the Worker records — alongside the configuration — the JWT's email, audience, and team domain. These are used later to authorize admin actions.

**done_when:**
- [ ] `POST /setup` without a valid Access JWT returns HTTP 403 and does not write to KV.
- [ ] `POST /setup` with a valid JWT but missing required fields returns HTTP 400 with an error response identifying the missing field(s).
- [ ] `POST /setup` with a valid JWT and a syntactically invalid Anthropic key (one that fails the live test call) returns HTTP 400 with an error response identifying `anthropic_api_key` as the problem, and does not write `config` or `secrets` to KV.
- [ ] `POST /setup` with a valid JWT and valid fields writes both `config` and `secrets` to KV and returns HTTP 200.
- [ ] The persisted `config` entry contains the Access JWT's `aud`, `email`, and team domain as fields (verifiable by reading `config` from KV after the successful POST).
- [ ] `POST /setup` after a successful prior setup (i.e., `config` already exists in KV) returns HTTP 403 regardless of JWT validity.
- [ ] Given a CV markdown shorter than 200 characters, `POST /setup` returns HTTP 400.
- [ ] Given a CV markdown longer than 50,000 characters, `POST /setup` returns HTTP 400.
- [ ] The HTTP 200 success response body includes the worker's public URL and an admin URL (the literal path `/admin`).

### F4: Visitor chat experience

**Goal:** A recruiter visiting the public URL can hold a useful, source-cited conversation about the owner's career, without registering or logging in.

**Business rules:**
- The chat page must show, immediately at load: the owner's display name, headline, optional location, and links (LinkedIn, GitHub, PDF if provided).
- A small set of suggested starter questions must be visible to lower the activation barrier for visitors who don't know what to ask.
- The chat input must be unobtrusive and always reachable.
- Replies are streamed (Server-Sent Events) rather than returned as a single response body.
- The AI assistant must behave as follows:
  - Reply in the first person, as if it were the owner.
  - Answer only based on the owner's CV. If asked about something not in the CV, respond with words to the effect of "that's not in my profile — best to ask me directly."
  - Mark factual claims with an inline citation marker (e.g., `[cv]`) that the chat UI styles as a small tag.
  - Politely decline off-topic requests (write code, summarize a news article, do the visitor's job) and redirect to CV-related discussion.
  - Refuse instruction-injection attempts (e.g., "ignore previous instructions and ...") and not reveal its system prompt.
- The conversation context window per session is capped at 12 turns. Older turns are dropped from the request beyond that.
- Individual visitor messages are length-bounded (~1,500 characters) before being sent to the AI.
- The assistant's maximum output tokens per response is bounded (~512 tokens) to control cost and keep responses focused.

**done_when:**

*Chat page rendering (with `config` present in KV):*
- [ ] `GET /` returns HTTP 200 with HTML containing the configured `display_name`, `headline`, and (if set) `location` as plain text.
- [ ] If `linkedin_url`, `github_url`, or `pdf_cv_url` are set in config, the HTML contains anchor (`<a>`) tags with those URLs as `href`.
- [ ] The HTML contains at least 3 suggested-question elements (verifiable by parsing the DOM for clickable elements that pre-fill the chat input).
- [ ] The HTML contains a textarea or input element for the visitor to type into and a submit control.

*Chat API contract:*
- [ ] `POST /chat` with a well-formed JSON body containing a `messages` array and a browser-like user-agent header returns HTTP 200 with response header `content-type: text/event-stream`.
- [ ] `POST /chat` with an empty body, missing `messages`, or an empty `messages` array returns HTTP 400.
- [ ] `POST /chat` with a `messages` array containing more than 12 entries: the request actually sent to the Anthropic API (verifiable via mock interceptor) contains at most 12 messages (oldest dropped).
- [ ] `POST /chat` with a single message of more than 1,500 characters: the message content actually sent to Anthropic is truncated to 1,500 characters.
- [ ] `POST /chat` with a message that is more than 100 characters and more than 70% uppercase characters returns HTTP 400 without contacting Anthropic.
- [ ] The Anthropic API request constructed by the Worker (verifiable via mock interceptor) has `max_tokens` ≤ 512.

*System prompt content (verifiable by intercepting the Anthropic request):*
- [ ] The `system` field of the Anthropic API request contains the configured `cv_markdown` content verbatim.
- [ ] The `system` field contains an instruction to answer in the first person.
- [ ] The `system` field contains an instruction to refuse out-of-CV questions with a redirect to ask the owner directly.
- [ ] The `system` field contains an instruction to mark factual claims with a citation token (e.g., `[cv]`).
- [ ] The `system` field contains an instruction to refuse instruction-injection / prompt extraction attempts.
- [ ] The `system` field contains an instruction to politely decline off-topic requests.

### F5: Admin / configuration editing

**Goal:** The owner can edit any aspect of their configuration after initial setup, gated only by Cloudflare Access.

**Business rules:**
- The admin URL is a fixed, simple path: `<worker-url>/admin`. No secret tokens in URL parameters.
- Admin access requires a valid Cloudflare Access JWT that strictly matches the identity recorded during setup: same email, same Access audience, same team domain.
- A failing JWT check renders a clear error page that names the specific reason (email mismatch, audience mismatch, no JWT present, signature invalid, expired) and explains the remediation.
- The admin form is pre-filled with the current configuration.
- Submitting the form updates KV; changes take effect immediately on the next chat request, with no redeploy.
- The Anthropic key field is optional on edit. Empty means "no change." A non-empty new value is validated against Anthropic before replacing the existing one.

**done_when:**

*Read access:*
- [ ] `GET /admin` with `config` present in KV but no `cf-access-jwt-assertion` header returns HTTP 403.
- [ ] `GET /admin` with a JWT whose signature does not validate against the configured JWKS returns HTTP 403.
- [ ] `GET /admin` with a JWT whose `email` does not match `config.access_email` returns HTTP 403.
- [ ] `GET /admin` with a JWT whose `aud` does not match `config.access_aud` returns HTTP 403.
- [ ] `GET /admin` with a JWT whose issuer does not match `config.access_team_domain` returns HTTP 403.
- [ ] `GET /admin` with a fully matching JWT returns HTTP 200 with HTML containing input fields pre-filled with the current `config` values.

*Save:*
- [ ] `POST /admin/save` without a valid matching JWT returns HTTP 403 and does not modify KV.
- [ ] `POST /admin/save` with a fully matching JWT and an updated `headline` field writes the new `config` to KV and returns HTTP 200.
- [ ] `POST /admin/save` with the `anthropic_api_key` field absent or empty does not overwrite the existing `secrets` entry in KV.
- [ ] `POST /admin/save` with a non-empty `anthropic_api_key` that fails the Anthropic test call returns HTTP 400 and does not overwrite the existing `secrets` entry.
- [ ] After a successful `POST /admin/save` updating `cv_markdown`, the next `POST /chat` request's outgoing Anthropic call contains the new CV content in the system prompt.

### F6: Daily budget cap (cost ceiling)

**Goal:** The owner is mathematically protected from a runaway AI bill regardless of attack volume.

**Business rules:**
- The owner sets a daily budget in USD at setup time (default $5), editable later.
- The Worker must track cumulative cost of chat completions per UTC day.
- Cost tracking must reflect: input tokens, cached input tokens, and output tokens at the rates appropriate for the selected Claude model.
- When the cumulative cost for the current UTC day reaches or exceeds the budget, all further `/chat` requests must be refused with a service-unavailable response until UTC midnight.
- Cost tracking should be best-effort: if a KV write to update spend fails, the chat response to the visitor must not fail because of it.

**done_when:**
- [ ] Given mocked Anthropic responses producing a known token usage (input + cached + output), after each successful `POST /chat` the Worker writes an updated `spend:<UTC-date>` value to KV.
- [ ] The persisted spend value increases monotonically across requests within the same UTC day.
- [ ] Given a pre-seeded `spend:<today>` KV value equal to or greater than `config.daily_budget_usd`, the next `POST /chat` returns HTTP 503 without contacting the Anthropic API (verifiable via mock interceptor recording zero calls).
- [ ] The cost calculation per response, given known token counts, equals (within 5% rounding tolerance): `(input_tokens × input_rate + cached_tokens × cached_rate + output_tokens × output_rate) / 1_000_000`, where the rates are model-specific (Haiku: 1 / 0.10 / 5; Sonnet: 3 / 0.30 / 15).
- [ ] The `spend:<date>` KV key is set with an expiration of at least 24 hours so it auto-clears after the day ends.

### F7: Anti-abuse

**Goal:** Casual abuse (scripted bots, CLI tools, malicious visitors) is blocked without inconveniencing legitimate recruiters.

**Business rules:**
- Per-IP rate limit on `/chat` requests (default: 30 per hour, configurable). Exceeding it returns a too-many-requests response.
- Obvious bot signals are rejected: empty user agent, very short user agent, or known CLI tool user agents (curl, wget, python-requests, httpie, go-http, etc.) on `/chat`.
- Visitor input is validated: per-message length cap, total turns cap, and rejection of garbage input (e.g., all-caps strings over a length threshold).
- The assistant's system prompt explicitly instructs it to refuse instruction-injection attempts and to not reveal its instructions.

**done_when:**
- [ ] `POST /chat` with `user-agent: curl/8.0.0` returns HTTP 403 without contacting Anthropic.
- [ ] `POST /chat` with no user-agent header returns HTTP 403 without contacting Anthropic.
- [ ] `POST /chat` with `user-agent: python-requests/2.31.0` returns HTTP 403.
- [ ] `POST /chat` with a realistic browser user-agent and a valid body succeeds (HTTP 200).
- [ ] Issuing `config.max_msgs_per_hour + 1` chat requests from the same source IP within an hour: the final request returns HTTP 429 without contacting Anthropic.
- [ ] After the hour-window rolls over (verifiable by manipulating the KV rate-limit key directly), requests from the same IP succeed again.
- [ ] `POST /chat` with a message body containing 5,000+ characters where over 70% are uppercase returns HTTP 400 without contacting Anthropic.

### F8: Error states and recovery

**Goal:** Every error state the Worker can produce has a documented recovery path that does not require redeploying or asking the project maintainer.

**Business rules:**
- Each error page must explain in plain language what happened and what the owner should do next.
- The setup-window-expired page must explain step-by-step how to delete the relevant KV key to reset the window.
- The admin access-denied page must name the specific reason (email mismatch, audience mismatch, etc.) so the owner can correct it.
- The recovery path for "I deployed but never finished setup and now I'm locked out" must require only: open Cloudflare dashboard → KV → delete `setup_window_start` → refresh.

**done_when:**
- [ ] With KV pre-seeded so that `setup_window_start` is older than 30 minutes and `config` is absent, `GET /` returns HTML containing: (a) wording indicating the setup window has expired, (b) the literal key name `setup_window_start`, (c) a reference to the Cloudflare dashboard.
- [ ] After deleting the `setup_window_start` key from KV (simulating the recovery action), `GET /` returns the setup instructions page or the setup form (depending on JWT presence), not the expired page.
- [ ] The admin access-denied page (returned for any failed JWT check on `/admin`) includes wording identifying which check failed: at minimum distinguishing `email_mismatch`, `aud_mismatch`, `team_domain_mismatch`, `signature_invalid`, `no_jwt`.

---

## 10. Non-functional requirements (auto-verifiable subset only)

The following behaviors are auto-verifiable and required.

### Streaming responses
- [ ] `POST /chat` responses have header `content-type: text/event-stream` and the response body is emitted as SSE events (verifiable by reading the response as a stream and parsing event chunks before the upstream Anthropic mock has fully resolved).

### Anthropic failure handling
- [ ] When the mocked Anthropic API returns HTTP 500, `POST /chat` returns a non-2xx response to the visitor with a JSON body containing an `error` field, and the Worker does not crash (subsequent requests still succeed).
- [ ] When the mocked Anthropic API times out, `POST /chat` returns a non-2xx response within a bounded time (no hung connection).
- [ ] Failed `spend:<date>` KV writes (simulated by mocking KV `put` to throw) do not cause the visitor's `POST /chat` response to fail. The streamed body is still delivered fully.

### Secrets handling
- [ ] The Anthropic API key is never present in any HTML response served by the Worker (verifiable by issuing `GET /`, `GET /admin`, `GET /setup` and grepping the bodies for the configured key value).
- [ ] The Anthropic API key is never present in `console.log` / Worker log output (verifiable by capturing the Worker's stderr/stdout during a test run).

### Input bounds (defense in depth)
- [ ] `POST /setup` with a `cv_markdown` field over 50,000 characters returns HTTP 400 (already in F3, restated here as a security baseline).
- [ ] `POST /chat` with a `messages` array whose total serialized size exceeds 100 KB returns HTTP 400 or 413.

### Informational targets (NOT done_when criteria, not required for acceptance)

The following are documented intent but not auto-verifiable, and therefore not part of acceptance:

- Median cost per visitor conversation at default settings is estimated at ~$0.02 (Claude Haiku with prompt caching).
- The chat experience should feel responsive on modern desktop and mobile web browsers.

The implementer is encouraged to optimize for these, but failure to meet them does not block acceptance.

---

## 11. Implementation freedom

The following decisions are explicitly left to the implementer. The implementer should make defensible choices and may briefly document them in code comments.

**Open for implementer choice:**
- Programming language (any language Cloudflare Workers supports).
- HTML rendering approach (server-side templates, JSX, raw template strings, etc.).
- Choice of JWT verification library.
- Visual design: layout, typography, color, animation. The spec makes no claim about aesthetic quality. The HTML must contain the required elements named in `done_when` criteria; everything beyond that is the implementer's choice.
- Front-end framework or absence thereof.
- Internal code structure and module organization.
- Specific wording of error messages, beyond required keywords named in `done_when` criteria (e.g., the expired-window page must contain the literal string `setup_window_start`; the exact surrounding prose is open).
- Specific wording of the AI system prompt, beyond the required behavioral instructions named in F4's `done_when`.

**Locked by business constraint (the implementer must NOT):**
- Replace Cloudflare Workers with another platform.
- Replace Cloudflare KV with another storage system.
- Replace Anthropic Claude with another AI provider.
- Add a paid tier, central service, or shared inference.
- Skip cryptographic signature verification on the Access JWT.
- Skip the daily budget cap.
- Skip the rate limit.
- Make the chat page or the chat API require login.

---

## 12. End-to-end acceptance test scenarios

These scenarios validate that the requirements compose correctly. Each is auto-runnable against a local Worker instance (`wrangler dev` or equivalent) with the following test harness:

- A controllable mock of the Anthropic API the Worker will call (configurable status codes, response bodies, token usage).
- A controllable mock JWKS endpoint that issues signed test JWTs with arbitrary `aud`, `iss`, `email`, `exp` claims. The Worker's JWT verification logic must point at this endpoint during tests (e.g., via a test-only env binding or by isolating the JWKS fetch).
- Direct read/write access to the Worker's KV namespace for fixture setup and state inspection.

### Test 1: Cold-start state machine

**Fixtures:** Empty KV. No JWT.

**Steps:**
1. `GET /` — expect HTTP 200, HTML containing literal strings `Cloudflare Access`, `/setup`, `/admin`.
2. Inspect KV: `setup_window_start` must now be set to a recent timestamp.
3. `POST /setup` with valid body but no JWT — expect HTTP 403.
4. Inspect KV: `config` must still be absent.

### Test 2: Setup with valid JWT

**Fixtures:** Empty KV. Test harness issues a JWT with `iss=https://test.cloudflareaccess.com`, `aud=test-aud-1`, `email=owner@test`, valid signature, not expired.

**Steps:**
1. `GET /` with the JWT in `cf-access-jwt-assertion` header — expect HTTP 200, HTML containing input field for `cv_markdown`.
2. Pre-configure the Anthropic mock to return HTTP 200 on the test-call endpoint.
3. `POST /setup` with the JWT and valid body — expect HTTP 200, response body contains the worker's public URL.
4. Inspect KV: `config` must exist; its `access_email` must equal `owner@test`, `access_aud` must equal `test-aud-1`, `access_team_domain` must equal `test.cloudflareaccess.com`.
5. Inspect KV: `secrets` must exist and contain the submitted Anthropic key.

### Test 3: Setup blocked after configuration

**Fixtures:** `config` is already present in KV from Test 2.

**Steps:**
1. `POST /setup` with the same valid JWT and a different valid body — expect HTTP 403.
2. Inspect KV: `config` is unchanged.

### Test 4: Setup blocked with forged JWT

**Fixtures:** Empty KV.

**Steps:**
1. `POST /setup` with a JWT whose signature does not validate against the mock JWKS — expect HTTP 403.
2. `POST /setup` with a JWT whose `iss` is `https://attacker.example.com` (not a `*.cloudflareaccess.com` host) — expect HTTP 403.
3. `POST /setup` with a JWT that has expired — expect HTTP 403.
4. Inspect KV: `config` is absent in all three cases.

### Test 5: Setup window expiration and recovery

**Fixtures:** Empty KV. Pre-set `setup_window_start` to 31 minutes ago.

**Steps:**
1. `GET /` with no JWT — expect HTTP 200 with HTML containing wording about an expired setup window and the literal string `setup_window_start`.
2. `POST /setup` with valid JWT and valid body — expect HTTP 403.
3. Delete the `setup_window_start` key from KV.
4. `GET /` with no JWT — expect HTTP 200 with the Access setup instructions page (not the expired page).
5. `GET /` with a valid JWT — expect HTTP 200 with the setup form.

### Test 6: Public chat works without authentication

**Fixtures:** `config` is present with valid CV. `spend:<today>` is absent or 0. Anthropic mock returns a streaming response with a known token usage.

**Steps:**
1. `GET /` with no JWT, with a realistic browser user-agent — expect HTTP 200, HTML containing the configured `display_name` and `headline`.
2. `POST /chat` with no JWT, with a realistic browser user-agent, and a valid body `{messages: [{role: "user", content: "Hi"}]}` — expect HTTP 200, `content-type: text/event-stream`.
3. Read the response body as a stream and assert at least one SSE event is parsed.
4. Inspect the captured Anthropic mock request: its `system` field contains the configured `cv_markdown`.
5. Inspect KV: `spend:<today>` is non-zero after the request completes.

### Test 7: Bot/CLI requests rejected

**Fixtures:** `config` present.

**Steps:**
1. `POST /chat` with `user-agent: curl/8.0.0` — expect HTTP 403.
2. `POST /chat` with no user-agent header — expect HTTP 403.
3. `POST /chat` with `user-agent: python-requests/2.31.0` — expect HTTP 403.
4. In all cases, inspect the Anthropic mock — it must have received zero requests.

### Test 8: Per-IP rate limit

**Fixtures:** `config` present with `max_msgs_per_hour=3`. Anthropic mock returns success.

**Steps:**
1. Send 3 successive `POST /chat` requests from the same simulated IP — all return HTTP 200.
2. Send a 4th `POST /chat` from the same IP — expect HTTP 429. Anthropic mock confirms 3 calls received, not 4.

### Test 9: Daily budget cap

**Fixtures:** `config` present with `daily_budget_usd=1`. Pre-seed `spend:<today>` to `1.05`.

**Steps:**
1. `POST /chat` — expect HTTP 503. Anthropic mock confirms 0 calls.
2. Reset `spend:<today>` to `0`.
3. `POST /chat` — expect HTTP 200.

### Test 10: Admin requires matching identity

**Fixtures:** `config` present from Test 2 (locked to `email=owner@test`, `aud=test-aud-1`).

**Steps:**
1. `GET /admin` with no JWT — expect HTTP 403.
2. `GET /admin` with JWT `email=attacker@test, aud=test-aud-1` — expect HTTP 403; response body contains the word `email`.
3. `GET /admin` with JWT `email=owner@test, aud=different-aud` — expect HTTP 403; response body contains the word `aud`.
4. `GET /admin` with JWT `email=owner@test, aud=test-aud-1, iss=https://other.cloudflareaccess.com` — expect HTTP 403.
5. `GET /admin` with fully matching JWT — expect HTTP 200, HTML containing input fields pre-filled with current config values.

### Test 11: Admin edit reflects in chat

**Fixtures:** `config` present with `cv_markdown = "# Old CV content"`.

**Steps:**
1. `POST /admin/save` with fully matching JWT and body `{cv_markdown: "# Brand new role at Acme"}` — expect HTTP 200.
2. Inspect KV: `config.cv_markdown` is now `"# Brand new role at Acme"`.
3. `POST /chat` with a normal visitor request — inspect the Anthropic mock's captured request: its `system` field contains the new CV string and not the old one.

### Test 12: Anthropic failure does not break the Worker

**Fixtures:** `config` present. Anthropic mock returns HTTP 500.

**Steps:**
1. `POST /chat` with valid request — expect a non-2xx response.
2. Switch the Anthropic mock back to returning HTTP 200.
3. `POST /chat` again — expect HTTP 200 (Worker recovered, no persistent broken state).

---

## 13. Deliverables checklist

The implementation is `done_when` all of the following are verifiably true:

- [ ] All functional requirements F1–F8 pass their respective `done_when` criteria when exercised against a running local Worker.
- [ ] All non-functional requirements (section 10) pass their `done_when` criteria.
- [ ] All end-to-end acceptance test scenarios (Test 1–Test 12) pass against the running Worker with the documented test harness.
- [ ] The repo root contains a `README.md` file. Its contents include: the literal string `Deploy to Cloudflare` (or equivalent button markup), a `deploy.workers.cloudflare.com` URL referencing the repo, and a section describing the security model.
- [ ] The repo root contains a `LICENSE` file whose first 100 lines reference AGPL-3.0.
- [ ] The repo root contains a `cv.example.md` file with non-trivial content (at least 500 characters) that can be used as a CV template.
- [ ] The repo contains a `wrangler.toml` file declaring a Worker name and a KV namespace binding named `STATE`.
- [ ] The Worker source compiles / type-checks without errors using the implementer's chosen toolchain.

---

## 14. Out-of-band guidance for the implementer

These are suggestions, not requirements. Ignore them if you have a better idea consistent with the constraints above.

- The Worker's state machine is small enough that it can sensibly be implemented as a single source file with branching at the entry point. There is no need to introduce a routing framework.
- The Anthropic API supports prompt caching (cache control on the system message). Using it can reduce input-token cost by ~10x on warm conversations. Strongly recommended for cost control, but optional.
- Cloudflare Access publishes its JWKS at `https://<team-domain>/cdn-cgi/access/certs`. The `jose` library (npm) handles signature verification cleanly inside a Worker. Other libraries are fine.
- The setup window default of 30 minutes is calibrated to the typical time it takes to configure Cloudflare Access for the first time (~3 minutes) plus buffer. It can be adjusted if user research suggests a different value.
- Per-conversation cost estimates assume Claude Haiku at $1/M input, $0.10/M cached input, $5/M output tokens. If Anthropic's pricing changes, the cost-tracking logic must be updated.

---

**End of specification.**
