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
  const start = props.setupWindowStart
    ? `<p class="muted">setup_window_start was recorded at <code>${escapeHtml(props.setupWindowStart)}</code>.</p>`
    : "";
  const body = `
<header><h1>Setup window expired</h1></header>
${errorBanner("The 30-minute first-time setup window has expired.")}
<section class="card">
  <p>
    Once a Worker starts accepting requests it records a timestamp under the KV key
    <code>setup_window_start</code>. If configuration is not completed within 30
    minutes of that timestamp, the Worker refuses further setup attempts so an
    attacker cannot race the owner.
  </p>
  ${start}
  <h2>Recovery</h2>
  <ol>
    <li>Open the <strong>Cloudflare dashboard</strong> for your account.</li>
    <li>Navigate to <strong>Workers &amp; Pages → KV</strong>, then open the <code>STATE</code> namespace bound to this Worker.</li>
    <li>Delete the entry whose key is <code>setup_window_start</code>.</li>
    <li>Reload this page. A fresh 30-minute window starts on the next request.</li>
  </ol>
</section>
`;
  return renderLayout({ title: "Setup window expired — askmycv", body });
}
