import { TOKENS } from "./design-tokens";
import { renderLayout } from "./layout";
import { button, input, textarea } from "./primitives/index";

void TOKENS;

export interface SetupFormFields {
  display_name?: string;
  headline?: string;
  anthropic_api_key?: string;
  cv_markdown?: string;
  location?: string;
  linkedin_url?: string;
  github_url?: string;
  pdf_cv_url?: string;
  accent_color?: string;
  model?: string;
  admin_password?: string;
  theme?: 'light' | 'dark';
  daily_budget_usd?: number | string;
  max_msgs_per_hour?: number | string;
}

export interface FormVariantOptions {
  mode: "setup" | "admin";
  action: string;
  title: string;
  intro?: string;
  prefill?: SetupFormFields;
  apiKeyRequired: boolean;
  apiKeyHint?: string;
}

export function renderConfigForm(opts: FormVariantOptions): string {
  const p = opts.prefill ?? {};
  const asString = (v: unknown): string | undefined =>
    v === undefined || v === null ? undefined : String(v);

  const requiredFields = [
    input({
      name: "display_name",
      label: "Display name",
      required: true,
      value: p.display_name,
      placeholder: "Jane Doe",
    }),
    input({
      name: "headline",
      label: "Headline",
      required: true,
      value: p.headline,
      placeholder: "Senior backend engineer · Berlin",
    }),
    input({
      name: "anthropic_api_key",
      label: "Anthropic API key",
      type: "password",
      required: opts.apiKeyRequired,
      placeholder: opts.apiKeyRequired ? "sk-ant-…" : "leave blank to keep existing",
      hint: opts.apiKeyHint,
      autocomplete: "off",
    }),
    `<label class="field">
  <span class="field-label">Theme</span>
  <select class="input" name="theme" required>
    <option value="light"${(p.theme ?? 'light') === 'light' ? ' selected' : ''}>Light</option>
    <option value="dark"${p.theme === 'dark' ? ' selected' : ''}>Dark</option>
  </select>
</label>`,
    input({
      name: 'admin_password',
      label: 'Admin password',
      type: 'password',
      required: true,
      hint: '12–128 characters',
      autocomplete: 'off',
    }),
    textarea({
      name: "cv_markdown",
      label: "CV in markdown",
      required: true,
      rows: 16,
      value: p.cv_markdown,
      placeholder: "# Jane Doe\\n\\n## Experience\\n…",
      hint: "200–50,000 characters. This is the only knowledge the assistant uses.",
    }),
  ].join("\n");

  const optionalFields = [
    input({ name: "location", label: "Location (optional)", value: p.location }),
    input({
      name: "linkedin_url",
      label: "LinkedIn URL (optional)",
      type: "url",
      value: p.linkedin_url,
    }),
    input({
      name: "github_url",
      label: "GitHub URL (optional)",
      type: "url",
      value: p.github_url,
    }),
    input({
      name: "pdf_cv_url",
      label: "PDF CV URL (optional)",
      type: "url",
      value: p.pdf_cv_url,
    }),
    input({
      name: "accent_color",
      label: "Accent color (optional, hex like rrggbb with leading hash)",
      value: p.accent_color,
      placeholder: "e.g. blue, green, your brand color",
      hint: "Hex color (3 or 6 digits). Used as the page accent.",
    }),
  ].join("\n");

  const modelValue = p.model ?? "claude-haiku-4-5-20251001";
  const advancedFields = `
<label class="field">
  <span class="field-label">Model</span>
  <select class="input" name="model">
    <option value="claude-haiku-4-5-20251001"${modelValue === "claude-haiku-4-5-20251001" ? " selected" : ""}>Claude Haiku 4.5 (recommended)</option>
    <option value="claude-sonnet-4-6"${modelValue === "claude-sonnet-4-6" ? " selected" : ""}>Claude Sonnet 4.6</option>
  </select>
  <span class="field-hint">Haiku is roughly 3× cheaper. Switch to Sonnet for higher-quality answers.</span>
</label>
${input({
  name: "daily_budget_usd",
  label: "Daily budget (USD)",
  type: "number",
  value: asString(p.daily_budget_usd) ?? "5",
  hint: "Hard cap on Anthropic spend per UTC day. Range 0.50–100.",
})}
${input({
  name: "max_msgs_per_hour",
  label: "Max messages per IP per hour",
  type: "number",
  value: asString(p.max_msgs_per_hour) ?? "30",
  hint: "Anti-abuse limit. Range 5–300.",
})}
`;

  const intro = opts.intro ? `<p class="muted">${opts.intro}</p>` : "";

  const body = `
<header>
  <h1>${opts.mode === "setup" ? "First-time setup" : "Edit configuration"}</h1>
  ${intro}
</header>

<form method="POST" action="${opts.action}" autocomplete="off">
  <section class="card">
    <h2>Required</h2>
    ${requiredFields}
  </section>

  <section class="card">
    <h2>Optional</h2>
    ${optionalFields}
  </section>

  <details class="advanced">
    <summary>Advanced — model, budget, rate limits</summary>
    ${advancedFields}
  </details>

  ${button({ label: opts.mode === "setup" ? "Save and go live" : "Save changes", type: "submit", variant: "primary" })}
</form>
`;

  return renderLayout({
    title: opts.title,
    accentColor: p.accent_color,
    body,
  });
}

export interface SetupFormProps {
  prefill?: SetupFormFields;
  email?: string;
}

export function renderSetupForm(props: SetupFormProps = {}): string {
  const intro = props.email
    ? `Authenticated as ${props.email}. Fill in the form below to bring your CV chat online.`
    : "Fill in the form below to bring your CV chat online.";
  return renderConfigForm({
    mode: "setup",
    action: "/setup",
    title: "First-time setup — askmycv",
    intro,
    prefill: props.prefill,
    apiKeyRequired: true,
  });
}
