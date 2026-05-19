import { TOKENS } from "./design-tokens";
import { renderLayout } from "./layout";
import { ACCESS_POLL_SCRIPT } from "./client/polling";

void TOKENS;

export interface SetupInstructionsProps {
  workerUrl?: string;
}

export function renderSetupInstructions(_props: SetupInstructionsProps = {}): string {
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const body = `
<header>
  <h1>Welcome to askmycv</h1>
  <p class="muted">Your personal AI-powered CV chat — let visitors ask questions and get instant, sourced answers from your CV.</p>
  <p class="muted">One-time setup. Takes about 3 minutes. You have 10 minutes to complete setup (security window).</p>
</header>

<section class="card">
  <h2>What you're setting up</h2>
  <ul>
    <li>Your <strong>display name</strong> and headline shown to visitors</li>
    <li>Your <strong>CV content</strong> in markdown — the only knowledge the assistant uses</li>
    <li>An <strong>Anthropic API key</strong> to power the chat model</li>
    <li>A <strong>daily budget</strong> to cap API spend</li>
    <li>An <strong>admin password</strong> to protect your configuration</li>
  </ul>
  <p class="muted">A $5 top-up at platform.claude.com is sufficient for approximately 5,000 conversations.</p>
</section>

<a class="btn" href="/setup">Continue — get started with askmycv</a>

<details class="advanced" style="margin-top: var(--space-5);">
  <summary>Optional: Cloudflare Access (defense-in-depth)</summary>
  <p>Cloudflare Access adds a second authentication layer in front of <code>/setup</code> and <code>/admin</code>. It is entirely optional — askmycv works securely with admin-password authentication alone. If you want the extra layer:</p>
  <ol>
    <li>Open the <strong>Cloudflare Access</strong> dashboard for your account.</li>
    <li>Create an Access application covering <code>/setup</code> and <code>/admin</code> on this Worker's hostname.</li>
    <li>Add an email policy with your own email address as the only allowed identity.</li>
    <li>Save the application. Cloudflare Access begins issuing JWTs that askmycv will verify automatically.</li>
  </ol>
  <p><strong>Important:</strong> do NOT gate the chat path (<code>/</code>) with Cloudflare Access — visitors must reach the public chat without authentication. Only <code>/setup</code> and <code>/admin</code> should be gated.</p>
</details>
<p class="muted footer-timestamp">Page generated: ${ts}</p>
`;

  return renderLayout({
    title: "Welcome to askmycv",
    body,
    inlineScript: ACCESS_POLL_SCRIPT,
  });
}
