# AskMyCV

Self-hosted, BYOK Cloudflare Worker that lets visitors chat with your CV. Open source under AGPL-3.0.

Built by the Strategos agent orchestrator and shipped following the [TheClientZero](https://x.com/TheClientZero) methodology — the application is spawning itself, and you are its owner and first adopter, making the framework its own first client too.

## Cost & safety — what protects your wallet

You are bringing your own Anthropic key, so you carry the bill. The Worker is designed to make a runaway bill effectively impossible if you follow the simple practices below and keep the built-in limits intact.

**Practices you control (recommended):**

- **No auto top-up.** Leave Anthropic's auto-recharge **off**. The worst case then becomes "the chat stops answering until you top up again" — not an unbounded charge.
- **Top up in small increments.** A $5 top-up is enough for roughly 5,000 conversations with Haiku. Refill in $5–$10 steps rather than $100+ at once.
- **Pick the cheaper model first.** The setup form defaults to Claude Haiku 4.5 — roughly 3× cheaper than Sonnet. Switch to Sonnet only if you actually need higher-quality answers.
- **Set a daily budget you'd be comfortable losing in a worst-case day.** The setup form asks for `daily_budget_usd` (minimum 1 USD). Once the day's spend reaches this number the Worker refuses new Anthropic calls — no matter how much credit the key has left.

**Limits the Worker enforces automatically:**

| Limit | Default | Where |
|---|---|---|
| Hard daily Anthropic spend cap (per UTC day) | configured at setup | `daily_budget_usd` |
| Per-visitor chat rate limit (per IP per hour) | 30 messages | `max_msgs_per_hour` |
| Login attempts (per IP per hour) | 10 | `LOGIN_RATE_LIMIT_MAX` |
| `/setup` attempts (per IP per 10 min) | 10 | `SETUP_RATE_LIMIT_MAX` |
| One-time setup window after first visit | 10 minutes | `SETUP_WINDOW_MS` |
| Bot/scripted-UA rejection (`curl`, `wget`, `python-requests`, empty UA, …) | always on | `src/abuse/ua.ts` |
| Request body size cap | 100 KiB | setup + admin |
| Admin password length | 12–128 chars, bcrypt-hashed | `/setup`, `/admin` |
| Session cookie | HttpOnly · Secure · SameSite=Lax · HMAC-signed | `src/auth/session.ts` |
| Security response headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) | always on | `src/lib/response.ts` |
| URL inputs (LinkedIn / GitHub / PDF CV) | http(s) only — `javascript:`, `data:`, protocol-relative, whitespace-bypass all rejected | `src/lib/url.ts` |
| Anthropic API key storage | KV only — never echoed to HTML, logs, or env vars | `src/types/config.ts` |
| Optional Cloudflare Access SSO for `/admin` | progressive enhancement | see below |

If you want a hard ceiling that doesn't depend on this Worker at all, set a usage budget directly in the Anthropic console — that's the belt to the Worker's suspenders.

## Before you start

Three accounts are required before deploying:

- **GitHub** — to fork the repository: https://github.com/signup
- **Cloudflare** — to deploy the Worker and create KV namespaces: https://dash.cloudflare.com/sign-up
- **Anthropic** — to obtain the API key for Claude: https://console.anthropic.com

See [`docs/PREFLIGHT.md`](./docs/PREFLIGHT.md) for the full pre-deployment checklist including CLI setup and billing verification.

## Deploy to Cloudflare

One-click self-host on your own Cloudflare account — no signup, no shared service, no per-user costs to anyone but you. Your Anthropic API key lives in *your* Worker's KV namespace; the Worker is yours forever.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/m-naw/theclientzero-askmycv)

After the one-click deploy:

1. Open the Worker URL printed by Cloudflare — you have 10 minutes to complete setup. A $5 top-up at platform.claude.com is sufficient for approximately 5,000 conversations.
2. Visit `/setup`, fill in your admin password (12–128 chars), Anthropic API key, and CV markdown, then submit. You are redirected to `/admin` and logged in via session cookie.
3. Share the public URL — visitors can ask questions about your CV without any login.

See [`cv.example.md`](./cv.example.md) for the expected CV markdown shape.

### Optional: Cloudflare Access (defense-in-depth)

Cloudflare Access is a **progressive enhancement**, not a requirement. Without it, `/admin` is protected by the admin password you set during setup. If you want an additional identity layer (SSO, email allow-list, hardware keys), you can add an Access application at any time:

1. In the Cloudflare dashboard, create an Access Application that covers `/admin` and `/setup`.
2. When you next visit `/setup`, the CF Access JWT is detected and its identity claims are stored alongside your config — subsequent admin requests are verified against both the session cookie and the Access JWT.

There is no feature flag to flip; the worker auto-detects the JWT header. Deployments that skip this step operate in password-only mode permanently with no loss of functionality.

## Local development

Requirements: Node 20+, pnpm 9+.

```bash
pnpm install
pnpm build       # wrangler dry-run deploy
pnpm test        # vitest under @cloudflare/vitest-pool-workers (miniflare/workerd)
pnpm typecheck   # tsc --noEmit
pnpm dev         # wrangler dev
```

`pnpm test` boots the Worker inside miniflare so KV TTL, ReadableStream, and `crypto.subtle` behave identically to production. The smoke test in `src/test/smoke.test.ts` exercises:

- Workers runtime primitives (KV `expirationTtl`, streaming, Web Crypto).
- The Worker entry returning a 200 on `GET /`.
- The Anthropic mock streaming the four required SSE event types (`message_start`, `content_block_delta`, `message_delta`, `message_stop`).
- The JWKS mock issuing a valid JWT and rejecting a forged one through the same `jose.createRemoteJWKSet` path used in production.

## Architecture

See [`docs/architecture.md`](./docs/architecture.md) for the implementation contract: KV schema, routing, state machine, Anthropic prompt-caching strategy, and test-injection points.

## License

[AGPL-3.0-or-later](./LICENSE). If you run a modified version as a network service, you must publish your modifications.
