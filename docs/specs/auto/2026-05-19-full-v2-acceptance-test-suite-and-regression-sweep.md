## Problem Statement

Attempts 1 and 2 failed because 3 duplicate acceptance test files added in attempt 1 were never removed. These duplicates (`admin-404-unconfigured.test.ts`, `chat-503-not-configured.test.ts`, `kv-and-spend-failure.test.ts`) cause `fetchMock` global singleton interference in vitest's `singleWorker: true` mode. The newer files run alphabetically first and leave mock state corrupted, causing downstream test failures in the original files.

## Current Behavior

`src/__tests__/acceptance/` contains 11 files — 3 are duplicates of originals added during attempt 1:

- `kv-and-spend-failure.test.ts` runs before `test-kv-failure.test.ts` alphabetically; both call `fetchMock.activate()` against the same module-level singleton, corrupting mock state in the second file.
- `kv-and-spend-failure.test.ts` has 2 `it()` blocks that each register intercepts inside the test body against the same pool object — undrained intercept queues between `it()` blocks cause "no matching intercept" errors.
- `admin-404-unconfigured.test.ts` is functionally identical to `test10-admin-unconfigured.test.ts` (same KV ops, different describe string only).
- `chat-503-not-configured.test.ts` is functionally equivalent to `test-chat-not-configured.test.ts` (different IP address only).
- All 7 structural done_when criteria are confirmed met (files exist, regex patterns match).
- `docs/checkpoints/v2-acceptance-report.md` lists 8 acceptance files but 11 now exist — count is stale.
- `pnpm test` fails due to fetchMock singleton interference from duplicate files.

## Proposed Changes

### Deletions (3 files):

1. Delete `src/__tests__/acceptance/admin-404-unconfigured.test.ts` — functionally identical to `test10-admin-unconfigured.test.ts`; no unique test coverage.

2. Delete `src/__tests__/acceptance/chat-503-not-configured.test.ts` — functionally equivalent to `test-chat-not-configured.test.ts`; IP address differs only.

3. Delete `src/__tests__/acceptance/kv-and-spend-failure.test.ts` — duplicates KV failure coverage from `test-kv-failure.test.ts`; unique content is a spend-tracking failure `it()` block.

### Conditional addition (1 test case):

4. Port spend-tracking failure `it()` block from `kv-and-spend-failure.test.ts` into `test-kv-failure.test.ts` ONLY if `grep -Pi 'spend[\s\S]{0,80}(fail|reject|throw)' src/__tests__/acceptance/test-kv-failure.test.ts` returns no match. The ported `it()` must reuse the existing `beforeEach`/`afterEach` lifecycle — no new `fetchMock.activate()` call inside the ported block.

### Documentation update (1 file):

5. Update `docs/checkpoints/v2-acceptance-report.md` with the actual test count from the live `pnpm test` output.

### No changes to:
- `wrangler.toml` (already clean)
- Any non-duplicate acceptance test files
- `docs/SPEC_CORRECTIONS.md` (valid stub)

## Implementation Notes

**Pre-deletion regex guard (mandatory before deleting kv-and-spend-failure.test.ts):**
Run `grep -rPil 'kv.{0,40}put.{0,80}(fail|reject|throw)|spend.{0,80}(fail|reject|throw)' src/__tests__` and confirm `test-kv-failure.test.ts` covers both the kv part and the spend part. If only the kv part matches, port the spend failure `it()` block first.

**fetchMock porting rule:** The ported spend failure `it()` block must NOT add a new `fetchMock.activate()` call. The parent `describe()` in `test-kv-failure.test.ts` already handles activate/deactivate in beforeEach/afterEach.

**Adversarial guard:** "How could criterion 9 pass while the goal actually fails?" — A comment or describe-string containing 'spend' + 'throw' could satisfy the grep pattern without testing real spend failure. Guard: the ported `it()` block must make an actual HTTP call to POST /chat and assert the response does not throw an unhandled error.

**Root cause confirmed:** Diagnostic analysis shows `kv-and-spend-failure.test.ts` + `test-kv-failure.test.ts` both calling `fetchMock.activate()` on the same singleton in a `singleWorker: true` environment. Removing duplicates restores the known-good 214-test baseline state.

## Verification Criteria

- pnpm test: Exit 0, >=214 passing, 0 failing
- pnpm build: Exit 0
- pnpm typecheck: Exit 0
- pnpm lint: Exit 0
- test -f docs/SPEC_CORRECTIONS.md: Exit 0
- test -f docs/checkpoints/v2-acceptance-report.md: Exit 0, updated with live count
- grep -rEi 'test[-_ ]?20|forgot[-_ ]?password' src/__tests__ -l: >=1 file (test20-forgot-password.test.ts)
- grep for /chat 503 not-configured pattern: test-chat-not-configured.test.ts satisfies
- grep for kv/spend failure pattern: test-kv-failure.test.ts satisfies after optional port
- grep for /admin 404 unconfigured pattern: test10-admin-unconfigured.test.ts satisfies
- wrangler.toml clean of MOCK_/TEST_/ANTHROPIC_MOCK/MSW_ vars