import { TOKENS, baseStyles, toCssVars } from "./design-tokens";
import { escapeHtml } from "./escape";

void TOKENS;

export interface LayoutProps {
  title: string;
  accentColor?: string;
  body: string;
  inlineScript?: string;
  theme?: 'light' | 'dark';
  description?: string;
}

const GOOGLE_FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=Instrument+Sans:wght@400;600&family=JetBrains+Mono:wght@400;500&display=swap";

export function renderLayout(props: LayoutProps): string {
  const script = props.inlineScript ? `<script>${props.inlineScript}</script>` : "";
  const theme = props.theme ?? 'light';
  const escapedTitle = escapeHtml(props.title);
  const escapedDesc = props.description ? escapeHtml(props.description) : "";
  const descMeta = escapedDesc
    ? `\n<meta name="description" content="${escapedDesc}" />`
    : "";
  return `<!doctype html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapedTitle}</title>
<meta property="og:title" content="${escapedTitle}" />
<meta name="twitter:card" content="summary" />${descMeta}
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="${GOOGLE_FONTS_URL}" />
<style>${toCssVars(props.accentColor)}${baseStyles()}</style>
</head>
<body>
<main class="page">${props.body}</main>
${script}
</body>
</html>`;
}
