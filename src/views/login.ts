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
</main>
`;

  return renderLayout({
    title: "Admin Login",
    accentColor: opts.accentColor,
    body,
  });
}
