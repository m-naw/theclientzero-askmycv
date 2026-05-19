import { TOKENS } from "./design-tokens";
import { renderLayout } from "./layout";
import { anchor, citationChip, suggestedQuestionChip } from "./primitives/index";
import { escapeHtml } from "./escape";
import { CHAT_STREAMING_SCRIPT } from "./client/streaming";

void TOKENS;

// Canonical maintainer attribution. Required by AGPL-3.0 Section 7(b)
// additional terms — these constants and the footer they produce must
// remain in every deployed instance of this software.
export const MAINTAINER_GH_USERNAME = "m-naw";
export const MAINTAINER_REPO_NAME = "theclientzero-askmycv";
export const MAINTAINER_X_HANDLE = "TheClientZero";
const CANONICAL_REPO_URL = `https://github.com/${MAINTAINER_GH_USERNAME}/${MAINTAINER_REPO_NAME}`;
const CANONICAL_X_URL = `https://x.com/${MAINTAINER_X_HANDLE}`;

export interface ChatPageProps {
  display_name: string;
  headline: string;
  location?: string;
  linkedin_url?: string;
  github_url?: string;
  x_url?: string;
  pdf_cv_url?: string;
  suggested_questions: string[];
  accent_color?: string;
  theme: 'light' | 'dark';
}

function renderFooter(props: ChatPageProps): string {
  const repoLink = `<a href="${CANONICAL_REPO_URL}" rel="noopener noreferrer">${escapeHtml(MAINTAINER_REPO_NAME)}</a>`;
  const xLink = `<a href="${CANONICAL_X_URL}" rel="noopener noreferrer">@${escapeHtml(MAINTAINER_X_HANDLE)}</a>`;

  let deployedBy = "";
  const deployedHref = props.linkedin_url || props.github_url || props.x_url;
  if (deployedHref) {
    deployedBy = `<span class="sep">·</span><a href="${escapeHtml(deployedHref)}" rel="noopener noreferrer">Deployed by ${escapeHtml(props.display_name)}</a>`;
  }

  return `<footer class="page-footer" role="contentinfo">
  <span>Source: ${repoLink}</span>
  <span class="sep">·</span>
  <span>${xLink}</span>
  ${deployedBy}
  <span class="sep">·</span>
  <span>AGPL-3.0 — preserve this attribution.</span>
</footer>`;
}

export function renderChatPage(props: ChatPageProps): string {
  if (!Array.isArray(props.suggested_questions) || props.suggested_questions.length < 2) {
    throw new Error("renderChatPage: at least 2 suggested_questions required");
  }

  const anchors: string[] = [];
  if (props.linkedin_url) anchors.push(anchor(props.linkedin_url, "LinkedIn"));
  if (props.github_url) anchors.push(anchor(props.github_url, "GitHub"));
  if (props.pdf_cv_url) anchors.push(anchor(props.pdf_cv_url, "Download CV (PDF)"));

  const suggestions = props.suggested_questions
    .map((q) => suggestedQuestionChip(q))
    .join("\n  ");

  const body = `
<header>
  <h1>${escapeHtml(props.display_name)}</h1>
  <p class="muted">${escapeHtml(props.headline)}</p>
  ${props.location ? `<p class="muted">${escapeHtml(props.location)}</p>` : ""}
  ${anchors.length ? `<nav class="anchors">${anchors.join(" ")}</nav>` : ""}
</header>

<section aria-label="Suggested questions" class="suggestions">
  ${suggestions}
</section>

<section class="message-list" role="log" aria-live="polite" aria-label="Conversation"></section>

<form class="composer-form" autocomplete="off">
  <div class="composer">
    <textarea class="textarea" name="message" placeholder="Ask anything about my background…" aria-label="Your message"></textarea>
    <button class="btn" type="submit">Send</button>
  </div>
</form>

<template id="citation-template">${citationChip()}</template>

${renderFooter(props)}
`;

  return renderLayout({ theme: props.theme,
    title: `${props.display_name} — Ask my CV`,
    accentColor: props.accent_color,
    body,
    inlineScript: CHAT_STREAMING_SCRIPT,
  });
}
