# Cloudflare Access — Setup and Fallback Guide

Last verified: 2026-05-18

---

## When Cloudflare Access is useful

Cloudflare Access adds an identity layer in front of your Worker. It is most useful when:

- **Shared networks**: You are deploying from a university, corporate, or shared office network where other users could reach your Worker URL. Access adds an email allow-list or SSO requirement before any request reaches `/admin`.
- **Team environments**: Multiple people need to reach the admin interface; Access lets you grant access by email or identity provider group without sharing a single password.
- **Hardware key enforcement**: You want to require YubiKey or FIDO2 authentication in addition to the admin password.
- **Audit trail**: Access logs every authentication event including identity, timestamp, and IP; useful for compliance requirements.

For a single-operator personal deployment on a private network, the default password-only mode is sufficient. Access is a progressive enhancement and can be added or removed at any time without changing the Worker code.

---

## Step-by-step setup

### Prerequisites

- A Cloudflare account with your Worker already deployed.
- Your team domain configured in Zero Trust (e.g. `yourteam.cloudflareaccess.com`).

### Step 1: Open Zero Trust

1. Sign in at https://one.cloudflare.com/
2. In the left sidebar, select **Zero Trust**.
3. If prompted, complete the team domain setup by entering a subdomain name (e.g. `yourteam`). This becomes `yourteam.cloudflareaccess.com`.

### Step 2: Create an Access Application

1. In the Zero Trust dashboard, select **Access** in the left sidebar, then **Applications**.
2. Click **Add an application**.
3. Select **Self-hosted**.

Reference: https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-apps/

4. Under **Application name**, enter a descriptive name (e.g. `AskMyCV Admin`).
5. Under **Application domain**, enter your Worker's hostname (e.g. `askmycv.yoursubdomain.workers.dev`).
6. Under **Path**, enter `/admin` to protect only admin routes. Add a second entry for `/setup`.
7. Click **Next**.

### Step 3: Create an Access Policy

1. Under **Policy name**, enter a name (e.g. `Owner only`).
2. Under **Action**, select **Allow**.
3. Under **Configure rules**, add an **Include** rule:
   - **Selector**: `Emails`
   - **Value**: enter your email address (the address you use to log into Cloudflare).
4. Click **Next**, review the summary, then click **Add application**.

### Step 4: Verify the Worker detects the JWT

After Access is configured, the next request to `/admin` or `/setup` will be intercepted by Cloudflare Access. After you authenticate with Access, Cloudflare injects a `CF-Access-Jwt-Assertion` header into the forwarded request.

The Worker auto-detects this header. No configuration change is needed.

---

## Verification procedure

### Check that the JWT header reaches the Worker

1. Open the Cloudflare dashboard at https://dash.cloudflare.com/
2. Select **Workers & Pages**, then click your Worker name.
3. Select the **Logs** tab (or use `wrangler tail` in your terminal).
4. Authenticate through Cloudflare Access and load your Worker URL.
5. In the log stream, confirm that `CF-Access-Jwt-Assertion` appears in the request headers for `/admin` or `/setup` requests.

If `CF-Access-Jwt-Assertion` is present in the logs, the Worker has received the JWT and will attempt to verify it.

### Confirm rejection of unprotected requests

With Access enabled, a direct request to `/admin` without going through Access (e.g. using `curl` without an Access token) should receive a `403` response from the Cloudflare Access layer before the request reaches the Worker.

```bash
curl -I https://askmycv.yoursubdomain.workers.dev/admin
# Expected: HTTP/2 403 from Cloudflare Access
```

---

## Removing Cloudflare Access

To remove Access and revert to password-only mode:

1. Open https://one.cloudflare.com/ and navigate to **Zero Trust** → **Access** → **Applications**.
2. Click the three-dot menu next to the application you created and select **Delete**.
3. Confirm deletion.

The Worker will stop receiving `CF-Access-Jwt-Assertion` headers and will operate in password-only mode automatically. No Worker code change is required.
