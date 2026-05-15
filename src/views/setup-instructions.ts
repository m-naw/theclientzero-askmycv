import { TOKENS } from "./design-tokens";
import { renderLayout } from "./layout";
import { warnBanner } from "./primitives/index";
import { ACCESS_POLL_SCRIPT } from "./client/polling";

void TOKENS;

export interface SetupInstructionsProps {
  workerUrl?: string;
}

export function renderSetupInstructions(_props: SetupInstructionsProps = {}): string {
  const body = `
<header>
  <h1>Configure Cloudflare Access</h1>
  <p class="muted">One-time setup. Takes about 3 minutes.</p>
</header>

${warnBanner(
  "Important: do NOT gate the chat path (/) with Cloudflare Access. Only the owner routes /setup and /admin should require authentication. If you gate the root path, visitors cannot reach the public chat.",
)}

<section class="card">
  <h2>Steps</h2>
  <ol>
    <li>Open the <strong>Cloudflare Access</strong> dashboard for your account.</li>
    <li>Create an Access application that covers <code>/setup</code> and <code>/admin</code> on this Worker's hostname.</li>
    <li>Add an email policy with your own email address as the only allowed identity.</li>
    <li>Save the application. Cloudflare Access begins issuing JWTs.</li>
    <li>Click <em>Continue</em> below — this page polls in the background and will refresh automatically once it sees your authenticated session.</li>
  </ol>
</section>

<section class="card">
  <h2>What gets gated</h2>
  <ul>
    <li><code>/setup</code> — first-time configuration form (this is what you will see next).</li>
    <li><code>/admin</code> — edit your configuration later.</li>
    <li><code>/</code> — leave this <strong>public</strong>; it serves the visitor-facing chat page.</li>
  </ul>
</section>

<a class="btn" href="/setup">Continue — I've configured Cloudflare Access</a>
`;

  return renderLayout({
    title: "Set up Cloudflare Access — askmycv",
    body,
    inlineScript: ACCESS_POLL_SCRIPT,
  });
}
