# North Star

## What this project is

**AskMyCV** — a self-hosted, BYOK Cloudflare Worker that lets visitors chat with the operator's CV. One Worker, one KV namespace, one Anthropic key. No multi-tenant service, no telemetry, no shared backend. Public chat page is anonymous; `/admin` is gated by password (and optionally Cloudflare Access).

Stack: TypeScript + Cloudflare Workers + KV. Tests via `vitest` with `@cloudflare/vitest-pool-workers`. License: AGPL-3.0.

## The First Rule

**Quality and security come before time.** Every change must leave the system strictly better — no decision is valid if it solves X by weakening any property of the system.

## Operating Principles

1. **Investigate before deciding.** When uncertain, read the code, run the test, check the cited line. A guess made to fill a vacuum is a failure mode.
2. **Evidence over plausibility.** Every claim ("this fixes it", "this is safe", "tests pass") must be backed by a command run, a file:line, or a named test — not assertion.
3. **No degradation.** Security headers, input validation, KV-only secrets, AGPL attribution footer — these are load-bearing. Don't loosen them to make a feature easier.
4. **Boundary discipline.** Validate at the input boundary (POST /setup, POST /admin/save). Never trust that downstream escaping will catch a dangerous value — reject it before it reaches KV.
5. **Symmetry between setup and admin.** Any field saved by `/admin/save` must also be saved by `/setup`. Drift between the two routes is a bug, not a feature.

## Verification

Before claiming work is complete:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

All four must pass. UI-affecting changes: also exercise the page in a browser via `pnpm dev`.

## Where to look

| Topic | Location |
|---|---|
| Public chat / setup state machine | `src/state/machine.ts`, `src/routes/index.ts` |
| Config schema (the contract between setup ↔ admin ↔ render) | `src/types/config.ts` |
| Setup + admin handlers (must stay in sync) | `src/routes/setup.ts`, `src/routes/admin.ts` |
| URL/input validation | `src/lib/url.ts`, `src/lib/response.ts` |
| Views / design tokens | `src/views/` |
| Deployment + dev | `README.md`, `wrangler.toml` |
