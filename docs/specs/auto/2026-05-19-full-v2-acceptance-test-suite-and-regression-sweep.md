## Problem Statement

Goal G8 requires all 20 spec-v2.md acceptance tests to pass under vitest with miniflare KV and mocked Anthropic, plus an acceptance report. The current test suite covers Tests 6, 7, 8, 9, and 12 in dedicated acceptance files, but Tests 1–5, 10–11, 13–20 either exist only within broader route/integration tests or are completely absent. Specifically: Test 20 (admin forgot-password inline instructions) has no file, the /chat 503 "not configured" error path has no explicit acceptance assertion, the KV-put-failure and spend-tracking-failure paths have no explicit acceptance probes, and /admin returning 404 when unconfigured has no dedicated assertion. Additionally, `docs/checkpoints/v2-acceptance-report.md` does not exist.

## Current Behavior

- 214 tests pass across ~35 test files in `src/test/`, `src/auth/`, and `src/__tests__/`.
- `src/__tests__/acceptance/` contains 4 files: `test7-rate-limit.test.ts`, `test8-budget.test.ts`, `test9-bot-ua.test.ts`, `test12-anthropic-failure.test.ts`.
- `src/__tests__/chat/acceptance-test-6.test.ts` covers Test 6.
- `src/__tests__/setup/setup-acceptance.test.ts` covers setup flow tests.
- No file in `src/__tests__/` matches the regex `test[-_ ]?20|forgot[-_ ]?password`.
- No file matches `/\/chat[\s\S]{0,200}503[\s\S]{0,200}not[-_ ]?configured/`.
- No file matches `/kv[\s\S]{0,40}put[\s\S]{0,80}(fail|reject|throw)/i` at the HTTP acceptance layer.
- No file matches `/\/admin[\s\S]{0,200}404[\s\S]{0,200}unconfigured/`.
- `docs/SPEC_CORRECTIONS.md` exists as a stub.
- `docs/checkpoints/v2-acceptance-report.md` does not exist.
- `wrangler.toml` is clean of MOCK_/TEST_/ANTHROPIC_MOCK/MSW_ vars.

## Proposed Changes

### New test files (4 files in `src/__tests__/acceptance/`):

1. **`src/__tests__/acceptance/test20-forgot-password.test.ts`** — Tests that the admin forgot-password/recovery path returns full inline instructions in HTML. Must hit the running worker via HTTP and match regex `/test[-_ ]?20|forgot[-_ ]?password/i`.

2. **`src/__tests__/acceptance/test-chat-not-configured.test.ts`** — Tests that `POST /chat` returns HTTP 503 with JSON body containing `"error": "not configured"` when no Anthropic API key is configured in KV.

3. **`src/__tests__/acceptance/test-kv-failure.test.ts`** — Tests that KV put failures (mocked via STATE.put throwing) and spend-tracking failures are handled gracefully. Test source must contain kv+put+fail/reject/throw or spend+fail/reject/throw pattern.

4. **`src/__tests__/acceptance/test-admin-unconfigured.test.ts`** — Tests that `GET /admin` returns HTTP 404 (or redirect to setup) when the worker is unconfigured (no config in KV).

### New documentation:

5. **`docs/checkpoints/v2-acceptance-report.md`** — One-page acceptance report listing Test 1–20 pass/fail, total test count, SPEC_CORRECTIONS filings (none), and F9 mobile keyboard as human-smoke required.

### No changes to:
- `wrangler.toml` (already clean of MOCK_ vars)
- Existing test files (to preserve 214 baseline)
- `docs/SPEC_CORRECTIONS.md` (already exists as stub)

## Implementation Notes

**Pre-authoring checks required:** Before writing each new test, grep `src/__tests__/` for the target regex patterns to confirm they are genuinely absent. This prevents authoring duplicate assertions.

**Miniflare setup pattern:** Follow `test7-rate-limit.test.ts` as the template — use `env.STATE` for KV operations, mock fetch for Anthropic calls. Do not introduce MOCK_ environment variables into `wrangler.toml`. Any test-only bindings must be injected via vitest miniflare config in `vitest.config.ts`.

**Test 20 specifics:** Fetch `GET /admin/login` with no session, assert the HTML contains the forgot-password recovery instruction block with inline wrangler commands. No docs/ path links should appear in error-page anchors.

**KV failure test specifics:** Mock `env.STATE.put` to throw. Assert that `POST /chat` returns a well-formed error response. Adversarial guard: the test must make a real HTTP call to `/chat`, not merely unit-test kv.put in isolation.

**Acceptance report authoring:** Run `pnpm test` after Sprint 1, map each Test 1–20 to pass/fail in the report. F9 (mobile keyboard) is flagged as unverifiable in headless environment — human smoke test required.

**Confidence flags (7 criteria below 0.85):** Criteria 1-4 (pnpm commands) flagged because new miniflare tests must properly set up KV state. Criteria 8/9/10 flagged — implementer must grep before authoring to avoid comment-only matches that satisfy the regex but don't represent real test logic.

**Brainstorming decision:** Approach A (targeted gap-fill) selected over Approach B (consolidated file) and Approach C (reorganize). Approach B fails because existing test7-12 files would cause duplication conflicts. Approach C has high regression risk from file moves.

## Verification Criteria

| Done-When | Verification |
|-----------|-------------|
| `pnpm test` | Run `pnpm test` and confirm exit code 0, ≥214 tests passing |
| `pnpm build` | Run `pnpm build` and confirm exit code 0 |
| `pnpm typecheck` | Run `pnpm typecheck` and confirm exit code 0 |
| `pnpm lint` | Run `pnpm lint` and confirm exit code 0 |
| `fs:exists docs/SPEC_CORRECTIONS.md` | `test -f docs/SPEC_CORRECTIONS.md` |
| `fs:exists docs/checkpoints/v2-acceptance-report.md` | `test -f docs/checkpoints/v2-acceptance-report.md` |
| Test 20 regex | `grep -rEi 'test[-_ ]?20|forgot[-_ ]?password' src/__tests__ -l` returns ≥1 file |
| /chat 503 regex | `grep -rPl '/chat.{0,200}503.{0,200}not.configured' src/__tests__` returns ≥1 file |
| KV/spend failure regex | `grep -rPil 'kv.{0,40}put.{0,80}(fail|reject|throw)|spend.{0,80}(fail|reject|throw)' src/__tests__` returns ≥1 file |
| /admin 404 unconfigured | `grep -rPl '/admin.{0,200}404.{0,200}unconfigured' src/__tests__` returns ≥1 file |
| wrangler.toml clean | `! grep -E '\b(MOCK_|TEST_|ANTHROPIC_MOCK|MOCK_ANTHROPIC|MSW_)\b' wrangler.toml` exits 0 |