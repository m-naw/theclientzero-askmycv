# Pre-deployment Checklist

Last verified: 2026-05-18

Complete every item on this checklist before deploying AskMyCV. Each item links directly to the resource you need.

---

## Accounts required

- [ ] **GitHub account** — needed to fork the repository.
  Create one at: https://github.com/signup

- [ ] **Cloudflare account** — needed to deploy the Worker and create KV namespaces.
  Create one at: https://dash.cloudflare.com/sign-up

- [ ] **Anthropic account** — needed to obtain an API key for Claude.
  Create one at: https://console.anthropic.com/

---

## Local tools

- [ ] **Node.js 20 or later installed**
  Verify: `node --version` — the output must start with `v20` or higher.

- [ ] **pnpm 9 or later installed**
  Verify: `pnpm --version` — the output must start with `9` or higher.
  Install: `npm install -g pnpm@9`

- [ ] **Wrangler CLI installed and authenticated**
  Install: `pnpm add -g wrangler`
  Authenticate: `wrangler login`
  Verify: `wrangler whoami` — the output must show your Cloudflare account email.

---

## Repository

- [ ] **Fork of this repository available in your GitHub account**
  On https://github.com/m-naw/theclientzero-askmycv, click **Fork**, then select your account.
  After forking, confirm that `https://github.com/<your-username>/theclientzero-askmycv` exists.

---

## Anthropic API key

- [ ] **API key created and copied**
  In https://console.anthropic.com/settings/keys, click **Create key**.
  Copy the full value (starts with `sk-ant-`). You will paste this into the setup form.

- [ ] **Billing method active on your Anthropic account**
  In https://console.anthropic.com/settings/billing, confirm a payment method is attached and has available credit.
  Without an active billing method, API calls fail with a 401 error.

---

## Optional: Cloudflare Access

- [ ] **Zero Trust team domain configured** (only if you plan to use Cloudflare Access)
  In https://one.cloudflare.com/, complete the Zero Trust onboarding to set a team subdomain.
  See [docs/ACCESS_FALLBACK.md](./ACCESS_FALLBACK.md) for full setup instructions.

---

## Ready to deploy

Once every checked item above is complete:

1. Click the **Deploy to Cloudflare** button in the README.
2. Follow the Cloudflare deploy UI — it forks the repo, sets up the Worker, and creates the KV namespace.
3. After the deploy completes, open the Worker URL and visit `/setup` within 10 minutes.
