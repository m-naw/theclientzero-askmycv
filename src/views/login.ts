/**
 * Login form view.
 *
 * Renders a minimal HTML page with a password input for admin login.
 * The form POSTs to /login. The Anthropic API key is never present here.
 */

import { TOKENS } from "./design-tokens";
import { renderLayout } from "./layout";
import { input, button } from "./primitives/index";
import { escapeHtml } from "./escape";

void TOKENS;

export interface LoginFormProps {
  /** Optional error message to display above the form. */
  error?: string;
  /** Optional accent color. */
  accentColor?: string;
}

/**
 * Render the admin login form page.
 *
 * Contains:
 *   - `<input type="password" name="admin_password">`
 *   - POST action=/login
 */
export function renderLoginForm(opts: LoginFormProps = {}): string {
  const errorHtml = opts.error
    ? `<div class="error-banner" role="alert">${escapeHtml(opts.error)}</div>`
    : "";

  const body = `
<!-- Citation: F19 — admin login forgot-password expandable (renderLoginForm) -->
<!-- Source: https://developers.cloudflare.com/kv/ verified 2026-05-18 -->
<main class="centered-form">
  <h1 class="form-title">Admin Login</h1>
  ${errorHtml}
  <form method="POST" action="/login" class="form-card">
    ${input({
      name: "admin_password",
      label: "Admin password",
      type: "password",
      required: true,
      placeholder: "Enter admin password",
      autocomplete: "current-password",
    })}
    ${button({ label: "Sign in", type: "submit", variant: "primary" })}
  </form>
  <details class="forgot-password">
    <summary>Forgot password</summary>
    <div class="forgot-password-content">
      <p>Admin passwords cannot be reset via email. To regain access, reset the stored credential in Cloudflare KV:</p>
      <ol>
        <li>Open <a href="https://dash.cloudflare.com" rel="noopener noreferrer">dash.cloudflare.com</a> and sign in to your Cloudflare account.</li>
        <li>In the left sidebar, navigate to <strong>Workers &amp; Pages → KV</strong>.</li>
        <li>Locate the <strong>STATE</strong> KV namespace bound to this Worker.</li>
        <li>Inside the STATE namespace, find the entry whose key is <code>admin_password_hash</code>.</li>
        <li>Select the <code>admin_password_hash</code> entry and click <strong>Delete</strong> to remove it.</li>
        <li>Also Delete the <code>config</code> entry from the STATE namespace to reset the Worker to setup mode.</li>
        <li>Return to the Worker root URL and complete the setup form again with a new admin password.</li>
      </ol>
      <p>Alternatively, using the <a href="https://developers.cloudflare.com/workers/wrangler/" rel="noopener noreferrer">wrangler</a> CLI from your local checkout:</p>
      <pre><code>wrangler kv key delete --binding=STATE admin_password_hash
wrangler kv key delete --binding=STATE config</code></pre>
    </div>
  </details>
</main>
`;

  return renderLayout({
    title: "Admin Login",
    accentColor: opts.accentColor,
    body,
  });
}
