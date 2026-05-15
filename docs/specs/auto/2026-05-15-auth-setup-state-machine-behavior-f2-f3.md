## Problem Statement

The Worker has a JWT auth module (`src/auth/jwt.ts`) and a state machine (`src/state/machine.ts`) that are fully implemented but never called from the HTTP request handler. The Worker's GET `/` returns a hardcoded placeholder and POST `/setup` does not exist. G4 must wire these modules into real route behavior so the unconfigured → configured flow works end-to-end, and all acceptance tests 1–5 in docs/spec.md §12 pass.

## Current Behavior

**`src/worker.ts`** (52 lines): GET `/` returns a hardcoded string. GET `/admin` extracts a JWT and returns email JSON. No `/setup` route exists. `detectState()` and all view render functions are never called.

**`src/state/machine.ts`** (158 lines): Fully implemented. `detectState()` reads KV for `config`, `setup_window_start`, parses JWT claims, and returns one of four states (A: unconfigured+no-JWT, B: unconfigured+valid-JWT, C: configured, D: expired-window).

**`src/auth/jwt.ts`** (282 lines): Fully implemented. `verify()` validates signature against JWKS (test-injectable via `ACCESS_JWKS_URL_OVERRIDE`), checks `iss` matches `*.cloudflareaccess.com`, validates `exp`. `generateTestKeypair()` provides deterministic test keys.

**`src/views/`**: All six render functions exported. `setupInstructions`, `setupForm`, `expiredWindow`, `chatPage`, `adminForm`, `errorPages` templates from G3 are available.

**`src/env.ts`**: Declares `STATE` KV binding, `ANTHROPIC_BASE_URL` (test override), `ACCESS_JWKS_URL_OVERRIDE` (test override).

**Tests**: 67 unit tests pass covering state machine and auth modules. No route integration tests exist.

## Proposed Changes

### Primary output: `src/worker.ts` (rewrite routing logic)

**GET `/` handler** must:
1. Call `detectState(request, env)` with the incoming request and KV bindings
2. Branch on result:
   - State A (unconfigured, no valid JWT): Write `setup_window_start` to KV if not already set; render `setupInstructions` template
   - State B (unconfigured, valid JWT): Render `setupForm` template
   - State C (configured): Render `chatPage` template (no auth required — public)
   - State D (expired window): Render `expiredWindow` template
3. Return HTTP 200 with rendered HTML in all cases

**POST `/setup` handler** must:
1. Verify JWT via `auth.verify(request, env)` — return 403 if invalid/missing
2. If config already exists in KV — return 403 immediately
3. If setup window expired (state D) — return 400/expired error
4. Parse request body as form data or JSON
5. Validate required fields: `display_name`, `headline`, `anthropic_api_key`, `cv_markdown` — return 400 identifying first missing field
6. Validate `cv_markdown` length: 200 ≤ len ≤ 50000 — return 400 identifying `cv_markdown`
7. Perform Anthropic test call via `@anthropic-ai/sdk` Messages.create against `ANTHROPIC_BASE_URL` — return 400 identifying `anthropic_api_key` if rejected
8. Extract JWT claims: `email`, `aud`, `team_domain` (derive from `iss`)
9. Persist config object to KV: `{ display_name, headline, access_email, access_aud, access_team_domain, daily_budget_usd, cv_markdown_length }`
10. Persist secrets object to KV: `{ anthropic_api_key, cv_markdown }`
11. Return 200 with body containing public worker URL and literal string `/admin`

### New file: `src/routes/setup.ts`

POST /setup handler logic extracted for testability.

### New file: `src/test/setup-acceptance.test.ts`

Acceptance tests 1–5 from docs/spec.md §12 running inside `@cloudflare/vitest-pool-workers`.

## Implementation Notes

### Root cause of Attempt 1 failure

Prior sprint created `state/machine.ts` and `auth/jwt.ts` as standalone modules without modifying `src/worker.ts`. This spec explicitly names `src/worker.ts` as the primary deliverable. Done-when criteria test HTTP response behavior, not module existence.

### Anthropic test call shape

Test call must use: `{ model: "claude-3-haiku-20240307", system: "...", messages: [{ role: "user", content: "..." }], max_tokens: 1 }`. Tests verify outgoing request body has model/system/messages/max_tokens fields.

### State machine contract

`detectState()` is read-only. `setup_window_start` KV write happens in the worker GET / handler on first state-A visit, not inside detectState.

### Test harness pattern

Existing G2 harness uses `ACCESS_JWKS_URL_OVERRIDE`. Same pattern for `ANTHROPIC_BASE_URL`. Both declared in `src/env.ts`.

### Adversarial guard for KV persistence criterion

Test JWT must include explicit email, aud, and iss (team domain derivable from iss pattern). Acceptance test asserts `kv.get("config")` parses and contains non-empty values for access_email, access_aud, access_team_domain.

### HARD CONSTRAINTS honored

- Chat page (GET /) remains accessible without JWT — state C renders chatPage with no auth
- POST /setup requires jose JWT verification before any KV mutation
- Anthropic API key stored only in KV secrets, never in source or HTML

## Verification Criteria

See done_when fields in sprint objectives. All 13 goal-level done-when criteria are mapped to OBJ1 (GET / routing), OBJ2 (POST /setup behavior), or OBJ3 (test suite + build). Confidence scores: OBJ1 criteria at 0.90, OBJ2 criteria at 0.85–0.95, OBJ3 at 0.85.