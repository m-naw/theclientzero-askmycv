## Problem Statement

GET /admin and POST /admin/save are either missing or stub-only. The existing `handleAdmin` stub (worker.ts:21-43) returns JSON with only the JWT email — it never reads KV config, never performs identity comparison, and never renders the admin-form HTML. POST /admin/save has no handler at all. This goal wires both routes to their full behavior: strict identity verification against the KV-stored identity, HTML rendering of the admin-form template, and KV config update with optional Anthropic key rotation.

## Current Behavior

- `GET /admin`: dispatched to `handleAdmin` in `worker.ts:21-43`. Returns `{"email": "..."}` JSON on valid JWT; error JSON on failure. Never reads KV config. Never checks identity match. Never renders HTML.
- `POST /admin/save`: falls through to 404 — no handler registered in worker.ts.
- `src/routes/admin.ts`: does not exist.
- All view infrastructure is ready: `renderAdminForm` in `src/views/admin-form.ts`, `renderAccessDenied` in `src/views/error-pages.ts` with all five `AccessDenialReason` values.
- JWT harness is ready: `mintAccessJwt` + `createJwtHarness` in `src/test-utils/jwt-harness.ts`.

## Proposed Changes

### 1. Create `src/routes/admin.ts`

Exports two handlers and a shared identity guard:

**`checkAdminIdentity(token, env)`** — async helper returning `{ ok: true, identity, config }` or `{ ok: false, response: Response }`. Called by both handlers to ensure identical identity-check logic.

- If token absent → `{ ok: false, response: 403 HTML renderAccessDenied({ reason: "no_jwt" }) }`
- If `verifyAccessJwt` throws → `{ ok: false, response: 403 HTML renderAccessDenied({ reason: "signature_invalid" }) }`
- Read + parse config from KV.
- Compare `identity.team_domain` vs `config.access_team_domain` → `team_domain_mismatch`.
- Compare `identity.aud` vs `config.access_aud` → `aud_mismatch`.
- Compare `identity.email` vs `config.access_email` → `email_mismatch`.
- On full match → `{ ok: true, identity, config }`.

**`handleGetAdmin(request, env, _ctx)`** — calls `checkAdminIdentity`; on failure returns its response; on success returns 200 HTML `renderAdminForm({ prefill: cfg, email: identity.email })`.

**`handlePostAdminSave(request, env, _ctx)`** — calls `checkAdminIdentity`; on failure returns its response + KV untouched. Parses form body. Merges editable fields into a new config object; preserves `anthropic_api_key` from KV when submitted field is absent or empty after `.trim()`. If key non-empty: runs Anthropic test call (model, system, messages, max_tokens shape); on failure → 400 JSON `{ error: "anthropic_api_key rejected: ..." }` without writing KV. On success → `env.STATE.put("config", JSON.stringify(mergedConfig))` → 200 JSON `{ ok: true }`.

### 2. Update `src/worker.ts`

- Import `handleGetAdmin` and `handlePostAdminSave` from `./routes/admin`.
- Replace inline `handleAdmin` stub with dispatch to `handleGetAdmin`.
- Add dispatch for `POST /admin/save` to `handlePostAdminSave`.
- Remove the now-unused local `handleAdmin` function.

### 3. Create `src/test/admin.test.ts`

Covers all 13 done_when criteria. Uses: `fetchMock`, `createJwtHarness`, `mintAccessJwt`, `env.STATE`, `ANTHROPIC_BASE_URL` override. Every 403/400 that should leave KV unchanged takes a KV snapshot before the request and asserts byte-identical JSON after.

Test groups:
- GET /admin 403 cases (no_jwt, signature_invalid, email_mismatch, aud_mismatch, team_domain_mismatch)
- GET /admin 200 case (input fields pre-filled with config values)
- POST /admin/save 403 (no JWT; KV snapshot unchanged)
- POST /admin/save 200 (matching JWT + headline update → KV updated)
- POST /admin/save empty key (key preserved in KV)
- POST /admin/save bad key (400 + KV snapshot unchanged + Anthropic request body has model/system/messages/max_tokens)
- cv_markdown propagation (POST /admin/save new cv → POST /chat Anthropic system contains new content)
- Acceptance Test 10 (formal describe block, spec §12 steps 1–5)
- Acceptance Test 11 (formal describe block, spec §12 steps 1–3)

## Implementation Notes

**Shared identity guard**: `checkAdminIdentity` is a single function used by both handlers. This eliminates the risk of identity-check divergence between GET and POST.

**Check ordering**: team_domain → aud → email (most to least fundamental).

**KV snapshot assertions**: Every 403/400 test reads KV before request and asserts byte-identical after.

**Anthropic test call shape**: Must match setup.ts:131-144 shape: model `"claude-haiku-4-5-20251001"`, system `"You are a helpful assistant."`, messages `[{role:"user",content:"ping"}]`, max_tokens `1`.

**anthropic_api_key merge**: Only replace when `form.get("anthropic_api_key")?.trim()` is a non-empty string.

**cv_markdown propagation**: The chat handler reads config from KV on every request (no in-memory cache). After admin/save, next /chat automatically gets the new value.

**Pre-registered falsifier**: Any admin test failure, or pnpm test count below G6 baseline + new admin tests, fails the goal.

## Verification Criteria

See verificationCriteria section.