import { TOKENS } from "./design-tokens";
import { renderLayout } from "./layout";
import { anchor, citationChip, suggestedQuestionChip } from "./primitives/index";
import { escapeHtml } from "./escape";
import { CHAT_STREAMING_SCRIPT } from "./client/streaming";

void TOKENS;

export interface ChatPageProps {
  display_name: string;
  headline: string;
  location?: string;
  linkedin_url?: string;
  github_url?: string;
  pdf_cv_url?: string;
  suggested_questions: string[];
  accent_color?: string;
}

export function renderChatPage(props: ChatPageProps): string {
  if (!Array.isArray(props.suggested_questions) || props.suggested_questions.length < 3) {
    throw new Error("renderChatPage: at least 3 suggested_questions required");
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
`;

  return renderLayout({
    title: `${props.display_name} — Ask my CV`,
    accentColor: props.accent_color,
    body,
    inlineScript: CHAT_STREAMING_SCRIPT,
  });
}
