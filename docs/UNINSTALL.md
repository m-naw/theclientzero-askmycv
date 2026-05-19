# Uninstall Guide

Last verified: 2026-05-18

This guide covers three scenarios for removing or disabling your AskMyCV deployment.

---

## Scenario 1: Pause (disable the Worker without deleting it)

Use this when you want to temporarily stop serving traffic but keep all configuration intact.

1. Open https://dash.cloudflare.com/ and sign in.
2. In the left sidebar, select **Workers & Pages**.
3. Click the name of your deployed Worker (e.g. `askmycv`).
4. Select the **Settings** tab.
5. Under **General**, toggle the **Enabled** switch to **Off**.
6. Cloudflare will stop routing requests to the Worker immediately. Your KV data, secrets, and wrangler configuration are unchanged.

To re-enable, repeat steps 1–4 and toggle **Enabled** back to **On**.

---

## Scenario 2: Reset (wipe configuration and re-run setup)

Use this when you want to clear all stored configuration (admin password, API key, CV text) and start setup fresh, while keeping the Worker deployed.

### 2a. Delete KV keys via wrangler

```bash
wrangler kv:key delete --binding CHAT_KV config
wrangler kv:key delete --binding CHAT_KV secrets
wrangler kv:key delete --binding CHAT_KV admin_password_hash
wrangler kv:key delete --binding CHAT_KV cookie_signing_secret
```

These four keys hold the complete configuration state. After deletion the Worker returns a setup-required page on the next request.

### 2b. Re-run setup

1. Open your Worker URL (e.g. `https://askmycv.<your-subdomain>.workers.dev/`).
2. Visit `/setup` to re-enter your admin password, Anthropic API key, and CV markdown.
3. Submit the form. You will be redirected to `/admin` and logged in.

### 2c. (Optional) Rotate the Anthropic API key

If the reset was triggered by a credential compromise, also revoke the old key at https://console.anthropic.com/settings/keys and create a new one before running setup again.

---

## Scenario 3: Permanent delete

Use this when you want to completely remove the deployment and all associated resources.

### Step 1: Delete the Cloudflare Worker

1. Open https://dash.cloudflare.com/ and sign in.
2. Select **Workers & Pages** in the left sidebar.
3. Click the name of your Worker.
4. Select the **Settings** tab.
5. Scroll to the bottom and click **Delete Worker**.
6. Type the Worker name to confirm, then click **Delete**.

Reference: https://developers.cloudflare.com/workers/configuration/delete-a-worker/

### Step 2: Delete the KV namespace

1. In the Cloudflare dashboard, select **Workers & Pages**, then **KV**.
2. Locate the namespace bound to `CHAT_KV` (name set during deploy, often `askmycv-kv` or similar).
3. Click the three-dot menu next to the namespace and select **Delete**.
4. Confirm deletion.

Alternatively, delete via wrangler:

```bash
# List namespaces to find the ID
wrangler kv:namespace list

# Delete by ID (replace <NAMESPACE_ID> with the value from the list output)
wrangler kv:namespace delete --namespace-id <NAMESPACE_ID>
```

### Step 3: Delete your GitHub fork

1. Open https://github.com/settings/repositories
2. Click the name of your fork (e.g. `theclientzero-askmycv`).
3. Select **Settings**.
4. Scroll to the **Danger Zone** section and click **Delete this repository**.
5. Follow the confirmation prompts.

### Step 4: Revoke your Anthropic API key

1. Open https://console.anthropic.com/settings/keys
2. Locate the key used by this deployment.
3. Click **Revoke** and confirm.

After completing all four steps, no data from this deployment remains on Cloudflare or GitHub, and the Anthropic key is inactive.
