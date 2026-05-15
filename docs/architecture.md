# AskMyCV — Architecture & Test Harness Design

**Status:** Baseline design (G1). Consumed by all subsequent implementation goals.
**Source of requirements:** [`docs/spec.md`](./spec.md). This document binds spec sections §4 (business constraints), §8 (state machine), §9 (F1–F8), §10 (non-functional), §12 (test scenarios), and §14 (cost / caching guidance) to concrete code structure.

This document is normative for the project's stack, module layout, KV schema, routing, state-machine transitions, mock/test contracts, and pricing constants. It is **not** a UI spec and not a copy of the spec — it is the implementation contract.

---

## 1. Stack (locked)

| Concern | Choice | Why (grounded in real APIs) |
|---|---|---|
| Runtime | Cloudflare Workers (V8 isolates, `fetch` handler) | Mandated by spec.md §4 (Platform). |
| Language | TypeScript (strict) | Compiles via `wrangler` esbuild pipeline; types from `@cloudflare/workers-types`. |
| Build / deploy | `wrangler` (current major) with `wrangler.toml` declaring the `STATE` KVNamespace binding | Required by F1 done_when (`wrangler.toml` declares STATE binding). |
| State / config | `KVNamespace` bound as `env.STATE` — only persistence layer per spec.md §4 | Single binding; `KVNamespace.get/put/delete/list` per Workers runtime. |
| JWT verification | [`jose`](https://github.com/panva/jose) — `createRemoteJWKSet` + `jwtVerify` | Pure ESM, runs on Workers (uses `crypto.subtle` which is exposed in the Workers global scope). Recommended in spec.md §14. |
| Anthropic SDK | [`@anthropic-ai/sdk`](https://github.com/anthropics/anthropic-sdk-typescript) — `client.messages.create({ stream: true, ... })` | Official SDK; supports the Workers `fetch` runtime via `baseURL` + `fetch` injection. |
| Local runtime / tests | `vitest` + [`@cloudflare/vitest-pool-workers`](https://developers.cloudflare.com/workers/testing/vitest-integration/) | Spawns Miniflare workerd with the same KV semantics + `ExecutionContext` as production. Required so that `cf-access-jwt-assertion` propagation, KV TTL behavior, and SSE streaming are exercised against the real workerd, not a Node mock. |
| Local dev server | `wrangler dev` (workerd) | Same runtime as test pool — keeps spec.md §6's "local instance" verification path uniform. |

**ARCHITECTURE_DECISION:** Picked `@cloudflare/vitest-pool-workers` over plain `vitest` + Node `undici` mocks because spec.md §10 requires SSE streaming verification against the *real* `ReadableStream` semantics and KV TTL behavior (`spend:<date>` 24h auto-expiry per F6 done_when) — Node mocks diverge from workerd on both axes.

**ARCHITECTURE_DECISION:** Picked `jose` over hand-rolled JWT verification because Workers' `crypto.subtle` exposes ECDSA/RSA verification primitives directly, and `jose`'s `createRemoteJWKSet` handles JWKS caching + key rotation without us reimplementing key rollover.

---

## 2. Cloudflare Workers runtime APIs we depend on

These are concrete capabilities the design uses; tests must run against a runtime that provides them (workerd via Miniflare does).

- **`KVNamespace`** (binding `env.STATE`):
  - `get(key, { type: "json" | "text" })` for config/secrets reads.
  - `put(key, value, { expirationTtl?: number })` — the `expirationTtl` option (seconds) is the mechanism for auto-clearing `spend:<date>` after 24h (F6 done_when: "expiration of at least 24 hours so it auto-clears").
  - `delete(key)` for the recovery path in F8 (delete `setup_window_start`).
  - `list({ prefix })` is **not** required by current scope; we avoid it.
- **`ExecutionContext`** (second arg to `fetch(request, env, ctx)`):
  - `ctx.waitUntil(promise)` is the mechanism for the F6 best-effort spend write — the SSE response body returns to the visitor immediately, while the spend `KV.put` runs in the background. This satisfies §10's "Failed `spend:<date>` KV writes do not cause the visitor's `POST /chat` response to fail" because the failure happens after the response has been flushed.
- **`Request` / `Response`** (Fetch API):
  - `request.headers.get("cf-access-jwt-assertion")` for Access JWT extraction.
  - `request.headers.get("user-agent")` and `request.headers.get("cf-connecting-ip")` for anti-abuse (F7).
  - `new Response(stream, { headers: { "content-type": "text/event-stream" }})` for chat streaming.
- **`ReadableStream` / `TransformStream`** (Streams API):
  - `TransformStream` is used to splice between Anthropic's SSE source stream and the visitor's response body so the Worker can observe `message_delta` events for usage accounting *while* passing bytes through unmodified.
- **`crypto.subtle`** is available in Workers global scope; `jose` uses it for signature verification.
- **No `setTimeout`/`setInterval` polling** — Worker invocations are request-scoped; the only "background" affordance is `ctx.waitUntil`.

**Local-runtime contract:** Tests run under `@cloudflare/vitest-pool-workers`, which executes the Worker inside Miniflare's workerd. KV is backed by the Miniflare KV simulator (with real TTL semantics), `ExecutionContext.waitUntil` is honored before the test asserts, and `crypto.subtle` is the same workerd subtle. No globals are monkey-patched.

---

## 3. Anthropic Messages API shape

The Worker calls Anthropic via `@anthropic-ai/sdk`'s `client.messages.create(...)`. The request body fields the Worker constructs (per F4 done_when):

```ts
client.messages.create({
  model: config.model,                  // "claude-haiku-4-5-20251001" or "claude-sonnet-4-6"
  max_tokens: 512,                      // F4 done_when: max_tokens ≤ 512
  stream: true,                         // F4 done_when: SSE response
  system: [
    {
      type: "text",
      text: SYSTEM_PROMPT_PREAMBLE,     // first-person / [cv] / refuse off-topic / refuse injection
    },
    {
      type: "text",
      text: config.cv_markdown,         // verbatim CV markdown — F4 done_when
      cache_control: { type: "ephemeral" }, // §14: prompt caching to cut input cost ~10x
    },
  ],
  messages: trimmedMessages,            // ≤12 turns, each ≤1500 chars (F4 done_when)
});
```

**Why `cache_control` on the CV block specifically:** spec.md §14 calls out Anthropic's prompt-caching surface as the lever that turns the median per-conversation cost from "uncomfortable" into ~$0.02. The CV markdown is the largest stable prefix (up to ~50 KB per F3); placing `cache_control: { type: "ephemeral" }` on the CV system block lets Anthropic charge cached-input rates (Haiku: $0.10/M instead of $1/M) on every subsequent request within the cache TTL. The preamble is small enough that whether it's cached doesn't move the cost meaningfully; we still place it before the CV in the `system` array so the cache prefix is stable.

**SSE event types we consume** (Anthropic Messages streaming):
- `message_start` — contains the initial `usage` (input_tokens, cache_creation_input_tokens, cache_read_input_tokens). We capture these.
- `content_block_start` / `content_block_delta` / `content_block_stop` — passed through to the visitor stream unmodified.
- `message_delta` — contains the final `usage.output_tokens`. We capture this; combined with `message_start.usage` it drives the cost calculation in F6.
- `message_stop` — terminator; triggers the `ctx.waitUntil(updateSpend(...))` call.

The `TransformStream` between Anthropic and visitor parses each `data: {...}` SSE frame for these event types while forwarding bytes. We do **not** buffer the whole response.

---

## 4. Module / file layout

```
src/
  index.ts                    // fetch(request, env, ctx) — single entry; routes by URL.pathname
  routes/
    home.ts                   // GET /     — state-machine dispatch (instructions / setup form / chat page / expired page)
    setup.ts                  // POST /setup
    chat.ts                   // POST /chat
    admin.ts                  // GET /admin, POST /admin/save
    health.ts                 // GET /health
  state/
    machine.ts                // computeState(env, jwt) → {A,B,C,D}; transitions defined here
    kv.ts                     // typed KV accessors: getConfig, putConfig, getSecrets, putSecrets, etc.
  auth/
    access.ts                 // verifyAccessJwt(token, expectedAud?, expectedIss?, expectedEmail?)
                              //   — wraps jose.jwtVerify against a JWKS resolved from env.JWKS_URL
                              //     (production default derived from team domain; tests inject test URL)
  llm/
    anthropic.ts              // makeAnthropicClient(env) — returns @anthropic-ai/sdk client
                              //   with baseURL = env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com"
    prompt.ts                 // SYSTEM_PROMPT_PREAMBLE (first-person, [cv], refuse off-topic, refuse injection)
    stream.ts                 // anthropicToVisitorStream(upstream) — TransformStream + usage capture
    cost.ts                   // PRICING constants + computeCost(model, usage)
  policy/
    ratelimit.ts              // checkAndIncrement(env, ip, limitPerHour)
    botcheck.ts               // isBotUserAgent(ua), isLowQualityInput(text)
    budget.ts                 // isOverBudget(env, dailyBudgetUsd); recordSpend(env, ctx, model, usage)
  html/
    page.ts                   // tiny tagged-template html`...` helper with escaping
    pages/
      instructions.ts         // Access setup guide (F2)
      setup-form.ts           // F3
      chat-page.ts            // F4
      admin-form.ts           // F5
      expired.ts              // F8 setup_window_expired
      access-denied.ts        // F8 admin denied — names email/aud/iss/sig/no_jwt
test/
  setup.ts                    // vitest-pool-workers env wiring
  helpers/
    jwks.ts                   // controllable JWKS — generates an EC keypair, exposes JWKS over a fetch handler
    anthropic-mock.ts         // controllable Anthropic — mirrors @anthropic-ai/sdk Messages.create signature
  scenarios/
    test-01-cold-start.test.ts ... test-12-anthropic-failure.test.ts
wrangler.toml                 // [[kv_namespaces]] binding = "STATE"
```

**ARCHITECTURE_DECISION:** Split into per-route files even though spec.md §14 suggests a single source file is fine, because the test harness is per-scenario and stack traces from a small per-route module are easier to debug than from one 800-line file. The routing in `index.ts` is still a single `switch` on `url.pathname` — we are not introducing a routing framework.

---

## 5. KV schema

All keys live under `env.STATE`. Values are JSON unless noted.

| Key | Type | Purpose | TTL |
|---|---|---|---|
| `config` | JSON `Config` (see below) | Owner's persistent configuration. Presence ⇔ "configured" state (spec.md §8 State C). | none |
| `secrets` | JSON `{ anthropic_api_key: string }` | Anthropic key only. Stored separately so HTML render paths never load it accidentally (F6 §10 "API key never present in any HTML response"). | none |
| `setup_window_start` | string ISO timestamp | Set on the first request to a worker with no `config`. Drives the §8 State A → State D transition after 30 min. Deleting this key is the documented F8 recovery path. | none (deleted by recovery, or overwritten on next setup) |
| `spend:<UTC-date>` | string decimal USD (e.g. `"0.0421"`) | Cumulative AI spend for the current UTC day. Compared against `config.daily_budget_usd` in F6. UTC date is `YYYY-MM-DD`. | `expirationTtl: 86400` (24h) — required by F6 done_when |
| `ratelimit:<ip>:<hour>` | string integer count | Per-IP request count for the rolling hour bucket. `<hour>` is `YYYY-MM-DDTHH` UTC. | `expirationTtl: 3600` (1h) so old buckets self-clear |

**`Config` shape** (persisted at F3 setup, mutated at F5 admin save):

```ts
type Config = {
  display_name: string;
  headline: string;
  cv_markdown: string;                    // 200..50000 chars (F3)
  location?: string;
  linkedin_url?: string;
  github_url?: string;
  pdf_cv_url?: string;
  accent_color?: string;
  model: "claude-haiku-4-5-20251001" | "claude-sonnet-4-6"; // default Haiku
  daily_budget_usd: number;               // 0.50..100, default 5
  max_msgs_per_hour: number;              // 5..300, default 30
  // Identity captured from Access JWT at setup; used by F5 admin matching:
  access_email: string;
  access_aud: string;
  access_team_domain: string;             // e.g. "test.cloudflareaccess.com"
};
```

`secrets` is intentionally a separate KV entry so the chat page render path can `getConfig` without ever loading the Anthropic key into a variable that a future maintainer could accidentally serialize into HTML.

---

## 6. Routing

Single `fetch` handler in `src/index.ts` dispatches by `URL.pathname`:

| Method + path | Handler | Auth | State preconditions |
|---|---|---|---|
| `GET /` | `routes/home.ts` | none required for render; JWT *consumed if present* to switch between State A and State B | dispatches by computed state |
| `GET /health` | `routes/health.ts` | none | always 200 (used by F2 polling) |
| `POST /setup` | `routes/setup.ts` | requires valid Access JWT | only in State B |
| `GET /admin` | `routes/admin.ts` | requires JWT matching `config.access_*` | only in State C |
| `POST /admin/save` | `routes/admin.ts` | requires JWT matching `config.access_*` | only in State C |
| `POST /chat` | `routes/chat.ts` | none (public) | only in State C; subject to budget + rate-limit + bot-check |
| anything else | 404 | — | — |

Spec.md §14 says no routing framework is needed; we honor that — `index.ts` is a `switch (url.pathname)` with method checks.

---

## 7. State machine wiring (spec.md §8)

`state/machine.ts` exports:

```ts
type WorkerState = "unconfigured_no_access" | "unconfigured_with_access" | "configured" | "setup_window_expired";
async function computeState(env: Env, jwt: VerifiedJwt | null): Promise<WorkerState>;
```

**The four states** (verbatim from spec.md §8) and the transition triggers:

| State | Entered when | Transition out → triggered by |
|---|---|---|
| `unconfigured_no_access` (A) | `config` absent in KV AND no valid JWT on this request | → B when a request arrives carrying a valid JWT;<br>→ D when `now - setup_window_start > 30 min`;<br>→ C when a successful `POST /setup` writes `config` (next request, in a different session) |
| `unconfigured_with_access` (B) | `config` absent in KV AND a valid JWT is present | → C on successful `POST /setup`;<br>→ A on a subsequent request with no JWT;<br>→ D when window expires |
| `configured` (C) | `config` present in KV | terminal in normal operation; only re-entered as itself |
| `setup_window_expired` (D) | `config` absent AND `setup_window_start` older than 30 min (default; `SETUP_WINDOW_MS` constant) | → A only via the documented F8 recovery: owner deletes `setup_window_start` from the Cloudflare KV dashboard |

Side effect of computing state in A: if `setup_window_start` is absent, set it to `now`. This is the "On the first such request, the Worker records a timestamp" behavior in spec.md §8 State A and is asserted by Test 1 step 2.

---

## 8. Test-only injection points (no global monkey-patching)

Spec.md §12 requires (a) a controllable Anthropic mock and (b) a controllable JWKS endpoint. Both are wired through the `Env` binding object so tests don't have to monkey-patch globals.

### 8.1 JWKS injection

`src/auth/access.ts` resolves the JWKS URL as:

```ts
const jwksUrl = env.JWKS_URL ?? `https://${teamDomainFromConfig}/cdn-cgi/access/certs`;
const JWKS = jose.createRemoteJWKSet(new URL(jwksUrl));
```

- **Production default:** `https://<team-domain>/cdn-cgi/access/certs`, where `<team-domain>` comes from `config.access_team_domain` after first setup (and from the JWT's own `iss` claim during the very first setup, which is then validated to match `*.cloudflareaccess.com`).
- **Test injection:** `env.JWKS_URL` is set in `wrangler.toml`'s `[env.test]` block (or via `vitest-pool-workers` `miniflareOptions.bindings`) to the test harness's JWKS URL. The harness's `test/helpers/jwks.ts` generates an EC P-256 keypair with `jose.generateKeyPair("ES256")`, exposes the public JWK set at that URL, and signs test tokens with `new jose.SignJWT(...).sign(privateKey)`. Tokens issued this way verify cleanly through the same `jose.jwtVerify` call used in production — no special test-only verification path.

### 8.2 Anthropic injection

`src/llm/anthropic.ts`:

```ts
function makeAnthropicClient(env: Env, apiKey: string): Anthropic {
  return new Anthropic({
    apiKey,
    baseURL: env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
  });
}
```

- **Production default:** `https://api.anthropic.com`.
- **Test injection:** `env.ANTHROPIC_BASE_URL` is set to the harness's mock endpoint (a Worker-local URL or a Miniflare-bound service). `test/helpers/anthropic-mock.ts` exposes a fetch handler at `/v1/messages` that:
  - Mirrors `@anthropic-ai/sdk`'s `Messages.create` request shape — accepts the same body fields (`model`, `system`, `messages`, `max_tokens`, `stream`).
  - When `stream: true`, returns `content-type: text/event-stream` and emits the real SSE event sequence (`message_start` → N×`content_block_delta` → `message_delta` → `message_stop`) with configurable `usage` (input_tokens, cache_read_input_tokens, output_tokens) and configurable text deltas.
  - Records every received request so tests can assert "the `system` field contains the configured `cv_markdown`" (Test 6 step 4) and "Anthropic mock confirms 0 calls" (Test 9 step 1).
  - Has a knob to return HTTP 500 (Test 12) or to time out.

Because both injection points are `Env` bindings, the production code and the test code take identical paths through the SDK — no `if (test) ...` branches in the Worker.

**ARCHITECTURE_DECISION:** Used `env.JWKS_URL` and `env.ANTHROPIC_BASE_URL` env bindings rather than passing factories down through every handler signature, because Workers' `fetch(request, env, ctx)` already threads `env` everywhere — adding a parallel factory parameter would duplicate that and force every test to construct one.

---

## 9. Pricing constants

Per spec.md §14 (Haiku $1 / $0.10 / $5 per 1M tokens) and F6 done_when (Sonnet $3 / $0.30 / $15):

```ts
// src/llm/cost.ts
export const PRICING = {
  "claude-haiku-4-5-20251001": {
    input_per_mtok: 1.00,
    cached_input_per_mtok: 0.10,
    output_per_mtok: 5.00,
  },
  "claude-sonnet-4-6": {
    input_per_mtok: 3.00,
    cached_input_per_mtok: 0.30,
    output_per_mtok: 15.00,
  },
} as const;

export function computeCost(model: keyof typeof PRICING, usage: {
  input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
}): number {
  const p = PRICING[model];
  return (
    usage.input_tokens          * p.input_per_mtok +
    usage.cache_read_input_tokens * p.cached_input_per_mtok +
    usage.output_tokens         * p.output_per_mtok
  ) / 1_000_000;
}
```

Note: Anthropic's streaming `usage` reports cached reads as `cache_read_input_tokens` and uncached input as `input_tokens` (uncached input does **not** double-count cached reads). The F6 done_when formula `(input × input_rate + cached × cached_rate + output × output_rate) / 1M` is satisfied by the function above with a 5% rounding tolerance.

---

## 10. Mapping to F1–F8 (spec.md §9)

This document directly enables, but does not implement, every functional requirement:

- **F1 (one-click deploy)** — locked by §1's `wrangler.toml` + STATE binding; no env vars; secrets only in KV (`secrets` key, §5).
- **F2 (Access setup guidance)** — `routes/home.ts` in State A renders `html/pages/instructions.ts`; `GET /health` is wired for the polling mechanism F2 done_when requires.
- **F3 (setup form)** — `routes/setup.ts` only accepts in State B; validates against Anthropic via `llm/anthropic.ts` test call; persists `config` + `secrets` (KV schema §5).
- **F4 (visitor chat)** — `routes/chat.ts` builds the Anthropic request per §3 (`max_tokens: 512`, ≤12 messages, ≤1500-char truncation), system prompt from `llm/prompt.ts`, streams via `llm/stream.ts`.
- **F5 (admin)** — `routes/admin.ts` calls `auth/access.ts` with `expectedEmail`, `expectedAud`, `expectedIss` derived from `config.access_*`; produces named-reason denials via `html/pages/access-denied.ts`.
- **F6 (budget cap)** — `policy/budget.ts` reads `spend:<UTC-date>` before each chat; on stream completion, `ctx.waitUntil(recordSpend(...))` writes back with `expirationTtl: 86400`.
- **F7 (anti-abuse)** — `policy/botcheck.ts` (UA blocklist) + `policy/ratelimit.ts` (`ratelimit:<ip>:<hour>`).
- **F8 (errors / recovery)** — State D rendered by `html/pages/expired.ts` (must contain literal `setup_window_start`); `html/pages/access-denied.ts` names the failed check.

---

## 11. Assumptions (autonomous-mode declarations)

- **Anthropic model IDs.** Used `claude-haiku-4-5-20251001` and `claude-sonnet-4-6` (current per global instructions in this environment). The pricing constants in §9 are anchored to spec.md §14 (Haiku) and F6 done_when (Sonnet). If the implementer picks newer model IDs, only the `PRICING` map keys need updating.
- **`ratelimit:<ip>:<hour>` bucket scheme.** Spec.md F7 says "per hour" without defining sliding vs. fixed window. Picked a fixed UTC-hour bucket because (a) it matches the `spend:<UTC-date>` precedent, (b) `expirationTtl: 3600` makes cleanup automatic, and (c) it's deterministic to test by manipulating the key directly (F7 done_when bullet 6).
- **`secrets` separated from `config`.** Not strictly required by spec.md but reduces the blast radius for the §10 "API key never present in any HTML response" requirement — the page renderers never call `getSecrets`.
- **Single Anthropic client per request.** Not pooled across requests; Workers isolates may be cold or warm. The SDK is cheap to instantiate.

---

**End of architecture baseline. Subsequent goals (G2+) consume this as their planning baseline.**
