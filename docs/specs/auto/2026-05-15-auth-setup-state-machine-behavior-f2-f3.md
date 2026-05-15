## Problem Statement

The worker (`src/index.ts`) is currently a 404 skeleton. G3 delivered all view templates but no route logic. G4 must wire the unconfigured → configured state machine — JWT authentication, KV-based state detection (states A/B/C/D), GET / rendering per state, and the POST /setup flow including Anthropic key validation — so that acceptance tests 1–5 from `docs/spec.md §12` pass.

## Current Behavior

- `src/index.ts`: returns HTTP 404 `"Not Found: /"` for every request (confirmed by `src/test/smoke.test.ts:smoke-2`).
- No auth module, no state detection, no setup route exists.
- Test harness is fully operational: `createJwksMock` issues and verifies RS JWTs; `createAnthropicMock` intercepts Anthropic API calls with configurable success/failure; both are wired via `env.ACCESS_JWKS_URL_OVERRIDE` and `env.ANTHROPIC_BASE_URL` in `vitest.config.ts` miniflare bindings.
- All four G3 view functions are exported from `src/views/index.ts`: `renderSetupInstructions`, `renderSetupForm`, `renderExpiredSetupPage`, `renderAccessDeniedPage`.

## Proposed Changes

### New modules

**`src/auth/jwt.ts`**
- Export `verifyAccessJwt(request: Request, env: Env): Promise<JwtClaims | null>`
- Reads `cf-access-jwt-assertion` header; returns `null` on absence.
- Fetches JWKS from `env.ACCESS_JWKS_URL_OVERRIDE` if set, otherwise `https://<team-domain>/cdn-cgi/access/certs` (derived from `iss` claim after initial decode).
- Uses `jose` (`createRemoteJWKSet` + `jwtVerify`) for cryptographic signature verification.
- Validates: `iss` matches `*.cloudflareaccess.com`, `exp` not in the past.
- Returns typed `JwtClaims { email: string; aud: string | string[]; iss: string; exp: number }`.
- Never-trivial surface: matches `*auth*` and `*jwt*` — R1/R2 dual-review required per CP.

**`src/state/machine.ts`**
- Export `detectState(env: Env, now: number): Promise<WorkerState>`
- `WorkerState` enum: `STATE_A_NO_ACCESS | STATE_B_WITH_ACCESS | STATE_C_CONFIGURED | STATE_D_EXPIRED`
- Reads `env.STATE.get('config')` and `env.STATE.get('setup_window_start')`.
- `STATE_C` when `config` key present.
- `STATE_D` when `config` absent and `setup_window_start` present and `>30 min` ago.
- `STATE_A` when `config` absent and no `setup_window_start` (or within 30 min); writes `setup_window_start = now.toString()` if absent.
- `STATE_B` is not a KV state — callers layer in JWT presence on top of `STATE_A`.

**`src/routes/root.ts`**
- Handles `GET /`.
- Calls `detectState()`; on `STATE_D` renders `renderExpiredSetupPage`.
- On `STATE_A` or `STATE_B`: calls `verifyAccessJwt()`.
  - No valid JWT → renders `renderSetupInstructions` (state A).
  - Valid JWT → renders `renderSetupForm({ mode: 'setup', email: claims.email })` (state B).
- On `STATE_C`: passes through to existing chat page handler (not implemented in G4).
- Returns `new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } })`.

**`src/routes/setup.ts`**
- Handles `POST /setup`.
- Step 1 — Auth gate: calls `verifyAccessJwt()`; returns 403 if absent or invalid.
- Step 2 — Config existence gate: reads `env.STATE.get('config')`; returns 403 if present.
- Step 3 — Expired-window gate: calls `detectState()`; returns 403 + expired-window HTML if `STATE_D`.
- Step 4 — Field validation: parses `FormData`; returns 400 with missing field names if any required field (`display_name`, `headline`, `anthropic_api_key`, `cv_markdown`) is absent or empty.
- Step 5 — CV length validation: returns 400 if `cv_markdown.length < 200` or `> 50000`.
- Step 6 — Anthropic test-call: calls `new Anthropic({ apiKey, baseURL: env.ANTHROPIC_BASE_URL }).messages.create({ model: 'claude-haiku-4-5-20251001', system: 'You are a helpful assistant.', messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 })`. On SDK error: returns 400 identifying `anthropic_api_key`.
- Step 7 — Persist: writes to KV:
  - `config` key: `{ display_name, headline, location?, linkedin_url?, github_url?, pdf_cv_url?, accent_color?, model, daily_budget_usd, max_msgs_per_hour, access_email: claims.email, access_aud: claims.aud, access_team_domain: new URL(claims.iss).hostname }`
  - `secrets` key: `{ anthropic_api_key }`
- Step 8 — Response: returns 200 HTML with public worker URL (from `request.url` origin) and literal `/admin`.

**`src/index.ts`** (modify)
- Replace 404 skeleton with router:
  - `GET /` → `root.ts` handler
  - `POST /setup` → `setup.ts` handler
  - All other routes → 404 (unchanged)

### New test files

**`src/__tests__/state-machine/state-machine.test.ts`**
- Tests for `detectState()`: all four states, window boundary at exactly 30 min, recovery after key deletion.

**`src/__tests__/setup/setup.test.ts`**
- Full acceptance tests 1–5 per `docs/spec.md §12`:
  - Test 1: cold start flow (DW1, DW2, DW3, DW5)
  - Test 2: setup with valid JWT + happy path (DW4, DW9)
  - Test 3: setup blocked after config (DW10)
  - Test 4: forged JWT variants — bad signature, wrong iss, expired (DW5)
  - Test 5: expired window + recovery (DW11, DW12)
- Additional unit cases: missing fields (DW6), Anthropic mock rejection (DW7), CV length bounds (DW8).

## Implementation Notes

**Surviving approach (Approach B — modular decomposition):** Chosen because the goal's affected-areas list explicitly declares `src/auth/`, `src/state/`, `src/routes/` as separate directories. This maps cleanly to the two test namespaces (`__tests__/setup/`, `__tests__/state-machine/`) and allows independent unit-testing of JWT verification.

**Auth module is never-trivial (CP mechanic 6):** `src/auth/jwt.ts` matches `*auth*` and `*jwt*` path patterns. Sprint 1 must include R1+R2 dual-review of this module before it merges.

**State B is a caller-level overlay, not a KV key:** KV only has `config` and `setup_window_start`. Whether the user is in state A vs state B is determined by layering JWT presence on top of the KV state. `detectState()` returns `STATE_A` for both; the route handler checks the JWT to differentiate rendering.

**JWKS URL injection:** `verifyAccessJwt()` must prefer `env.ACCESS_JWKS_URL_OVERRIDE` when set. The `iss` claim format is `https://<team>.cloudflareaccess.com` — extract hostname to build the JWKS URL as `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`. This matches the test harness URL `https://jwks.mock/cdn-cgi/access/certs`.

**Anthropic test-call shape (DW7 guard):** The call to `messages.create()` must use `system` as a top-level string field (not inside the messages array). Tests must assert the intercepted request body contains `model`, `system`, `messages`, and `max_tokens` at the top level. This is the documented Anthropic Messages API shape and the pattern already verified in `smoke.test.ts` for SSE calls.

**POST /setup in state D (DW11 guard):** The goal says "POST /setup in this state returns the expired-window error" — implement as HTTP 403 with `renderExpiredSetupPage` HTML body (not a plain 403 text). This matches the test expectation pattern established by other error renderings.

**Hard constraint — chat page accessibility:** `GET /` in `STATE_C` must pass through to the chat handler WITHOUT auth. This module does not implement G5+ routes; the `STATE_C` branch in `root.ts` must call the existing `renderChatPage` (from `src/views/index.ts`) or return a placeholder that will be replaced in G5.

**KV key `access_team_domain`:** Derived from `claims.iss` by extracting hostname: `new URL(claims.iss).hostname`. Spec Test 2 expects `access_team_domain: 'test.cloudflareaccess.com'` when `iss = 'https://test.cloudflareaccess.com'`.

**`daily_budget_usd` default discrepancy:** `renderSetupForm` defaults to `"1.00"` but spec F3 says `$5`. Resolve in this goal by setting the form default to `"5.00"` in `src/views/setup-form.ts` — this is a one-line fix in an existing view file.

**Flagged residual gaps:**
- DW7 (Anthropic call shape): guarded by test assertion on intercepted request body structure.
- DW11 (POST /setup state-D response): guarded by implementing as 403 + HTML render, not plain 403.

## Verification Criteria

**DW1:** `GET /` with empty KV, no JWT header → HTTP 200, body contains `"Cloudflare Access"`, `"/setup"`, `"/admin"`, and the chat-path warning string. Verified by Test 1 in `__tests__/setup/setup.test.ts`.

**DW2:** Same request → body does NOT contain `name="anthropic_api_key"` or `name="cv_markdown"`. Verified by negative assertion in Test 1.

**DW3:** After DW1 request, `await env.STATE.get('setup_window_start')` is not null and its numeric value is within 5 seconds of `Date.now()`. Verified in Test 1.

**DW4:** `GET /` with empty KV and a JWKS-signed JWT (valid `iss`, `exp` in future) → HTTP 200, body contains `name="display_name"`, `name="headline"`, `name="anthropic_api_key"`, `name="cv_markdown"`. Verified in Test 2 setup step.

**DW5:** `POST /setup` with no JWT → HTTP 403; `await env.STATE.get('config')` is null after request. Verified in Test 1.

**DW6:** `POST /setup` with valid JWT, missing `headline` field → HTTP 400, body mentions `"headline"`. Verified in unit sub-case.

**DW7:** `POST /setup` with valid JWT, Anthropic mock configured to reject → HTTP 400, body mentions `"anthropic_api_key"`; captured mock request body has keys `model`, `system`, `messages`, `max_tokens`. Verified in unit sub-case; mock interception asserts request shape.

**DW8:** `POST /setup` with `cv_markdown` of 199 chars → 400; `cv_markdown` of 50001 chars → 400. Verified in unit sub-cases.

**DW9:** `POST /setup` success → HTTP 200; `JSON.parse(await env.STATE.get('config'))` has `access_email`, `access_aud`, `access_team_domain` matching JWT claims; `JSON.parse(await env.STATE.get('secrets')).anthropic_api_key` equals submitted key; response body contains origin URL and `"/admin"`. Verified in Test 2.

**DW10:** With config present, `POST /setup` with valid JWT → HTTP 403; config value unchanged. Verified in Test 3.

**DW11:** `setup_window_start` pre-seeded to `Date.now() - 31*60*1000`; `GET /` → HTTP 200, body contains expired-window wording, literal `"setup_window_start"`, Cloudflare dashboard reference; `POST /setup` with valid JWT → HTTP 403 + expired-window HTML. Verified in Test 5.

**DW12:** After deleting `setup_window_start`, `GET /` → HTTP 200 without expired-window content (renders setup-instructions). Verified in Test 5 recovery step.

**DW13:** `pnpm build`, `pnpm typecheck`, `pnpm test` all exit 0; test count ≥ G3 baseline + tests for acceptance scenarios 1–5; all new tests use `SELF.fetch` with Workers pool.
