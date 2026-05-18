## Problem Statement

The admin and setup routes currently require a valid Cloudflare Access JWT on every request, making the application unusable without a CF Access tunnel. Password-primary authentication with optional CF Access as a progressive enhancement is needed to support self-hosted deployments without mandatory CF infrastructure. Additional admin panel safety features (Danger Zone reset, password change) and a tightened setup window (600 s instead of 30 min) are required.

## Current Behavior

- `src/auth/access.ts`: JWT verification is mandatory; 403 if header missing.
- `src/routes/admin.ts`: `handleAdminGet` and `handleAdminSave` call `verifyAccessJwt` and return 403 on failure. No `/admin/login` route. No session cookie issued.
- `src/routes/setup.ts`: JWT verification mandatory; 30-minute window (`SETUP_WINDOW_MS = 30 * 60 * 1_000` in `src/state/machine.ts`). No admin_password field handling.
- `src/types/config.ts`: `admin_password_hash` is typed as `optional string` but not written anywhere. `cookie_signing_secret` not present in the type.
- `src/abuse/rate-limit.ts`: Per-IP hourly rate-limit exists for `/chat` but not for `/admin/login`.
- `src/views/admin-form.ts`: No Danger Zone section, no sign-out, no password-change fields, no theme switcher.
- `src/test/admin.test.ts`: Tests require JWT. No `src/__tests__/` directory.
- No `docs/specs/auth-surface.md`. No `scripts/check-contract-parity.mjs`.

## Proposed Changes

### Sprint 1 — Auth Core

**package.json**: Add `bcryptjs` and `@types/bcryptjs` to dependencies.

**src/auth/password.ts** (new): Export `hashPassword(plain: string): Promise<string>` using bcryptjs with `saltRounds = 12`. Export `verifyPassword(plain: string, hash: string): Promise<boolean>`.

**src/auth/session.ts** (new): Export `signSession(payload: string, secret: string): Promise<string>` using HMAC-SHA256 (Web Crypto `crypto.subtle.sign('HMAC', ...)` with SHA-256 digest). Export `verifySession(token: string, secret: string): Promise<boolean>`. Cookie name constant `SESSION_COOKIE = 'askmycv_admin_session'`. Cookie builder returns `Set-Cookie` header string with attributes: `HttpOnly; Secure; SameSite=Lax; Path=/admin; Max-Age=604800`.

**src/types/config.ts**: Add `cookie_signing_secret?: string` to `StoredConfig`. Ensure `admin_password_hash?: string` is present (already typed, no change needed).

**src/state/machine.ts**: Change `SETUP_WINDOW_MS` from `30 * 60 * 1_000` to `600_000`. Render absolute UTC expiry timestamp where the expiry is displayed.

**src/routes/admin.ts**: 
- Add `POST /admin/login` handler: (1) Check per-IP rate limit via `checkAndIncrement` with prefix `loginratelimit:` and limit=10; return 429 if exceeded. (2) Parse `admin_password` from form body. (3) Load `admin_password_hash` from KV. (4) Call `verifyPassword`; on mismatch apply `await new Promise(r => setTimeout(r, 500))` then return 401. (5) On success: generate HMAC-signed session token, issue `Set-Cookie: askmycv_admin_session=...` with HttpOnly, Secure, SameSite=Lax, redirect to GET /admin.
- Add `POST /admin/reset` handler: verify session cookie; require `confirm === 'DELETE ALL CONFIG'` in body (HTTP 400 if not); delete KV keys `config`, `secrets`, `admin_password_hash`, `cookie_signing_secret`; return Set-Cookie clearing the session.
- Update `handleAdminGet` and `handleAdminSave`: primary auth via session cookie (verify HMAC signature + expiry); if `config.access_email` is non-empty, additionally require valid `cf-access-jwt-assertion` header (HTTP 403 if missing); no longer mandatory-JWT-only.

**src/worker.ts**: Add routes for `POST /admin/login` and `POST /admin/reset`.

**src/__tests__/admin/admin-session.test.ts** (new): Test session-cookie-only admin access (no JWT required when `access_email` is empty). Test that wrong-password returns 401. Test 11th attempt returns 429. Test session cookie attributes.

**src/routes/setup.ts**: Ensure `public_url` and `admin_url` are assigned adjacently in the success response (within 400 chars of each other in the source file).

### Sprint 2 — Admin UX + Safety + Artifacts

**src/views/admin-form.ts**: Add (a) theme switcher field, (b) sign-out button (POST /admin/logout or link), (c) current_admin_password + new_admin_password + confirm_new_admin_password fields for password change, (d) **Danger Zone** section heading followed by Reset all configuration button that submits to `/admin/reset` with `confirm=DELETE ALL CONFIG`.

**src/routes/admin.ts** (admin save extension): If `new_admin_password` is non-empty in the form, require `current_admin_password` to verify against stored hash before writing new hash.

**src/views/admin-form.ts**: Theme switcher renders `<select name="theme">` with options.

**src/routes/setup.ts**: Body size guard — if `request.headers.get('content-length')` > `100 * 1024`, return HTTP 413 before parsing.

**docs/specs/auth-surface.md** (new): Documents all KV keys used for auth: `admin_password_hash` (bcrypt hash, cost≥12), `cookie_signing_secret` (32-byte random hex, used for HMAC-SHA256 session signing), `askmycv_admin_session` cookie, rate-limit key schema, and dual-layer auth flow.

**scripts/check-contract-parity.mjs** (new): (a) Extract all `name="<field>"` from `src/views/setup-form.ts` and `src/views/admin-form.ts`. (b) Extract all field reads from `src/routes/setup.ts` and `src/routes/admin.ts` (regex: `formData\.get\(['"](\w+)['"]\)` and `body\.(\w+)`). (c) Compare both sets against a declared required-fields list. (d) `process.exit(0)` iff all required fields appear in BOTH HTML renders and handlers; `process.exit(1)` with diff otherwise.

**src/__tests__/setup/setup-acceptance.test.ts** (new): Test that `setup_window_start` written more than 5000ms (5 s) but within 600 s allows setup, and that elapsed window (> 600 s) returns 403.

**src** (guard): Remove any `console.log` calls that include `anthropic_api_key`, `admin_password`, `cookie_signing_secret`, or `admin_password_hash` in the argument string.

## Implementation Notes

**Approach chosen**: Thin new modules (`src/auth/password.ts`, `src/auth/session.ts`) rather than inline expansion of admin.ts or a middleware pipeline. This keeps JWT tests undisturbed and follows the existing modular pattern in `src/auth/`.

**CRITICAL — Criterion 20 guard**: The done_when regex `/50_?000[\s\S]{0,80}cv_?markdown/` requires the literal `50_000` to appear within 80 characters of `cv_markdown` in source. Using only the named constant `CV_MAX_LENGTH` will FAIL this check. The implementation MUST write `50_000` inline near the cv_markdown validation: e.g., `if (cv_markdown.length > 50_000)` not `if (cv_markdown.length > CV_MAX_LENGTH)`.

**CRITICAL — Test directory**: Done_when criteria 12 and 19 reference `src/__tests__/` which does not currently exist. Tests for session-cookie admin auth and setup_window_start MUST be written in `src/__tests__/admin/` and `src/__tests__/setup/` respectively. The existing `src/test/` tests remain untouched.

**CRITICAL — setTimeout regex**: The 500ms delay regex `/(?:setTimeout|setT|delay|sleep).*(?:4[5-9]\d|[5-9]\d{2})/` matches 450–499 or 500–999. A literal `setTimeout(r, 500)` matches `[5-9]\d{2}` via `5\d\d`. Use exactly `500` as the delay value.

**bcryptjs**: Pure-JS library, confirmed compatible with Cloudflare Workers V8 isolate. argon2 (native) is not usable in Workers. bcryptjs with `saltRounds = 12` satisfies cost≥12 constraint.

**HMAC-SHA256**: Use Web Crypto `crypto.subtle` with `HMAC` + `SHA-256`. This is available natively in Cloudflare Workers without node:crypto. Alternatively `createHmac('sha256', ...)` via a compatible polyfill. Pattern: `crypto.subtle.importKey → crypto.subtle.sign('HMAC', key, data)`. The regex also matches `createHmac(['"']sha256` so either approach works.

**Hard constraints respected**:
- GET / and POST /chat remain unauthenticated; no auth added.
- CF Access JWT verification remains auto-detected (non-empty `access_email`) and optional.
- admin_password plaintext never written to KV; only bcrypt hash persisted.
- No production mock vars in wrangler.toml.

**Prior retrospective risk**: The 60% historical failure rate signals implementation risk. Sprint 1 should include a complete passing test suite (no deferred tests) before Sprint 2 begins.

## Verification Criteria

See done_when list. Key commands after implementation:
- `node scripts/check-contract-parity.mjs` (exit 0)
- `pnpm typecheck` (0 errors)
- `pnpm lint` (0 errors)
- `pnpm test` (all pass, no regressions)
- `pnpm build` (0 errors)