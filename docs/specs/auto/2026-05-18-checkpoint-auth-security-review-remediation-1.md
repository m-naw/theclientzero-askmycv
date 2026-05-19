## Problem Statement

A fresh Cloudflare Worker deployment with no Cloudflare Access policy cannot complete setup or reach the admin panel. `POST /setup` and `GET /setup` unconditionally return `403` when the `cf-access-jwt-assertion` header is absent, before any form is rendered or password is accepted. This contradicts the password-bootstrap model already implemented for `/admin` in `src/auth/access.ts:103-142` and blocks BYOK self-hosting without Cloudflare Access.

## Current Behavior

**`src/routes/setup.ts:62-76` (POST):** Calls `readAccessJwt()` → returns `403 "missing cf-access-jwt-assertion header"` when empty; calls `verifyAccessJwt()` → returns `403 "jwt verification failed: ..."` on any error. Both checks are unconditional — no JWT means no setup.

**`src/routes/setup.ts:211-224` (GET):** Identical unconditional JWT guard — missing JWT returns `403` before the form is rendered.

**`src/types/config.ts:24-26`:** `access_email`, `access_aud`, `access_team_domain` are declared as required `string` fields. `parseStoredConfig()` (lines 96-108) validates them as non-empty strings — storing empty strings when no JWT is present would cause every subsequent config read to fail validation.

**`src/state/machine.ts:109-131`:** When config exists and `ctx.jwtValid` is false, `detectState()` returns `{ state: C_CONFIGURED, reason: "access_denied" }`. Investigation of `src/test/admin.test.ts` ("success: valid session + no access_email configured → 200") confirms the worker routes admin requests through `requireAdminAuth` directly rather than gating on the state machine's `access_denied` reason — so this path does not block admin access for no-JWT setups, but it should be updated to reflect optional access identity.

**`src/auth/access.ts:103-142`:** `requireAdminAuth` already implements the correct dual-layer pattern: session cookie is primary; CF JWT is only enforced when `config.access_email` is set. This is the model to mirror.

**`src/auth/password.ts`:** `hashPassword()` at bcrypt cost 12 already exists. No changes needed.

**`src/auth/session.ts`:** `createSessionCookie(kv)` generates and persists `cookie_signing_secret` lazily. `getOrCreateSigningSecret` is internal but `createSessionCookie` is exported. POST /setup should call `createSessionCookie(env.STATE)` on success to both pre-initialize `cookie_signing_secret` and return a valid session cookie to the caller, enabling immediate admin access after setup.

## Proposed Changes

### 1. `src/routes/setup.ts` — Remove mandatory JWT, add admin_password, optional JWT capture

**POST handler:**
- Remove lines 62-76 (unconditional JWT gate).
- Add optional JWT capture block: attempt `readAccessJwt()` + `verifyAccessJwt()`; if header absent or verification fails, set `identity = null` and continue.
- Add `admin_password` to form parsing: read field, validate length 12-128 chars (reject with `400` outside range), call `hashPassword(admin_password)` to produce `admin_password_hash`.
- When `identity !== null`, persist `access_email: identity.email`, `access_aud: identity.aud`, `access_team_domain: identity.team_domain`; when null, persist these as empty strings `""`.
- Store `admin_password_hash` in the persisted config object.
- After persisting config, call `createSessionCookie(env.STATE)` and include the resulting `Set-Cookie` header in the `200` response.

**GET handler:**
- Remove lines 211-224 (unconditional JWT gate).
- Add optional JWT capture (same try/catch pattern).
- Call `renderSetupForm({ email: identity?.email ?? "" })` — the form renders with an empty email field when no JWT is present.

### 2. `src/types/config.ts` — Make access_* fields optional

- Change `access_email: string` → `access_email?: string`
- Change `access_aud: string` → `access_aud?: string`
- Change `access_team_domain: string` → `access_team_domain?: string`
- In `parseStoredConfig()`: remove `access_email`, `access_aud`, `access_team_domain` from `stringFields` (the required non-empty list). Add separate optional checks: if present, must be a string (but may be empty).

### 3. `src/state/machine.ts` — Handle optional access identity in C_CONFIGURED

- Update `StoredConfigIdentity` interface: make `access_email`, `access_aud`, `access_team_domain` optional.
- In `detectState()` C_CONFIGURED path (lines 109-131): only perform JWT claim matching when `storedConfig.access_email` is a non-empty string. If `access_email` is absent or empty, return `{ state: C_CONFIGURED }` without the JWT check (session-cookie auth handles access). This ensures setups completed without CF Access do not permanently lock out the admin.

### 4. `src/views/setup-form.ts` — Handle optional email in renderSetupForm

- Ensure `renderSetupForm({ email })` gracefully handles `email === ""` — either renders no email pre-fill or renders an editable field. No hard crash when empty.
- Add `admin_password` input field to the setup form HTML (type=password, minlength=12, maxlength=128).

### 5. `README.md` — Position CF Access as optional

- In the setup section, remove CF Access as a step 1 prerequisite.
- Add a note that CF Access is optional defense-in-depth: "You can complete setup using only an `admin_password`. Cloudflare Access, if configured, adds an additional JWT verification layer for admin access."

### 6. New `src/__tests__/integration/setup-without-cf.test.ts`

- Fresh worker, empty KV, no `__test_jwks`, no CF Access headers.
- Seed `setup_window_start` to `Date.now()` (within window).
- `POST /setup` with form fields: `display_name`, `headline`, `cv_markdown` (200+ chars), `anthropic_api_key`, `daily_budget_usd`, `admin_password` (12+ chars valid value). Assert response status `200`.
- Extract `Set-Cookie` header from POST /setup response.
- `GET /admin` with the session cookie from the response. Assert status `200`.
- Verify `grep -n "cf-access-jwt-assertion" src/routes/setup.ts` shows no unconditional 403 path.

## Implementation Notes

**Brainstorming survival:** Three approaches were evaluated. Approach C (full password-bootstrap with optional JWT) survived because: (a) Approach A (JWT removal only) omits the required `admin_password` field; (b) Approach B (state machine refactor only) is insufficient since setup.ts bypasses `detectState`. The selected approach mirrors the existing dual-layer pattern in `access.ts:103-142`.

**Critical parseStoredConfig risk (confidence 0.78):** The adversarial check identified that `parseStoredConfig` currently rejects configs where `access_email` is not a non-empty string. If this is not updated, any admin config read after a no-JWT setup will fail silently, causing `GET /admin` to return an error even if `POST /setup` returned `200`. The spec requires removing `access_email/aud/team_domain` from the required `stringFields` array in `parseStoredConfig` as a **non-negotiable** part of this change.

**State machine adversarial finding:** `machine.ts:109-131` returns `access_denied` when config exists and JWT is absent. Admin tests already confirm the worker routes admin through `requireAdminAuth` directly. The state machine fix (making access_email optional in the match) is still required for correctness — without it, the state machine would incorrectly signal `access_denied` for every request after a no-JWT setup, even if worker.ts ignores it for admin routes.

**Session cookie on POST /setup success:** The acceptance criterion "GET /admin with the resulting session cookie" requires POST /setup to return a `Set-Cookie` header. Call `createSessionCookie(env.STATE)` in the success path to initialize `cookie_signing_secret` and mint the first session.

**README.md gap (confidence 0.70):** README.md was not read during investigation. The sprint executor must read the current README.md setup section before editing to avoid destroying existing valid content. The criterion is that CF Access is NOT listed as a required prerequisite step.

**ANTHROPIC_BASE_URL test mocking:** The existing tests use `ANTHROPIC_BASE_URL` to intercept Anthropic API calls. The new integration test must also mock the Anthropic call in POST /setup (step 5: api key test call) or pre-stub the `ANTHROPIC_BASE_URL` env var, else the test will fail on live network call.

**Hard constraints respected:** No Anthropic key in HTML (existing code already omits it); bcrypt cost 12 (existing `hashPassword` uses `saltRounds = 12`); admin session requires password login not removed; `GET /` and `POST /chat` remain unauthenticated; CF JWT verification remains optional (the fix makes it so).

## Verification Criteria

### Criterion 1: New integration test passes
- Command: `pnpm test src/__tests__/integration/setup-without-cf.test.ts`
- Expected: 0 failures, test asserts `200` on both `POST /setup` and `GET /admin`
- Falsifier: test fails because JWT is still required or parseStoredConfig rejects the stored config

### Criterion 2: No unconditional JWT 403 in setup.ts
- Command: `grep -n "missing cf-access-jwt-assertion" src/routes/setup.ts`
- Expected: zero matches, OR matches only inside conditional blocks (not at top-level of handler before any other logic)
- Falsifier: grep returns a match at lines 63-66 or 212-215 (original locations)

### Criterion 3: README.md does not require CF Access as a prerequisite
- Check: README.md setup section must not list CF Access policy as a step 1 or required step
- Falsifier: the word "required" or "prerequisite" appears adjacent to "Cloudflare Access" in the setup section

### Criterion 4: Full test suite passes
- Command: `pnpm test`
- Expected: all pre-existing tests pass plus the new integration test
- Falsifier: regression in `src/test/admin.test.ts` or `src/test/smoke.test.ts` caused by StoredConfig type or parseStoredConfig changes