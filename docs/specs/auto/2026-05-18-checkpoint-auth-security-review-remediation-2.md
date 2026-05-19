## Problem Statement

Three operator-reported auth UX bugs prevent returning visitors from authenticating and provide misleading success signals after setup.

## Current Behavior

1. `src/auth/access.ts:93` — `requireAdminAuth` returns bare `"Login required"` text (401) when no session cookie is present. Called by all admin routes and the GET / handler in bootstrap state.
2. `src/routes/setup.ts:232-236` — POST /setup success issues 303 redirect to `adminUrl` (constructed as `{host}/admin`), not to `/`.
3. `src/worker.ts` — no GET /login or POST /login routes are registered; login is only available at POST /admin/login which redirects to /admin.
4. GET / in the bootstrap state (admin_password_hash in KV, no config, no session) emits "Login required" with no form UI.

## Proposed Changes

### S1 — Fix POST /setup success redirect (`src/routes/setup.ts`)
Lines 231-239: Replace the `adminUrl` construction and `"Location": adminUrl` header with `"Location": "/"`. The session cookie must still be set.

### S2 — Render login form at GET / in bootstrap state (`src/routes/index.ts`)
In `handleRoot`: when `admin_password_hash` exists in KV and the session cookie is absent/invalid (and config does not yet exist), respond 200 with login form HTML containing `<input type="password" name="admin_password">` and `<form method="POST" action="/login">`. When config exists, render the chat page unconditionally (existing behavior — hard constraint respected).

### S3 — New POST /login route (`src/routes/login.ts`)
New file. Handler reads `admin_password` from form body, reads `admin_password_hash` from KV, runs constant-time bcrypt compare (reuse `src/auth/password.ts` verify function). On success: call `createSessionCookie(env.STATE)`, respond 303 with `Location: /` and `Set-Cookie` header. On failure: render login form with error message. On missing hash: 404.

Emit `auth_decision` structured log entry on every attempt (satisfies guardrail GR-1779073792350-fkco).

### S4 — New login form view (`src/views/login-form.ts`)
New file. Exports `renderLoginForm(opts?: { error?: string })` returning styled HTML using existing layout/design tokens. Must contain `<input type="password" name="admin_password">`.

### S5 — Wire routes in `src/worker.ts`
Add `import { handleGetLogin, handlePostLogin } from "./routes/login"`.
Add route entries for `GET /login` and `POST /login` before the 404 fallback.

### S6 — Replace bare "Login required" in `src/auth/access.ts:93`
Change `return new Response("Login required", { status: 401 })` to `return Response.redirect("/login", 303)`. This ensures admin routes redirect instead of emitting bare text.

### S7 — Integration test (`src/__tests__/integration/login-flow.test.ts`)
New test file with three cases:
- Unauthenticated GET / with admin_password_hash pre-set → 200 + HTML contains `<input type="password" name="admin_password">`
- POST /login with correct password → 303 + `Location: /`
- GET / with session cookie from step 2 → 200 + chat-UI markers

Also: assert existing setup test redirects to `/` not `/admin`.

## Implementation Notes

**Residual gap — GET / bootstrap state (0.72 confidence)**: The exact code path in `src/routes/index.ts` that produces "Login required" in bootstrap state was not directly read. The executor must read `handleRoot` fully and locate where the auth check occurs. If handleRoot does NOT currently produce "Login required", the executor must add the bootstrap-state check explicitly.

**Residual gap — test suite green (0.75 confidence)**: Existing tests in `src/test/admin.test.ts` and `src/test/smoke.test.ts` may assert redirect to /admin after setup. Those must be updated to assert `/` instead.

**Adversarial check — POST /login**: Always read `admin_password_hash` fresh from KV on each POST /login call — never cache it in module scope to prevent stale-hash attacks.

**Session cookie path**: `src/auth/session.ts` currently sets `Path=/admin`. This is correct for admin route protection. No change needed.

**Auth decision logging**: POST /login must emit `{ event: "auth_decision", outcome: "success"|"fail", route: "/login" }` to satisfy guardrail GR-1779073792350-fkco.

**HARD CONSTRAINT — NO SKIP**: S1 (setup.ts redirect) and S6 (access.ts login-required text) must both execute. Planner confirmation that the /admin redirect exists at src/routes/setup.ts:236 verified via file read.

## Verification Criteria

| Criterion | Verification |
|-----------|-------------|
| POST /setup redirects to / | `grep -n '"/admin"' src/routes/setup.ts` exits 1 (zero matches on the success redirect) |
| Login form at GET / | Integration test step 1: `GET /` → 200 + `<input type="password" name="admin_password">` |
| POST /login → 303 / | Integration test step 2: `POST /login` correct password → 303 `Location: /` |
| Session cookie works | Integration test step 3: `GET /` with cookie → 200 + chat markers |
| No bare "Login required" | `grep -rn '"Login required"' src/` returns empty or only inside login form route |
| pnpm test green | `pnpm test` exits 0 |
| pnpm build + lint clean | `pnpm build && pnpm lint` exits 0 |