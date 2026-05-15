## Problem Statement

G8 closes the remaining error-state and resilience gaps in the Worker: Anthropic API failure/timeout handling with bounded response time, Anthropic API key non-leakage in all HTML surfaces and logs, and automated tests for the state-D expired-setup path and Acceptance Test 12. Every criterion in docs/spec.md §9 F8, §10, and §12 Test 12 must be covered by a passing automated test.

## Current Behavior

**What already works (do not break):**
- `renderExpiredSetup` (`src/views/error-pages.ts:63`) contains the literal `setup_window_start`, Cloudflare dashboard recovery instructions, and expiry wording — confirmed by `src/test/views/error-pages.test.ts`
- `src/routes/index.ts:71–77` renders the expired page on state D — code confirmed
- All 5 admin denial reasons (`email_mismatch`, `aud_mismatch`, `team_domain_mismatch`, `signature_invalid`, `no_jwt`) are implemented in `src/views/error-pages.ts` and tested in `src/test/admin.test.ts:119–209`
- Anthropic 500 returns 502 with JSON `{error}` body — `src/routes/chat.ts:179–185`
- KV put failure during spend update is tolerated — `src/test/chat-abuse.test.ts:333–354`

**What is missing:**

1. **AbortController timeout on Anthropic fetch** — `src/routes/chat.ts:162` issues a bare `fetch()` with no timeout; a hung Anthropic connection hangs the Worker indefinitely
2. **Acceptance Test 12** — no file in `src/__tests__/acceptance/` exercises the 500 → non-2xx → recovery sequence
3. **Timeout integration test** — no test verifies the bounded-time guarantee
4. **State D integration test** — `src/test/views/error-pages.test.ts` tests static rendering only; no test exercises `GET /` through `worker.fetch` with a >30-min-old `setup_window_start` seed
5. **Key-redaction integration tests for GET / and GET /setup** — `src/test/admin.test.ts:114–115` covers `/admin`; `GET /` (state C) and `GET /setup` (state B) have no automated assertion that the Anthropic key is absent from the response body
6. **Worker stdout/stderr key check** — no test spies on `console.log`/`console.error` to assert the key never appears

## Proposed Changes

### Code change — `src/routes/chat.ts` + `src/env.ts`

Add `ANTHROPIC_TIMEOUT_MS?: string` to the `Env` interface (`src/env.ts`). In `src/routes/chat.ts`, replace the bare `fetch()` call to Anthropic with one that passes `signal: AbortSignal.timeout(timeoutMs)` where `timeoutMs = Number(env.ANTHROPIC_TIMEOUT_MS || "25000")`. Wrap the call in a try/catch: on `TimeoutError` or `AbortError`, return HTTP 504 with JSON `{error: "anthropic request timed out"}`. The existing `!upstream.ok` branch (returns 502) is unchanged.

### Infrastructure

Add `ANTHROPIC_TIMEOUT_MS = ""` to `wrangler.toml [vars]` and the `vitest.config.ts` miniflare bindings (empty = 25 s default in production; tests override per-test using `(env as Record<string, string>).ANTHROPIC_TIMEOUT_MS = "500"`).

### New test file — `src/__tests__/acceptance/test12-anthropic-failure.test.ts`

Implements Acceptance Test 12 from spec §12 and §10 non-functional requirements:
1. Mock Anthropic returns HTTP 500 → `POST /chat` returns non-2xx with JSON body containing `error` field
2. Reset mock to HTTP 200 → next `POST /chat` returns 200 (Worker recovered)
3. Set `ANTHROPIC_TIMEOUT_MS = "500"`, mock never resolves → `POST /chat` returns non-2xx within 5 real seconds
4. Key redaction for GET / (state C): seed config with key `"sk-ant-g8-redact-test"`, `GET /` body must not contain the key
5. Key redaction for GET /setup (state B): no config in KV, valid JWT → `GET /` returns setup form, body does not contain the key
6. Console spy: `vi.spyOn(console, "log")` and `vi.spyOn(console, "error")` before a chat request; no spy call argument contains the configured key string

### New test file — `src/__tests__/routes/state-d-integration.test.ts`

Full integration test through `worker.fetch`:
- Seed: `setup_window_start = String(Date.now() - 31 * 60 * 1000)`, no `config`, no JWT
- `GET /` → 200, body contains `setup_window_start`, case-insensitive `Cloudflare dashboard`, and expiry wording
- Delete `setup_window_start` → `GET /` → body does NOT contain the expired page content

## Implementation Notes

**Approach selection:** Per-call AbortController with env-configurable timeout selected. Global middleware rejected (no coverage for pre-streaming hangs). Circuit breaker rejected (YAGNI).

**AbortError handling:** In Cloudflare Workers, `AbortSignal.timeout()` fires a `DOMException` with `name === "TimeoutError"`. The catch block must handle both `"TimeoutError"` and `"AbortError"` for forward-compatibility.

**Console spy in miniflare:** The Worker's hot path has no `console.log` statements (confirmed by grep). The spy will pass trivially but establishes a structural regression guard.

**Criteria flagged below 0.85 pre-implementation:**
- Timeout criterion (0.70): `ANTHROPIC_TIMEOUT_MS` must be wired in all three locations (env.ts, wrangler.toml, vitest.config.ts bindings) AND the catch block must handle `TimeoutError`
- stdout/stderr criterion (0.65): Verify the spy pattern works in miniflare before asserting the negative; if the spy cannot capture Worker-scope console output, document the gap and verify via source grep instead

**Adversarial guard:** The timeout test is the only test that exercises the AbortController path. If production code ignores `ANTHROPIC_TIMEOUT_MS` and uses a hardcoded constant, the test would still pass (at the 500ms override) but the production timeout would be wrong. Guard: assert that `env.ANTHROPIC_TIMEOUT_MS` being absent causes the default to be used (verify via a separate unit test or by reading the constant in chat.ts).

## Verification Criteria

| Done_when | Test / Command | File |
|---|---|---|
| State D via GET / contains required strings | `it("expired-setup-window GET / contains setup_window_start, Cloudflare dashboard, expiry")` | `src/__tests__/routes/state-d-integration.test.ts` |
| Admin denial labels all 5 producible | Already in `src/test/admin.test.ts` — 5 passing tests | existing |
| Anthropic 500 → non-2xx {error}, recovery | `it("Test 12: 500 returns non-2xx with error field; recovery returns 200")` | `src/__tests__/acceptance/test12-anthropic-failure.test.ts` |
| Timeout bounded | `it("timed-out Anthropic returns non-2xx within bounded time")` with `ANTHROPIC_TIMEOUT_MS=500` | `src/__tests__/acceptance/test12-anthropic-failure.test.ts` |
| GET /, GET /setup key not in response | dedicated `it()` assertions per surface | `src/__tests__/acceptance/test12-anthropic-failure.test.ts` |
| stdout/stderr key check | `vi.spyOn(console, "log")` assertion | `src/__tests__/acceptance/test12-anthropic-failure.test.ts` |
| KV put failure → 2xx | Already in `src/test/chat-abuse.test.ts:333` — passing | existing |
| Acceptance Test 12 | Formal `describe("Test 12")` block with 3-step fixture per spec §12 | `src/__tests__/acceptance/test12-anthropic-failure.test.ts` |
| pnpm build/typecheck/test pass | `pnpm build && pnpm typecheck && pnpm test` | CI |