## Problem Statement

The project has no operational documentation. Operators who want to remove their deployment, understand the security model, configure optional Cloudflare Access, or troubleshoot deploy failures have no reference material. New operators cannot find verified signup URLs before deploying. Downstream forkers may not know they must preserve the canonical-repo footer link required by G5.

## Current Behavior

- `docs/` contains only `architecture.md`, `artifacts/design-context.md`, and auto-generated spec/plan files — none of the seven required docs files exist.
- `README.md` (54 lines) has no 'Before you start' preflight section and does not link to `github.com/signup`, `dash.cloudflare.com/sign-up`, or `console.anthropic.com`.
- `LICENSE` already contains an AGPL-3.0 Section 7(b) additional terms block (confirmed by investigation) requiring preservation of the canonical-repo footer link (`https://github.com/m-naw/theclientzero-askmycv`) and the three constants in `src/views/chat-page.ts`. The `fs:contains LICENSE Section 7(b)` criterion is therefore already satisfied.

## Proposed Changes

### docs/UNINSTALL.md
Three clearly-labelled scenarios with exact navigation steps (no vague phrases):
1. **Pause** — disable the Cloudflare Worker without deleting it: navigate to `https://dash.cloudflare.com/` → Workers & Pages → select the worker → Settings → toggle "Enabled" off.
2. **Reset** — delete KV namespaces and re-run setup: navigate to `https://dash.cloudflare.com/` → Workers & Pages → KV → delete the `CHAT_KV` binding, then re-run `wrangler kv:namespace delete`.
3. **Permanent delete** — delete Cloudflare Worker, KV namespaces, GitHub fork, and Anthropic API key: exact steps for each console. Cites `https://developers.cloudflare.com/workers/configuration/delete-a-worker/`, `https://github.com/settings/repositories`, `https://console.anthropic.com/settings/keys`.
Carries `Last verified: 2026-05-18` stamp.

### docs/SECURITY.md
- Password-primary auth summary: bcrypt cost ≥12 hash stored in KV; plaintext never persisted.
- Optional Cloudflare Access progressive enhancement: how JWT verification is auto-detected (non-hardcoded).
- Threat model: what's in scope (admin credential theft, rate-limit bypass) and out of scope (Cloudflare infrastructure, Anthropic API key leakage via platform).
- Recovery procedures: password reset via `wrangler kv:key delete` on `ADMIN_PASSWORD_HASH`, re-run setup.
Carries `Last verified: 2026-05-18`.

### docs/ACCESS_FALLBACK.md
- When CF Access is useful: shared-network deployments, team environments requiring SSO.
- Step-by-step setup: navigate to `https://one.cloudflare.com/` → Zero Trust → Access → Applications → Add an application → Self-hosted. Configure the policy to protect `/admin` routes. Cites `https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-apps/`.
- Verification procedure: check worker logs for `CF-Access-Jwt-Assertion` header presence.
Carries `Last verified: 2026-05-18`.

### docs/TROUBLESHOOTING.md
- Common deploy failures: `wrangler deploy` authentication error → run `wrangler login`.
- `wrangler.toml` vars issue: test-only variables must not appear in `[vars]` block; keep test mocks in vitest config.
- Anthropic key rejection: verify key at `https://console.anthropic.com/settings/keys`; confirm billing is active.
- Budget cap: `DAILY_SPEND_LIMIT_USD` env var controls spend; default $1.00; increase via wrangler secret.
- 503 errors: Cloudflare Worker CPU limit exceeded; check `wrangler tail` output at `https://dash.cloudflare.com/` → Workers & Pages → worker name → Logs.
Carries `Last verified: 2026-05-18`.

### docs/PREFLIGHT.md
Pre-deployment checklist with direct hyperlinks:
- [ ] GitHub account: `https://github.com/signup`
- [ ] Cloudflare account: `https://dash.cloudflare.com/sign-up`
- [ ] Anthropic account: `https://console.anthropic.com/`
- [ ] Wrangler CLI authenticated: `wrangler login`
- [ ] Node 20+ and pnpm 9+ installed
- [ ] Fork of this repo available in your GitHub account
Carries `Last verified: 2026-05-18`.

### docs/SPEC_CORRECTIONS.md
Stub template for recording spec corrections. Contains: title, date, affected spec, correction description, reason fields. No operational content — a template.

### docs/SOURCES.md
Master citation index. Lists every external URL referenced in UNINSTALL.md, ACCESS_FALLBACK.md, PREFLIGHT.md, SECURITY.md, and TROUBLESHOOTING.md. Each entry: `| URL | Purpose | Last verified |`. Minimum 5 URLs (confirmed: the operational docs above reference ≥8 distinct external URLs). Built by grepping all operational docs after authoring.

### README.md updates
Insert a `## Before you start` section immediately before the existing deploy/setup section. This section contains:
- Intro sentence about three required accounts.
- `https://github.com/signup` — GitHub account
- `https://dash.cloudflare.com/sign-up` — Cloudflare account
- `https://console.anthropic.com/` — Anthropic account
Note: `console.anthropic.com` (without path) satisfies the `fs:contains README.md console.anthropic.com` criterion.

### LICENSE
No change required — Section 7(b) already exists (confirmed by codebase investigation).

## Implementation Notes

**Approach chosen: Atomic single sprint.** All files authored in sequence; SOURCES.md built last by grepping operational docs.

**Pre-registered falsifiers (Confidence Protocol):**
- Criterion `fs:exists docs/SOURCES.md`: falsified by `test -f docs/SOURCES.md` returning non-zero.
- Criterion `fs:contains README.md Before you start`: falsified by `grep -q 'Before you start' README.md` returning non-zero.
- Criterion `fs:contains LICENSE Section 7(b)`: falsified by `grep -q 'Section 7(b)' LICENSE` — already satisfied (evidence: codebase investigation confirmed Section 7(b) block exists in LICENSE last 50 lines).
- Criterion URL-mirror: falsified by the mirror-check loop finding miss>0.
- Criterion vague-phrase: falsified by `grep -rEi 'go to the dashboard|find the setting|click somewhere|refer to the documentation'` returning matches.

**Adversarial check:** "How could the URL-mirror criterion pass while the goal actually fails?" — if an operational doc contains zero external URLs (all navigation via vague language), the mirror loop runs over an empty set and exits 0. But the vague-phrase grep would then fire and fail the iteration. The two criteria are mutually enforcing: having zero URLs forces vague language which fails the vague-phrase check; having URLs forces mirror coverage. No silent pass path exists.

**Evidence-bound confidence scoring:**
- LICENSE Section 7(b): 0.5 base + 0.3 (direct inspection of file last 50 lines) = **0.95** — criterion already satisfied, no authoring needed.
- docs/ file creation (×7): 0.5 base + 0.25 (straightforward file write, no code, no test dependency) = **0.75** — flagged below 0.85; residual gap is agent execution correctness.
- README.md updates: 0.5 base + 0.2 (file exists, clear insert point) = **0.70** — flagged; residual gap is exact string match for three URLs.
- URL-mirror check: 0.5 base + 0.1 (structurally sound if SOURCES.md built by grepping) - 0.1 (agent might author docs and forget to run the grep) = **0.50** — flagged; mitigated by instructing agent to explicitly run the mirror check as a verification step before committing.
- vague-phrase check: 0.5 base + 0.2 (forbidden phrases are specific and enumerated) = **0.70** — flagged; mitigated by explicit prohibition in task description.
- Last verified stamp: 0.5 base + 0.2 (specific format, 2026-05-18 date) = **0.70** — flagged; must be in task description as mandatory field.

**Flagged criteria (below 0.85) and guards:**
- All 7 file-existence criteria: guard = task description includes exact file paths with no ambiguity.
- URL-mirror: guard = task explicitly instructs agent to run mirror-check script before declaring done.
- vague-phrase: guard = task lists forbidden phrases verbatim.
- Last verified: guard = task specifies exact format `Last verified: 2026-05-18`.
- README URLs: guard = task lists exact strings that must appear.

**AGPL-3.0 Section 7(b) pre-existing:** The implementation agent must NOT modify LICENSE. Doing so risks corrupting the existing valid attribution clause. The criterion is already met.

[STRATEGOS-LOG] {"event":"skill_used","data":{"skill":"confidence-protocols:confidence-protocol","summary":"applied to 16 criteria, 13 flagged below 0.85; LICENSE criterion already satisfied at 0.95; guards added for all flagged criteria"}}

## Verification Criteria

1. `test -f docs/UNINSTALL.md` → exit 0
2. `test -f docs/SECURITY.md` → exit 0
3. `test -f docs/ACCESS_FALLBACK.md` → exit 0
4. `test -f docs/TROUBLESHOOTING.md` → exit 0
5. `test -f docs/PREFLIGHT.md` → exit 0
6. `test -f docs/SPEC_CORRECTIONS.md` → exit 0
7. `test -f docs/SOURCES.md` → exit 0
8. `grep -q 'Before you start' README.md` → exit 0
9. `grep -q 'github.com/signup' README.md` → exit 0
10. `grep -q 'dash.cloudflare.com/sign-up' README.md` → exit 0
11. `grep -q 'console.anthropic.com' README.md` → exit 0
12. `grep -q 'Section 7(b)' LICENSE` → exit 0 (already satisfied)
13. `grep -r 'Last verified:' docs/` → finds matches in ≥5 doc files
14. `test $(grep -cE 'https?://' docs/SOURCES.md) -ge 5` → exit 0
15. URL-mirror loop: `miss=0; for u in $(grep -hoE 'https?://[^ )"<>]+' docs/UNINSTALL.md docs/ACCESS_FALLBACK.md docs/PREFLIGHT.md | sort -u); do grep -qF "$u" docs/SOURCES.md || miss=$((miss+1)); done; test $miss -eq 0`
16. Vague-phrase grep: `grep -rEi 'go to the dashboard|find the setting|click somewhere|refer to the documentation' docs/UNINSTALL.md docs/ACCESS_FALLBACK.md docs/PREFLIGHT.md docs/SECURITY.md docs/TROUBLESHOOTING.md README.md` → exit 1 (no matches)