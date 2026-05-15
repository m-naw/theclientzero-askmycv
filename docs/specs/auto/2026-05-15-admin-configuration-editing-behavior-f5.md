## Problem Statement

The admin routes are implemented and tested, but the iteration evaluator reported iteration_failure after two sprints completed (both with totalFailed=0). The exact failure mode is not determinable from static analysis. Attempt 2 must explicitly run `pnpm build`, `pnpm typecheck`, and `pnpm test`, diagnose any failures, and fix them to achieve green CI with all 13 done_when criteria covered.

## Current Behavior

**Implemented and structurally correct (verified by reading workspace files):**
- `src/routes/admin.ts` — `handleAdminGet` (5-check identity gate → renderAdminForm) and `handleAdminSave` (identity gate → form parse → optional Anthropic key validation → KV merge)
- `src/auth/identity.ts` — `verifyOwnerIdentity` returning discriminated union with all 5 denial reasons (no_jwt, signature_invalid, team_domain_mismatch, aud_mismatch, email_mismatch) in correct order
- `src/worker.ts` — dispatches GET /admin → handleAdminGet and POST /admin/save → handleAdminSave; old JSON stub removed
- `src/__tests__/admin/admin.test.ts` — GET/admin Tests 1-6, POST/admin/save Tests 7-12, AT10 (lines 476-551), AT11 (lines 554-628); 14 tests total
- `src/test/admin.test.ts` — GET/admin 5-test subset added in sprint-1
- `src/test/smoke.test.ts` — updated by followup sprint: seeds config + JWKS in KV, checks HTML 200 with 'name="cv_markdown"'

**Unknown:** Whether `pnpm build`, `pnpm typecheck`, and `pnpm test` currently exit 0. The iteration_failure after sprint completion means at least one of these is failing at evaluation time.

## Proposed Changes

**Sprint: Verify + Fix to green CI.**

The sprint executor must:

1. Run `pnpm build` and fix any compilation errors.

2. Run `pnpm typecheck` and fix any TypeScript errors. Key risk areas:
   - `src/__tests__/admin/admin.test.ts` uses `opts: { body?: string }` callback pattern — same as adjacent test files; confirm accepted or update.
   - Import paths in `src/test/admin.test.ts` — confirm `../routes/jwks-source` and `../test-utils/jwt-harness` resolve correctly.

3. Run `pnpm test` and fix any failing tests. Key risk areas:
   - **AT11 KV isolation**: AT11 calls POST /chat which writes `spend:<date>` to KV; `clearKv()` only deletes config/setup_window_start/__test_jwks — spend accumulation from prior chat-abuse tests could cause AT11's POST /chat to return 503 if total spend >= daily_budget_usd. Fix: add spend-key deletion to AT11's beforeEach/afterEach or to a shared clearKv helper.
   - **Criterion 8 gap**: No test explicitly asserts the new headline value appears in KV after POST /admin/save. Test 7 checks anthropic_api_key preserved but not headline updated. Add: `expect(stored.headline).toBe("Updated headline · Berlin")`.
   - **KV snapshot for criterion 7**: Test 10 (POST /admin/save no JWT → 403) checks status and body but NOT KV unchanged. Add explicit KV snapshot: read before POST, assert byte-identical after.
   - **Test count**: Confirm `pnpm test` reports >= G6 baseline + new admin test count.

4. Fix implementations if tests reveal bugs; fix tests if the tests themselves are wrong.

## Implementation Notes

**AT11 spend key cleanup**: In `src/__tests__/admin/admin.test.ts` AT11's beforeEach, add:
```ts
const today = new Date().toISOString().slice(0, 10);
await getEnv().STATE.delete(`spend:${today}`);
```
or include spend key in the shared `clearKv()` helper for this describe block.

**Headline update assertion**: In Test 7 of POST /admin/save, after `expect(stored.anthropic_api_key).toBe("sk-ant-existing-key")`, add `expect(stored.headline).toBe("Updated headline · Berlin")` to satisfy done_when criterion 8 explicitly.

**KV snapshot for criterion 7**: In Test 10 (no JWT → 403), add:
```ts
const kvBefore = await getEnv().STATE.get("config");
const res = await runFetch(adminSaveRequest(null, validSaveBody()));
expect(res.status).toBe(403);
expect(await getEnv().STATE.get("config")).toBe(kvBefore);
```

**Pre-registered falsifier**: `pnpm test` exit code non-zero, OR any test containing "FAIL" in its description, OR test count < G6 baseline + new admin tests.

**Adversarial guard**: If AT11 POST /chat returns 503 instead of 200 and `captured.body` is null, the systemText assertions will fail on `expect(systemText).toContain("Brand new role at Acme")`. This is the primary AT11 failure mode — budget pollution from prior tests.

## Verification Criteria

All 13 done_when criteria verified by passing tests:

| Done When | Test | Verification |
|---|---|---|
| GET /admin no header → 403 | admin.test.ts Test 1 | status 403 + body.toContain("no_jwt") |
| bad signature → 403 + signature_invalid | Test 2 | status 403 + body.toContain("signature_invalid") |
| email mismatch → 403 + 'email' | Test 5 | status 403 + body.toContain("email_mismatch") (contains "email") |
| aud mismatch → 403 + 'aud' | Test 4 | status 403 + body.toContain("aud_mismatch") (contains "aud") |
| team_domain mismatch → 403 | Test 3 | status 403 |
| match → 200 HTML with config values | Test 6 | status 200 + cv_markdown field + display_name + headline |
| POST save no JWT → 403 + KV unchanged | Test 10 + KV snapshot | status 403 + kvBefore === kvAfter |
| POST save match + headline → 200 + KV updated | Test 7 + headline assertion | status 200 + stored.headline === new value |
| empty key → key preserved | Test 7 | stored.anthropic_api_key === original |
| bad key → 400 + KV unchanged + shape | Test 9 | status 400 + capturedReqBody has model/system/messages/max_tokens |
| cv_markdown propagation | AT11 | systemText contains new CV, not old |
| AT10 + AT11 as formal tests | Lines 476-628 | both describe blocks pass |
| pnpm build + typecheck + test exit 0 | CI commands | all exit 0; count >= baseline + new tests |