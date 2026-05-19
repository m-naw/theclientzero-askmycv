/**
 * Admin login form view.
 *
 * Renders a minimal HTML page with a password input for admin login.
 * The form POSTs to /admin/login. Embeds an optional `next` hidden field
 * so the successful login redirect preserves the intended destination.
 *
 * The Anthropic API key is never present here.
 */

import { renderLayout } from "./layout";
import { input, button } from "./primitives/index";
import { escapeHtml } from "./escape";

export interface AdminLoginFormProps {
  /** Optional error message to display above the form. */
  error?: string;
  /** Optional same-origin destination path after successful login. */
  next?: string;
  /** Optional accent color. */
  accentColor?: string;
}

/**
 * Render the admin login form page.
 *
 * Contains:
 *   - `<input type="password" name="password">`
 *   - Optional `<input type="hidden" name="next" value="<sanitized>">`
 *   - POST action=/admin/login
 */
export function renderAdminLoginForm(opts: AdminLoginFormProps = {}): string {
  const errorHtml = opts.error
    ? `<div class="error-banner" role="alert">${escapeHtml(opts.error)}</div>`
    : "";

  const nextHtml = opts.next
    ? `<input type="hidden" name="next" value="${escapeHtml(opts.next)}">`
    : "";

  const body = `
<main class="centered-form">
  <h1 class="form-title">Admin Login</h1>
  ${errorHtml}
  <form method="POST" action="/admin/login" class="form-card">
    ${nextHtml}
    ${input({
      name: "password",
      label: "Admin password",
      type: "password",
      required: true,
      placeholder: "Enter admin password",
      autocomplete: "current-password",
    })}
    ${button({ label: "Sign in", type: "submit", variant: "primary" })}
  </form>
</main>
`;

  return renderLayout({
    title: "Admin Login",
    accentColor: opts.accentColor,
    body,
  });
}
