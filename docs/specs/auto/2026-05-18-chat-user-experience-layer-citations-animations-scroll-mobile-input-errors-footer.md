## Problem Statement

G5's goal-completion gate has failed in all four attempts with the same error: "contract conformance failed for artifact anthropic-messages-error." All prior workspace changes (creating the fixture, stripping extra fields, adding route imports) were misdiagnosed and irrelevant to the actual failure mechanism.

**Root cause confirmed** by reading the Strategos orchestrator source directly:

1. The gate (`goal-completion-gate-runner.ts:133-178`) calls `runContractConformanceForConsumer` for artifacts with `inject:"prompt"` (G5 consumes `anthropic-messages-error` with `inject:"prompt"` per `strategy.json:387`).
2. `real-shape-conformance.ts:141-153` checks that THREE fixture files exist and parse as valid JSON:
   - `references/fixtures/anthropic-credit-balance.json`
   - `references/fixtures/anthropic-invalid-key.json`
   - `references/fixtures/anthropic-rate-limited.json`
3. The gate reads from the **workspace path** `/tmp/strategos-workspaces/STR-64bdcbc6-40f5-4bde-a345-6fbb2a4a1eec/askmycv/` — NOT the git planning worktree.
4. The workspace `references/` directory contains ONLY `anthropic-messages-error.json`. The `fixtures/` subdirectory does not exist in the workspace. `ls /tmp/strategos-workspaces/.../askmycv/references/` confirms: `anthropic-messages-error.json` only.
5. The three fixture files DO exist in the git planning worktree at `~/.strategos/worktrees/.../6b0a54aff13098ed/references/fixtures/` with the correct schema — but this path is never read by the gate.

All prior fix attempts (stripping fields from `anthropic-messages-error.json`, adding route import) were irrelevant. `real-shape-conformance.ts:111-124` explicitly does NOT walk the artifact's own contents against the schema — it only validates that the artifact file exists and parses as JSON. The fixture files are the ONLY thing causing the failure.

## Current Behavior

**Missing in workspace** (confirmed by `ls`):
- `references/fixtures/` directory does not exist
- `references/fixtures/anthropic-credit-balance.json` — MISSING
- `references/fixtures/anthropic-invalid-key.json` — MISSING
- `references/fixtures/anthropic-rate-limited.json` — MISSING

**Correct content** (from planning worktree, matches `strategy.json:76-92` realShape schema `{"type":"string","error":"object"}`):

`anthropic-credit-balance.json`:
```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."
  }
}
```

`anthropic-invalid-key.json`:
```json
{
  "type": "error",
  "error": {
    "type": "authentication_error",
    "message": "invalid x-api-key"
  }
}
```

`anthropic-rate-limited.json`:
```json
{
  "type": "error",
  "error": {
    "type": "rate_limit_error",
    "message": "Number of request tokens has exceeded your per-minute rate limit (https://docs.anthropic.com/en/api/rate-limits); see the response headers for current usage information."
  }
}
```

**All other done_when criteria already satisfied** by commits 4fa603a through f57db75:
- `citation-badge` at `design-tokens.ts:218`
- `@keyframes` at `design-tokens.ts:230,234`
- `--typing-duration: 1.4s` at `design-tokens.ts:95`
- `prefers-reduced-motion` at `design-tokens.ts:276`
- `visualViewport` at `streaming.ts:225-228`, `100dvh` in design-tokens.ts
- `shiftKey` at `streaming.ts:185`
- `btn.disabled = true/false` at `streaming.ts:199,201`
- `MAINTAINER_GH_USERNAME`, `m-naw`, `TheClientZero` in `chat-page.ts`
- `role="log"`, `aria-live` in `chat-page.ts`
- `credit` at `chat.ts:214`
- `Section 7` in `LICENSE:666`
- `pnpm test`: 254/254 passing (confirmed)
- `pnpm build`: PASS (confirmed)
- `pnpm typecheck`: PASS (confirmed)

## Proposed Changes

### Fix: Create `references/fixtures/` directory with three fixture files

In the askmycv workspace at `/tmp/strategos-workspaces/STR-64bdcbc6-40f5-4bde-a345-6fbb2a4a1eec/askmycv/`, create:

**`references/fixtures/anthropic-credit-balance.json`** (exact content as shown above)

**`references/fixtures/anthropic-invalid-key.json`** (exact content as shown above)

**`references/fixtures/anthropic-rate-limited.json`** (exact content as shown above)

Commit these three files on the current `strategos/*` branch. The conformance check reads from this workspace path — once the files exist there and parse as valid JSON with `type` (string) and `error` (object), the gate passes (`real-shape-conformance.ts:75-103`, `walkSchema` at max depth 2, typeof check only).

**Do NOT modify** `references/anthropic-messages-error.json` — its content is irrelevant to the conformance check. The artifact file only needs to exist and be valid JSON (`real-shape-conformance.ts:111-124`).

**Do NOT modify** `src/routes/chat.ts` beyond what is already there — the conformance check does not inspect handler imports (`real-shape-conformance.ts` has no code path that reads TypeScript source files).

## Implementation Notes

**Why prior fixes failed:**
- `ea9b04d` (strip non-API fields): `real-shape-conformance.ts:111-124` does NOT check artifact content against schema — irrelevant
- `f57db75` (add route import): gate has no code path reading TS source — irrelevant
- Neither commit created `references/fixtures/` in the workspace

**Workspace vs worktree distinction**: The orchestrator's `workspace.ts:375` defines `DEFAULT_WORKSPACE_BASE='/tmp/strategos-workspaces'`. All implementation agents write to this path. The git planning worktree at `~/.strategos/worktrees/...` is used for spec/plan reading only. The conformance gate EXCLUSIVELY reads from the workspace path.

**Fixture shape requirement** (`strategy.json:76-92`, `real-shape-conformance.ts:75-103`):
- Top-level `type` field must be a string (typeof === 'string')
- Top-level `error` field must be an object (typeof === 'object')
- No other fields are validated by `walkSchema` at depth 1

**ADVERSARIAL GUARD**: "How could this fix pass while the goal actually fails?" — If the orchestrator workspace sync is broken and the workspace path is out of date from git, newly committed files might not appear at the path the gate reads. The sprint must verify file existence at the EXACT workspace path (`/tmp/strategos-workspaces/...`) after commit, not just confirm git commit succeeded.

**Confidence: 0.95** — evidence-bound score from:
- `real-shape-conformance.ts:141-153` (+0.25): gate fails on ENOENT for fixture files
- `strategy.json:76-92` (+0.15): exact fixture paths declared
- `ls` workspace confirms missing `fixtures/` (+0.10): direct evidence of gap
- Fixture content in worktree has correct schema (+0.10): content is known-good

## Verification Criteria

**Primary fix verification:**
1. `ls /tmp/strategos-workspaces/STR-64bdcbc6-40f5-4bde-a345-6fbb2a4a1eec/askmycv/references/fixtures/` shows all 3 files
2. `python3 -c "import json; [json.load(open(f'references/fixtures/{n}.json')) for n in ['anthropic-credit-balance','anthropic-invalid-key','anthropic-rate-limited']]; print('OK')"` exits 0
3. `python3 -c "import json; d=json.load(open('references/fixtures/anthropic-credit-balance.json')); assert isinstance(d.get('type'),str) and isinstance(d.get('error'),dict)"` exits 0

**All done_when structural criteria (already met by existing code):**
4. `grep -rn 'citation-badge' src/views/` exits 0
5. `grep -rn '@keyframes' src/views/` exits 0
6. `grep -rn '1\.4s\|typing.*duration' src/` exits 0
7. `grep -rn 'prefers-reduced-motion' src/views/` exits 0
8. `grep -rn 'visualViewport\|100dvh' src/views/` exits 0
9. `grep -rn 'shiftKey' src/views/` exits 0
10. `grep -rn 'MAINTAINER_GH_USERNAME' src/` exits 0
11. `grep -rn 'm-naw' src/views/` exits 0
12. `grep -rn 'TheClientZero' src/views/` exits 0
13. `grep -n 'Section 7' LICENSE` exits 0
14. `grep -n 'credit' src/routes/chat.ts` exits 0
15. `grep -rn 'role="log"\|aria-live' src/views/` exits 0
16. `grep -rn 'btn\.disabled' src/views/` exits 0
17. `pnpm test` exits 0 (254+ passing)
18. `pnpm build` exits 0
19. `pnpm typecheck` exits 0