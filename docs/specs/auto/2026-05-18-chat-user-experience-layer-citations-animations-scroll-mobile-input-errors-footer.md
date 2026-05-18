## Problem Statement

G5's implementation was completed in commit 4fa603a but the Attempt 1 goal-completion gate rejected it with: "contract conformance failed for artifact anthropic-messages-error — conformance check failed". All 254 project tests pass, all structural done_when grep criteria are satisfied by the existing code, but the `references/anthropic-messages-error.json` fixture contains non-API fields (`description`, `http_status`) that do not appear in Anthropic's actual HTTP response body — causing the orchestrator's realShape contract check to fail. Additionally, `pnpm build` and `pnpm typecheck` have not been verified since commit 4fa603a.

## Current Behavior

- `references/anthropic-messages-error.json` (sole file in references/) contains a decorated object with `description`, `http_status`, `type`, and `error` fields. The real Anthropic API error response body contains only `type` and `error` — the extra fields are developer annotations, not API output.
- `src/views/design-tokens.ts:218` — `citation-badge` CSS class present
- `src/views/design-tokens.ts:230,234` — `@keyframes typing-dot` and `bubble-enter` animations present
- `src/views/design-tokens.ts:95` — `--typing-duration: 1.4s` token present
- `src/views/design-tokens.ts:276` — `prefers-reduced-motion: reduce` media query present
- `src/views/design-tokens.ts` and `src/views/client/streaming.ts:225-228` — `100dvh` and `visualViewport` present
- `src/views/client/streaming.ts:185` — `shiftKey` check present
- `src/views/client/streaming.ts:199,201` — `btn.disabled = true/false` present (satisfies `btn` variant of done_when regex)
- `src/views/chat-page.ts` — `MAINTAINER_GH_USERNAME = "m-naw"`, `MAINTAINER_X_HANDLE = "TheClientZero"`, `role="log"`, `aria-live` present
- `src/routes/chat.ts:209-216` — credit-detection logic present
- `LICENSE:666` — Section 7(b) attribution clause present
- `pnpm test`: 254/254 passing

## Proposed Changes

### Fix 1: Correct `references/anthropic-messages-error.json` realShape

Replace the decorated content with the bare Anthropic API response body — only what Anthropic actually returns in the HTTP response body:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."
  }
}
```

Remove `description` and `http_status` fields — these are developer annotations, not part of the Anthropic API response body. The `http_status` of 400 is conveyed via the HTTP response status line, not the JSON body.

### Fix 2: Verify build and typecheck gates

Run `pnpm build` and `pnpm typecheck` in the workspace. If either fails, fix the TypeScript errors or build configuration issues before committing. These gates have not been verified since 4fa603a.

## Implementation Notes

**APPROACH SELECTION (brainstorm survivors):**

Three approaches were considered:
1. Artifact-fix-only: Fix only the JSON fixture, verify existing code. Survived — most evidence supports this.
2. Full re-implement: Rewrite all G5 features. Eliminated — 254 tests pass, code is in place.
3. Gap-fill: Audit each criterion, patch only missing items. Merged with approach 1 since no gaps were found beyond the artifact.

**ADVERSARIAL FINDING:** `scripts/check-contract-parity.mjs` (lines 1-238) validates form/route field parity only — it has no relationship to `references/anthropic-messages-error.json`. The artifact conformance failure is in the Strategos orchestrator's goal-completion gate, which validates realShape artifacts against the Anthropic API response schema. Removing `description` and `http_status` from the fixture aligns it with the raw API body that the orchestrator expects.

**CONFIDENCE FLAGS:**
- `pnpm build` (0.65): Not run post-4fa603a. Sprint must run and confirm.
- `pnpm typecheck` (0.65): Not run post-4fa603a. Sprint must run and confirm.
- artifact conformance fix (0.72): Orchestrator contract definition is not accessible from the workspace. The fix (remove non-API fields) is the highest-probability correction. If the gate still fails, the sprint must inspect orchestrator logs for the specific schema mismatch.

**ASSUMPTION:** The orchestrator's realShape contract for `anthropic-messages-error` expects a JSON object matching the Anthropic API error response body verbatim — i.e., `{type, error: {type, message}}` without wrapper metadata.

**Do NOT touch:** `src/routes/chat.ts` credit-detection logic (already functional), any of the view animation/citation/mobile code (already implemented and tested), or the LICENSE file.

## Verification Criteria

All criteria trace directly to the goal-level done_when list.

1. `grep -rn 'citation-badge' src/views/` — exits 0 [design-tokens.ts:218]
2. `grep -rn '@keyframes' src/views/` — exits 0 [design-tokens.ts:230,234]
3. `grep -rn '1\.4s\|1400ms\|typing.*duration' src/` — exits 0 [design-tokens.ts:95]
4. `grep -rn 'prefers-reduced-motion' src/views/` — exits 0 [design-tokens.ts:276]
5. `grep -rn 'visualViewport\|100dvh\|position:\s*sticky' src/views/` — exits 0
6. `grep -rn 'shiftKey\|Shift.Enter' src/views/` — exits 0 [streaming.ts:185]
7. `grep -rn 'MAINTAINER_GH_USERNAME' src/` — exits 0
8. `grep -rn 'm-naw' src/views/` — exits 0
9. `grep -rn 'TheClientZero' src/views/` — exits 0
10. `grep -n 'Section 7' LICENSE` — exits 0
11. `grep -n 'credit' src/routes/chat.ts` — exits 0
12. `grep -rn 'role="log"\|aria-live' src/views/` — exits 0
13. `grep -rn 'btn\.disabled\s*=\s*true\|setAttribute.*disabled' src/views/` — exits 0 [streaming.ts:199]
14. `pnpm test` — 254 tests pass, 0 fail
15. `pnpm build` — exits 0
16. `pnpm typecheck` — exits 0
17. Human smoke check: verify chat page on mobile + desktop browsers for UX coherence