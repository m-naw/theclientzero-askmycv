## Problem Statement

The AskMyCV repository needs a buildable, testable Cloudflare Worker foundation with a Workers-compatible test harness before any feature work (G3+) can begin. The test harness must run inside miniflare so KV semantics, streaming, and Web Crypto behave identically to production.

## Current Behavior

The workspace at `/tmp/strategos-workspaces/STR-da3dac65-e70d-4da6-96f9-5a55549aa405/askmycv` already contains a largely-complete implementation committed to the `main` branch:

- `wrangler.toml` — declares `STATE` KV namespace; has `[vars]` with `ANTHROPIC_BASE_URL=""` and `ACCESS_JWKS_URL_OVERRIDE=""` (URL overrides, not secrets)
- `package.json` — `build`, `test`, `typecheck`, `lint` scripts; dependencies include `@anthropic-ai/sdk`, `jose`, `@cloudflare/vitest-pool-workers`, `wrangler`, `typescript`; lockfile is `pnpm-lock.yaml`
- `vitest.config.ts` — uses `defineWorkersConfig` with miniflare bindings for test URL overrides
- `src/index.ts` — placeholder fetch handler returning 404 for unknown paths
- `src/env.ts` — `Env` interface with `STATE: KVNamespace` and optional URL override bindings
- `src/test/harness/anthropic-mock.ts` — `createAnthropicMock()` with SSE event queueing and request recording
- `src/test/harness/jwks.ts` — `createJwksMock()` with ES256 key generation and controllable claims
- `src/test/smoke.test.ts` — 3 describe blocks covering KV/ReadableStream/crypto.subtle, Worker boot + Anthropic SSE, and JWKS valid/forged JWT
- `LICENSE` — AGPL-3.0 (34616 bytes)
- `cv.example.md` — 2189 chars
- `README.md` — contains Deploy-to-Cloudflare button and `deploy.workers.cloudflare.com` URL referencing `m-naw/theclientzero-askmycv`
- `pnpm build` → exit 0; `pnpm test` → 63 tests pass (7 files); `pnpm typecheck` → exit 0

**Known gap:** `package.json` declares `"lint": "eslint src"` but `eslint` is not listed in `devDependencies` and no `eslint.config.*` or `.eslintrc` file exists. GR-VERIFY-007 requires the lint command to succeed without errors.

## Proposed Changes

### Sprint 1 — Lint fix + structural verification

**Fix lint script.** Add `eslint`, `@typescript-eslint/eslint-plugin`, and `@typescript-eslint/parser` as devDependencies (compatible with existing TypeScript 5.5+). Add a minimal `eslint.config.js` (flat config) with `@typescript-eslint/recommended` rules and `no-console: error`. Run `pnpm install` to update `pnpm-lock.yaml`. Verify `pnpm lint` exits 0.

Alternatively — simpler — change the lint script to use `tsc --noEmit` and eliminate the eslint dependency entirely. This avoids adding new dependencies but loses style-check coverage. **Recommended: add eslint** since the script already names it and the project will need it for G3+ feature code.

**Verify structural done_when criteria:**
- `grep -c 'binding = "STATE"' wrangler.toml` → ≥1
- `grep -i 'api.key\|sk-ant\|secret\|password' wrangler.toml` → 0 matches
- `jq -r '.scripts | keys[]' package.json | grep -E '^(build|test|typecheck)$' | wc -l` → 3
- `test -f pnpm-lock.yaml` → exits 0
- `head -5 LICENSE | grep -qi agpl` → exits 0
- `wc -c cv.example.md | awk '$1 >= 500'` → emits output
- `grep -c 'Deploy to Cloudflare' README.md` → ≥1
- `grep -c 'deploy.workers.cloudflare.com' README.md` → ≥1

### Sprint 2 — Test harness verification

**Verify runtime environment criteria:**
- Run `pnpm test` and confirm exit 0 with ≥1 passing test
- Confirm `src/test/smoke.test.ts` describe block "Workers runtime primitives inside miniflare" passes (KV `put`/`get` with `expirationTtl`, `ReadableStream` enqueue/read, `crypto.subtle.generateKey`)
- Confirm describe block "Worker boot + Anthropic SSE mock" passes (Worker returns 404 at GET /, Anthropic mock serializes 4 event types)
- Confirm describe block "JWKS mock issues verifiable JWTs" passes (valid token verifies, forged token rejects)

**Verify harness exports:**
- `src/test/harness/anthropic-mock.ts` exports `createAnthropicMock` with `queueResponse`, `receivedRequests`, `fetchHandler`
- Anthropic mock emits `message_start`, `content_block_delta`, `message_delta`, `message_stop` SSE event types
- `src/test/harness/jwks.ts` exports `createJwksMock` with `issueJwt({ aud, iss, email, exp, sign })`
- Worker injection mechanism: `ACCESS_JWKS_URL_OVERRIDE` env binding in `vitest.config.ts` miniflare bindings (no globalThis patching in Worker code)

**Run full verification suite:**
```
pnpm build   # exit 0
pnpm test    # exit 0, ≥1 passing
pnpm typecheck  # exit 0
pnpm lint    # exit 0
```

## Implementation Notes

### Approach selection (brainstorming survivor)
Approach B (fix-and-verify) was selected over pure verification (A) and reconstruct-from-scratch (C). The implementation is structurally complete; only the lint script lacks its backing tooling. Fixing lint is lower risk than adding eslint to a Workers project because:
- The Workers TypeScript target is ES2022/ESNext; `@typescript-eslint` handles this cleanly
- Existing code already uses `tsc --noEmit` for type safety; lint adds style enforcement
- Re-implementing from scratch would invalidate the existing 63 passing tests

### Lint gap (CP-flagged, score 0.72)
Falsifier: `pnpm lint 2>&1; echo $?` — if this emits a non-zero exit, the criterion fails.
Residual gap: The exact eslint version compatible with `@cloudflare/vitest-pool-workers` v0.5 needs verification. Use eslint v9 flat config (eslint.config.js) which is the default since eslint 9.0.

### JWKS injection mechanism
The Worker uses `env.ACCESS_JWKS_URL_OVERRIDE` (env binding) to redirect JWKS lookups in tests. This is the correct non-monkey-patching pattern. The smoke test's `globalThis.fetch` patch is in test code only (jose's `createRemoteJWKSet`), not in Worker code.

### wrangler.toml [vars] block
The `[vars]` block contains `ANTHROPIC_BASE_URL` and `ACCESS_JWKS_URL_OVERRIDE` with empty-string values. These are URL overrides for testing/development, not secrets. The done_when criterion says "no [vars] block that holds secrets" — these are not secrets. The Anthropic API key is read from KV only (`env.STATE.get('secrets', {type:'json'})`), never from [vars].

### Hard constraint compliance
- Chat routes (GET /, POST /chat) have no auth gates in `src/index.ts`
- No API key, JWT secret, or credential appears in any tracked file
- LICENSE is AGPL-3.0
- Tests run under `@cloudflare/vitest-pool-workers` (miniflare), not bare Node

## Verification Criteria

| Criterion | Verification Command | Expected |
|---|---|---|
| STATE KV binding | `grep 'binding = "STATE"' wrangler.toml` | match |
| No secrets in [vars] | `grep -Ei 'api_key|sk-ant|secret|password' wrangler.toml` | no match |
| Scripts exist | `jq -r '.scripts|keys[]' package.json` contains build/test/typecheck | 3 lines |
| LICENSE AGPL | `head -100 LICENSE \| grep -qi agpl` | exit 0 |
| cv.example.md ≥500 | `wc -c cv.example.md` | ≥500 |
| README deploy button | `grep -c 'Deploy to Cloudflare' README.md` | ≥1 |
| README deploy URL | `grep -c 'deploy.workers.cloudflare.com' README.md` | ≥1 |
| KV/Stream/Crypto in miniflare | smoke.test.ts "Workers runtime primitives" passes | green |
| Anthropic mock SSE | smoke.test.ts "Anthropic SSE mock" passes | green |
| JWKS mock injection | smoke.test.ts "JWKS mock issues verifiable JWTs" passes | green |
| pnpm build | `pnpm build` | exit 0 |
| pnpm test ≥1 | `pnpm test` | exit 0, ≥1 test |
| pnpm typecheck | `pnpm typecheck` | exit 0 |
| pnpm lint | `pnpm lint` | exit 0 |