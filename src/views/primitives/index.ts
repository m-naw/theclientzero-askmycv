/**
 * Reusable HTML primitives. All visual values resolve from
 * `design-tokens.ts` through CSS class names defined in that module's
 * `baseStyles()`; this file contains zero raw color/size literals.
 */
import { TOKENS } from "../design-tokens";
import { escapeAttr, escapeHtml } from "../escape";

// Anchor the token import as a runtime reference too — keeps tree-shakers
// from dropping it and makes the discipline visible at the symbol level.
void TOKENS;

export interface ButtonProps {
  label: string;
  type?: "submit" | "button";
  variant?: "primary" | "ghost";
  name?: string;
  value?: string;
}

export function button(props: ButtonProps): string {
  const cls = props.variant === "ghost" ? "btn btn-ghost" : "btn";
  const type = props.type ?? "button";
  const name = props.name ? ` name="${escapeAttr(props.name)}"` : "";
  const value = props.value !== undefined ? ` value="${escapeAttr(props.value)}"` : "";
  return `<button class="${cls}" type="${type}"${name}${value}>${escapeHtml(props.label)}</button>`;
}

export interface InputProps {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  value?: string;
  placeholder?: string;
  hint?: string;
  /** Raw HTML hint — rendered without escaping. Caller is responsible for safety. */
  hintHtml?: string;
  autocomplete?: string;
  invalid?: boolean;
}

export function input(props: InputProps): string {
  const type = props.type ?? "text";
  const req = props.required ? " required" : "";
  const value = props.value !== undefined ? ` value="${escapeAttr(props.value)}"` : "";
  const placeholder = props.placeholder ? ` placeholder="${escapeAttr(props.placeholder)}"` : "";
  const autocomplete = props.autocomplete ? ` autocomplete="${escapeAttr(props.autocomplete)}"` : "";
  const invalid = props.invalid ? ' aria-invalid="true" class="input input-invalid"' : ' class="input"';
  const hint = props.hintHtml
    ? `<span class="field-hint">${props.hintHtml}</span>`
    : props.hint
    ? `<span class="field-hint">${escapeHtml(props.hint)}</span>`
    : "";
  return `<label class="field">
  <span class="field-label">${escapeHtml(props.label)}</span>
  <input${invalid} name="${escapeAttr(props.name)}" type="${escapeAttr(type)}"${value}${placeholder}${autocomplete}${req} />
  ${hint}
</label>`;
}

export interface TextareaProps {
  name: string;
  label: string;
  required?: boolean;
  value?: string;
  placeholder?: string;
  hint?: string;
  rows?: number;
  invalid?: boolean;
}

export function textarea(props: TextareaProps): string {
  const req = props.required ? " required" : "";
  const rows = props.rows ? ` rows="${props.rows}"` : "";
  const placeholder = props.placeholder ? ` placeholder="${escapeAttr(props.placeholder)}"` : "";
  const hint = props.hint ? `<span class="field-hint">${escapeHtml(props.hint)}</span>` : "";
  const value = props.value !== undefined ? escapeHtml(props.value) : "";
  const invalidAttr = props.invalid ? ' aria-invalid="true"' : "";
  const cls = props.invalid ? "textarea input-invalid" : "textarea";
  return `<label class="field">
  <span class="field-label">${escapeHtml(props.label)}</span>
  <textarea class="${cls}" name="${escapeAttr(props.name)}"${rows}${placeholder}${req}${invalidAttr}>${value}</textarea>
  ${hint}
</label>`;
}

export function card(body: string): string {
  return `<section class="card">${body}</section>`;
}

export function chip(label: string, dataAttrs: Record<string, string> = {}): string {
  const data = Object.entries(dataAttrs)
    .map(([k, v]) => ` data-${escapeAttr(k)}="${escapeAttr(v)}"`)
    .join("");
  return `<button class="chip" type="button"${data}>${escapeHtml(label)}</button>`;
}

export function suggestedQuestionChip(question: string): string {
  return chip(question, { question });
}

export function citationChip(label: string = "[cv]"): string {
  return `<span class="citation-chip">${escapeHtml(label)}</span>`;
}

export function anchor(href: string, label: string): string {
  return `<a href="${escapeAttr(href)}" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

export function errorBanner(message: string): string {
  return `<div class="error-banner" role="alert">${escapeHtml(message)}</div>`;
}

export function warnBanner(message: string): string {
  return `<div class="warn-banner" role="alert">${escapeHtml(message)}</div>`;
}

export function streamedMessageBubble(role: "user" | "assistant", body: string): string {
  return `<div class="message message-${role}">${body}</div>`;
}
