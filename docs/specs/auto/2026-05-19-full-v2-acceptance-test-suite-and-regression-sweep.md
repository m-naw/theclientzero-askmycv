## Problem Statement

Goal G8 requires all 20 spec-v2.md acceptance tests to pass, all baseline tests to continue passing, and all quality gates (build/typecheck/lint) to be green. Prior attempt 1 committed all required test files and documentation, but the iteration was marked as failure because sprint failures occurred mid-execution. Attempt 2 must verify the current workspace state is actually green end-to-end and fix any remaining failures.

## Current Behavior

From workspace audit (commit 3f8a3f3):
- All 7 structural done_when criteria confirmed met: docs/SPEC_CORRECTIONS.md exists, docs/checkpoints/v2-acceptance-report.md exists, all 4 regex patterns matched in src/__tests__/, wrangler.toml is clean.
- src/__tests__/acceptance/ contains 11 files including test20-forgot-password.test.ts, chat-503-not-configured.test.ts, kv-and-spend-failure.test.ts, admin-404-unconfigured.test.ts (plus duplicates from fix iterations).
- src/routes/chat.ts:131 returns errorJson(503, "not configured") when config is null.
- src/routes/admin.ts:78-81 returns 404 "Not configured" when config is null.
- src/views/admin-login.ts is a new file added during attempt 1.
- Unknown: Whether pnpm test, pnpm build, pnpm typecheck, pnpm lint currently pass.

## Proposed Changes

No new test authoring required. All test files already exist. The work for attempt 2 is:

1. Run pnpm test — verify >=214 tests pass with zero failures. If any miniflare test fails, fix the failure (most likely: incorrect KV setup, wrong response shape assertion, or import errors in the duplicate test files).

2. Run pnpm build — verify worker bundle compiles. If it fails, fix the TypeScript error in src/views/admin-login.ts or whatever the new file introduced.

3. Run pnpm typecheck — verify no type errors.

4. Run pnpm lint — verify no lint errors in new test files.

5. Update docs/checkpoints/v2-acceptance-report.md with the actual test count from the live pnpm test run.

6. Deduplicate test files if needed: src/__tests__/acceptance/ has both chat-503-not-configured.test.ts AND test-chat-not-configured.test.ts, and both kv-and-spend-failure.test.ts AND test-kv-failure.test.ts. If these duplicates cause test failures or lint issues, remove the redundant ones.

## Implementation Notes

Do not re-author any test from scratch unless it is failing with a type/compile error that cannot be fixed by a small edit.

Response shape verification: src/routes/chat.ts:131 confirms the literal string is "not configured" (lowercase, space). The done_when regex uses not[-_ ]?configured which matches. src/routes/admin.ts:78-81 returns plain text "Not configured" (capitalized) with 404 — assertions in test files must match this casing.

Duplicate test files risk: Having two files asserting the same HTTP path could cause test interference in miniflare's single-worker mode (singleWorker: true in vitest.config.ts). If KV state bleeds between tests, fix by ensuring each test sets up its own KV state in beforeEach.

wrangler.toml is already clean — no action needed. docs/SPEC_CORRECTIONS.md is already a stub — no action needed unless a new shape deviation is discovered.

Hard constraints: No Anthropic API key in any HTML response or test output. No mock vars added to wrangler.toml [vars]. Test mocking stays in vitest miniflare config only.

Adversarial guard: The acceptance report was authored as a document (not generated from test output). Sprint implementer must run pnpm test with exit-code verification and update the report with the live passing count, not accept the authored version as evidence.

## Verification Criteria

- pnpm test: Exit 0, >=214 passing, 0 failing
- pnpm build: Exit 0
- pnpm typecheck: Exit 0
- pnpm lint: Exit 0
- test -f docs/SPEC_CORRECTIONS.md: Exit 0
- test -f docs/checkpoints/v2-acceptance-report.md: Exit 0
- grep -rEi 'test[-_ ]?20|forgot[-_ ]?password' src/__tests__ -l | grep -q .: >=1 file
- grep -rPl '/chat.{0,200}503.{0,200}not.configured' src/__tests__: >=1 file
- grep -rPil 'kv.{0,40}put.{0,80}(fail|reject|throw)|spend.{0,80}(fail|reject|throw)' src/__tests__: >=1 file
- grep -rPl '/admin.{0,200}404.{0,200}unconfigured' src/__tests__: >=1 file
- ! grep -E '\b(MOCK_|TEST_|ANTHROPIC_MOCK|MOCK_ANTHROPIC|MSW_)\b' wrangler.toml: Exit 0