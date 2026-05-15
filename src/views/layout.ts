import { TOKENS, baseStyles, toCssVars } from "./design-tokens";
import { escapeHtml } from "./escape";

void TOKENS;

export interface LayoutProps {
  title: string;
  accentColor?: string;
  body: string;
  inlineScript?: string;
}

export function renderLayout(props: LayoutProps): string {
  const script = props.inlineScript ? `<script>${props.inlineScript}</script>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(props.title)}</title>
<style>${toCssVars(props.accentColor)}${baseStyles()}</style>
</head>
<body>
<main class="page">${props.body}</main>
${script}
</body>
</html>`;
}
