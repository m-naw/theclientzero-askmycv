import { TOKENS } from "./design-tokens";
import { renderLayout } from "./layout";
import { errorBanner } from "./primitives/index";
import { escapeHtml } from "./escape";

void TOKENS;

export type AccessDenialReason =
  | "email_mismatch"
  | "aud_mismatch"
  | "team_domain_mismatch"
  | "signature_invalid"
  | "no_jwt";

export interface AccessDeniedProps {
  reason: AccessDenialReason;
  expectedEmail?: string;
}

const DENIAL_COPY: Record<AccessDenialReason, { title: string; body: string }> = {
  email_mismatch: {
    title: "Wrong account",
    body: "The Cloudflare Access session belongs to a different email than the one that completed setup. Sign out and sign back in with the owner's email, or update the Access policy.",
  },
  aud_mismatch: {
    title: "Wrong Access application",
    body: "The JWT audience (aud) does not match the Access application bound to this Worker at setup. Verify that /admin is served from the same Access application that issued your JWT.",
  },
  team_domain_mismatch: {
    title: "Wrong Cloudflare team",
    body: "The JWT was issued by a different Cloudflare team domain than the one recorded at setup. This usually means the Access app was moved to another account.",
  },
  signature_invalid: {
    title: "JWT signature invalid",
    body: "The Cloudflare Access JWT failed signature verification. The JWKS may have rotated. Reload this page; if the error persists, your Access application may be misconfigured.",
  },
  no_jwt: {
    title: "Not signed in to Cloudflare Access",
    body: "This route is gated by Cloudflare Access. Open your Access app, sign in with the owner email, then return here.",
  },
};

export function renderAccessDenied(props: AccessDeniedProps): string {
  const copy = DENIAL_COPY[props.reason];
  const expected = props.expectedEmail
    ? `<p class="muted">Expected identity: ${escapeHtml(props.expectedEmail)}</p>`
    : "";
  const body = `
<header><h1>${escapeHtml(copy.title)}</h1></header>
${errorBanner(`Access denied · reason: ${props.reason}`)}
<section class="card">
  <p>${escapeHtml(copy.body)}</p>
  ${expected}
</section>
`;
  return renderLayout({ title: `Access denied — ${props.reason}`, body });
}

export interface ExpiredSetupProps {
  setupWindowStart?: string;
}

export function renderExpiredSetup(props: ExpiredSetupProps = {}): string {
  // Compute expiration timestamp (start + 10 minutes) as UTC ISO8601.
  let expiredAtHtml = "";
  if (props.setupWindowStart) {
    const startMs = Number(props.setupWindowStart);
    if (Number.isFinite(startMs)) {
      const expiredAt = new Date(startMs + 600_000).toISOString();
      expiredAtHtml = `<p class="muted">Window expired at: <code>${escapeHtml(expiredAt)}</code> UTC (ISO 8601).</p>`;
    }
  }

  const body = `
<!-- Citation: F2 — expired setup window inline recovery (renderExpiredSetup) -->
<!-- Source: https://developers.cloudflare.com/kv/ verified 2026-05-18 -->
<header><h1>Setup window expired</h1></header>
${errorBanner("The 10-minute first-time setup window has expired.")}
<section class="card">
  <p>
    Once a Worker starts accepting requests it records a timestamp under the KV key
    <code>setup_window_start</code>. If configuration is not completed within the
    10-minute window, the Worker refuses further setup attempts so an attacker
    cannot race the owner.
  </p>
  ${expiredAtHtml}
  <h2>Recovery steps</h2>
  <ol>
    <li>Open <a href="https://dash.cloudflare.com" rel="noopener noreferrer">dash.cloudflare.com</a> and sign in to your Cloudflare account.</li>
    <li>In the left sidebar, navigate to <strong>Workers &amp; Pages → KV</strong>.</li>
    <li>Locate the <strong>STATE</strong> KV namespace that is bound to this Worker.</li>
    <li>Inside the STATE namespace, find the entry whose key is <code>setup_window_start</code>.</li>
    <li>Select the <code>setup_window_start</code> entry and click <strong>Delete</strong> to remove it.</li>
    <li>Return to this Worker's URL. The next request will record a fresh <code>setup_window_start</code> and open a new 10-minute window.</li>
    <li>Complete the setup form within that new 10-minute window.</li>
  </ol>
</section>
`;
  return renderLayout({ title: "Setup window expired — askmycv", body });
}
