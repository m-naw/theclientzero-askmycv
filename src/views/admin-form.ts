import { TOKENS } from "./design-tokens";
import { renderConfigForm, type SetupFormFields } from "./setup-form";

void TOKENS;

export interface AdminFormProps {
  prefill: SetupFormFields;
  email?: string;
}

export function renderAdminForm(props: AdminFormProps): string {
  const intro = props.email
    ? `Signed in as ${props.email}. Update any field below; leave the Anthropic API key blank to keep the existing one.`
    : "Leave the Anthropic API key blank to keep the existing one.";

  return renderConfigForm({
    mode: "admin",
    action: "/admin/save",
    title: "Admin — askmycv",
    intro,
    prefill: props.prefill,
    apiKeyRequired: false,
    apiKeyHint: "Leave blank to keep the existing key. Provide a new value only when rotating.",
  });
}
