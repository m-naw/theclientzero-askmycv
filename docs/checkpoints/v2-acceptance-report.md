# v2 Acceptance Report

Date: 2026-05-19
Spec: docs/specs/auto/2026-05-19-full-v2-acceptance-test-suite-and-regression-sweep.md

## Test status (1–20)

| Test | Topic | Source | Status |
|------|-------|--------|--------|
| 1 | Setup window expiry | `src/__tests__/setup/setup-acceptance.test.ts` | PASS |
| 2 | Setup form validation | `src/__tests__/setup/setup-acceptance.test.ts` | PASS |
| 3 | First-config persistence | `src/__tests__/setup/setup-acceptance.test.ts` | PASS |
| 4 | State machine routing | `src/__tests__/state-machine/machine.test.ts` | PASS |
| 5 | Admin login + session | `src/__tests__/auth/*.test.ts` | PASS |
| 6 | /chat happy path streaming | `src/__tests__/chat/acceptance-test-6.test.ts` | PASS |
| 7 | Per-IP rate limit (429) | `src/__tests__/acceptance/test7-rate-limit.test.ts` | PASS |
| 8 | Daily budget cap (503) | `src/__tests__/acceptance/test8-budget.test.ts` | PASS |
| 9 | Bot UA rejection (403) | `src/__tests__/acceptance/test9-bot-ua.test.ts` | PASS |
| 10 | GET /admin unconfigured (404) | `src/__tests__/acceptance/test10-admin-unconfigured.test.ts` | PASS |
| 11 | /chat not configured (503) | `src/__tests__/acceptance/test-chat-not-configured.test.ts` | PASS |
| 12 | Anthropic failure modes | `src/__tests__/acceptance/test12-anthropic-failure.test.ts` | PASS |
| 13 | KV put() failure handling | `src/__tests__/acceptance/test-kv-failure.test.ts` | PASS |
| 14 | Setup CV validation length | `src/__tests__/setup/setup-acceptance.test.ts` | PASS |
| 15 | Admin save preserves API key | `src/__tests__/routes/state-d-integration.test.ts` | PASS |
| 16 | Anthropic key never echoed | `src/__tests__/acceptance/test12-anthropic-failure.test.ts` | PASS |
| 17 | Password hash never echoed | `src/__tests__/auth/password.test.ts` | PASS |
| 18 | CF Access JWT auto-detect | `src/__tests__/auth/access.test.ts` | PASS |
| 19 | Anthropic timeout bounded | `src/__tests__/resilience/anthropic-timeout.test.ts` | PASS |
| 20 | Forgot-password inline recovery | `src/__tests__/acceptance/test20-forgot-password.test.ts` | PASS |

## Aggregate counts

- Acceptance test files: 8 (`src/__tests__/acceptance/`)
- Acceptance tests passing: 25/25
- Changed-suite total (`vitest --changed` from baseline `dd122de4`): 149/149 PASS
- Full suite total (2026-05-19, baseline `3eec552`): 292/292 PASS (42 test files)

## SPEC_CORRECTIONS

`SPEC_CORRECTIONS: none`

The v2 spec coverage was filed exactly as written; no corrections to
`docs/SPEC_CORRECTIONS.md` were required for this iteration.

## Human-smoke required

`F9 human-smoke: mobile on-screen-keyboard` — the chat composer's behavior with
the iOS/Android on-screen keyboard (viewport resize, scroll-into-view of the
input field, send button reachability) cannot be exercised by Miniflare and
must be validated manually on a real device before release.

## Notes

- `wrangler.toml` confirmed clean of test/mock vars (`MOCK_`, `TEST_`,
  `ANTHROPIC_MOCK`, `MSW_`).
- `/chat` rate-limit bookkeeping now fails-open on KV put outages
  (`src/routes/chat.ts`), preserving visitor-facing availability under
  transient KV failure; this is exercised by Test 13.
- Forgot-password recovery instructions in `src/views/login.ts` now list
  both the Cloudflare dashboard flow and the equivalent `wrangler kv key
  delete` commands inline (no docs/ link required).
