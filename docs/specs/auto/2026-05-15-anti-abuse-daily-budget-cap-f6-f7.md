## Problem Statement

G6 adds the abuse-resistance and cost-ceiling layer to the POST /chat endpoint. Without it, the worker is open to bot scraping, per-visitor request flooding, runaway Anthropic spend beyond the owner's daily budget, and oversized payloads. The goal completes §9 F6 (daily budget cap) and F7 (anti-abuse) from docs/spec.md.

## Current Behavior

`src/routes/chat.ts` already implements:
- **Garbage input rejection** (>100 chars, >70% uppercase → 400) at lines 94–107 ✓
- **Haiku pricing constants** (`INPUT_RATE_USD=1`, `CACHED_RATE_USD=0.1`, `OUTPUT_RATE_USD=5`) at lines 36–38 ✓
- **Daily spend write** to KV key `spend:<UTC-date>` with 30-hour TTL at lines 199–208 ✓
- **Token usage parsing** from `message_start` and `message_delta` SSE events at lines 162–196 ✓

What is **not** implemented:
- Budget pre-flight check (no comparison of `spend:<today>` vs `config.daily_budget_usd` before the Anthropic call)
- User-Agent bot rejection (no UA header check in handlePostChat)
- Per-IP hourly rate limit (no KV `ratelimit:<ip>:<hour>` logic)
- 100KB payload size guard (no content-length or body-size check)
- `ExecutionContext.waitUntil` decoupling for spend writes (current `flush()` awaits KV directly)
- `max_msgs_per_hour` field in `StoredConfig` / `parseStoredConfig`
- Acceptance Tests 7, 8, 9

`src/worker.ts:46`: `_ctx: ExecutionContext` is declared but unused and not forwarded to `handlePostChat`.

## Proposed Changes

### 1. `src/types/config.ts` — add `max_msgs_per_hour` optional field

Add `max_msgs_per_hour?: number` to `StoredConfig` interface. The `parseStoredConfig` validator accepts its absence (optional, defaults to 30 at call-site). No required-field validation change needed.

### 2. `src/worker.ts` — thread `ctx` to `handlePostChat`

Change `handlePostChat(request, env)` call at line 58 to `handlePostChat(request, env, ctx)`. Remove underscore from `_ctx` parameter (line 46).

### 3. `src/routes/chat.ts` — implement all missing guards + ctx.waitUntil

**Signature change:** `handlePostChat(request: Request, env: Env, ctx: ExecutionContext)`

**Guard order (all return early before Anthropic call):**

1. **Payload size guard** (before body parse): Check `Content-Length` header or read body text. If body exceeds 100,000 bytes, return 413.

2. **User-Agent guard** (after body parse, before config load): Read `request.headers.get("user-agent") ?? ""`. Reject with 403 if: length < 10, OR matches `/^(curl|wget|python-requests|httpie|go-http)/i`.

3. **Budget pre-flight** (after config load): Read `spend:<today>` from KV. If `Number(value ?? "0") >= cfg.daily_budget_usd`, return 503 immediately. Zero Anthropic calls made.

4. **Per-IP rate limit** (after budget pre-flight): Extract IP from `request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown"`. Hour bucket: `Math.floor(Date.now() / 3_600_000)`. KV key: `ratelimit:<ip>:<hour>`. Read count; if `count >= (cfg.max_msgs_per_hour ?? 30)`, return 429. Increment counter with `expirationTtl: 3600` before proceeding to Anthropic call.

**Spend write decoupling:** Change flush() to call `ctx.waitUntil(spendWritePromise)` where `spendWritePromise` is a fire-and-forget Promise. The flush() returns synchronously; stream closes without waiting on KV.

### 4. `src/test/chat-abuse.test.ts` — Acceptance Tests 7, 8, 9

New test file implementing Tests 7, 8, 9 from docs/spec.md §12, using existing harness (anthropic-mock, kv helpers, env, createExecutionContext, fetchMock, waitOnExecutionContext).

- **Test 7:** 3 sub-cases (curl UA, no UA, python-requests UA) → 403 each; mock records 0 calls.
- **Test 8:** Seed config with `max_msgs_per_hour=3`. 3 requests from simulated IP → 200. 4th → 429. Mock records exactly 3 calls. Clear KV rate-limit key; next request → 200.
- **Test 9:** Seed `daily_budget_usd=1`. Pre-seed `spend:<today>=1.05`. POST /chat → 503, mock 0 calls. Reset spend to 0. POST /chat → 200.
- **KV failure test:** Mock `env.STATE.put` to throw; POST /chat returns 200 with full SSE body.

## Implementation Notes

**Approach:** Guards implemented inline in `chat.ts` with extracted pure functions (consistent with existing `costUsd()` pattern). No new source modules required — the AFFECTED AREAS naming (`src/abuse/`, `src/budget/`) informs test organization only.

**ctx.waitUntil (adversarial finding):** `ctx` is captured in the `handlePostChat` closure and accessible inside TransformStream flush. The flush() must NOT await KV — call `ctx.waitUntil(promise.catch(() => {}))` and return synchronously. This was identified as the highest-risk gap: the current implementation awaits KV inside flush(), coupling stream completion to KV write.

**Rate-limit increment timing:** Increment BEFORE Anthropic call (with await or ctx.waitUntil before fetch) to prevent concurrent requests slipping under the limit.

**max_msgs_per_hour:** Optional in StoredConfig; parseStoredConfig returns it via the existing cast at config.ts:94. No validator change needed beyond adding the field to the interface.

**Sonnet pricing:** Model is hardcoded to Haiku in G6 scope. Only Haiku rates needed (1/0.10/5 per million). Sonnet pricing path is out of scope.

**CP flagged criteria:** Criterion 8 (KV failure tolerance) had adversarial-identified risk around ctx threading. Mitigated by explicit worker.ts change in sprint-1 task 1. All criteria scored ≥ 0.87 after investigation.

## Verification Criteria

1. `spend:<today>` increases after successful POST /chat; KV TTL ≥ 86400s (chat.ts SPEND_TTL_SECONDS=108000)
2. Pre-seed `spend:<today>` ≥ `daily_budget_usd` → POST /chat returns 503; mock records 0 calls
3. Cost delta matches `(input*1 + cached*0.1 + output*5) / 1_000_000` within 5% tolerance
4. POST /chat with curl/python-requests/no UA → 403; mock records 0 calls
5. N requests from same IP succeed; N+1 → 429; mock records exactly N calls; after KV key cleared → succeeds
6. POST /chat with >100 chars >70% uppercase → 400 (already implemented)
7. POST /chat with >100KB payload → 413
8. KV write failure during spend update does not prevent 2xx streamed response
9. `pnpm test` exit 0; Test 7/8/9 pass; count ≥ G5 baseline + new tests
10. `pnpm build` and `pnpm typecheck` exit 0