import { TOKENS } from "./design-tokens";
import { renderConfigForm, type SetupFormFields } from "./setup-form";
import { button, input } from "./primitives/index";

void TOKENS;

export interface AdminFormProps {
  prefill: SetupFormFields;
  email?: string;
}

export function renderAdminForm(props: AdminFormProps): string {
  const intro = props.email
    ? `Signed in as ${props.email}. Update any field below; leave the Anthropic API key blank to keep the existing one.`
    : "Leave the Anthropic API key blank to keep the existing one.";

  const configHtml = renderConfigForm({
    mode: "admin",
    action: "/admin/save",
    title: "Admin — askmycv",
    intro,
    prefill: props.prefill,
    apiKeyRequired: false,
    apiKeyHint: "Leave blank to keep the existing key. Provide a new value only when rotating.",
  });

  // The renderConfigForm wraps in a full page layout; we need to inject the
  // Danger Zone section before the closing </body> tag.
  const dangerZone = `
<section class="card" style="border-color: var(--color-error);">
  <h2 style="color: var(--color-error);">Danger zone</h2>
  <p class="muted">Permanently deletes all configuration, API key, password, and session secrets from KV. This cannot be undone.</p>
  <form method="POST" action="/admin/reset" autocomplete="off">
    ${input({
      name: "current_password",
      label: "Current password",
      type: "password",
      required: true,
      autocomplete: "off",
      placeholder: "Enter your current admin password",
    })}
    ${input({
      name: "confirm",
      label: "Type DELETE ALL CONFIG to confirm",
      required: true,
      autocomplete: "off",
      placeholder: "DELETE ALL CONFIG",
      hint: "Must be the exact phrase: DELETE ALL CONFIG",
    })}
    ${button({ label: "Reset all configuration", type: "submit", variant: "ghost" })}
  </form>
</section>
`;

  return configHtml.replace("</body>", `${dangerZone}\n</body>`);
}

