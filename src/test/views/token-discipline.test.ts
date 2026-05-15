import { describe, expect, it } from "vitest";

// Vite raw glob imports — file contents available as strings at test time
// without touching Node's fs (which is not in the Workers runtime).
// Vite augments import.meta with `glob`; the Workers types do not. Cast to
// the Vite shape locally so the rest of the file stays strictly typed.
type ViteMeta = ImportMeta & {
  glob: (
    pattern: string,
    opts: { query: string; import: string; eager: boolean },
  ) => Record<string, string>;
};
const viewFiles = (import.meta as ViteMeta).glob("../../views/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

const TOKEN_DEFINITION_KEY = Object.keys(viewFiles).find((k) => k.endsWith("/design-tokens.ts"));
if (!TOKEN_DEFINITION_KEY) {
  throw new Error("token-discipline test could not locate design-tokens.ts");
}

const templateEntries = Object.entries(viewFiles).filter(
  ([k]) => k !== TOKEN_DEFINITION_KEY,
);

describe("token discipline across src/views/", () => {
  it("design-tokens.ts is the only file with raw hex literals", () => {
    const violators: Array<{ file: string; line: number; text: string }> = [];
    for (const [file, content] of templateEntries) {
      content.split("\n").forEach((line, i) => {
        if (/#[0-9a-fA-F]{3,8}\b/.test(line)) {
          violators.push({ file, line: i + 1, text: line.trim() });
        }
      });
    }
    expect(violators, JSON.stringify(violators, null, 2)).toEqual([]);
  });

  it("design-tokens.ts is the only file with raw px/rem literals", () => {
    const violators: Array<{ file: string; line: number; text: string }> = [];
    for (const [file, content] of templateEntries) {
      content.split("\n").forEach((line, i) => {
        if (/\b[0-9]+(px|rem)\b/.test(line)) {
          violators.push({ file, line: i + 1, text: line.trim() });
        }
      });
    }
    expect(violators, JSON.stringify(violators, null, 2)).toEqual([]);
  });

  it("every non-token view file imports from ./design-tokens", () => {
    const missing: string[] = [];
    for (const [file, content] of templateEntries) {
      const importsTokens = /from\s+["']\.{1,2}\/(?:[^"']*\/)?design-tokens["']/.test(content);
      if (!importsTokens) missing.push(file);
    }
    expect(missing).toEqual([]);
  });

  it("design-tokens.ts exports TOKENS and toCssVars symbols", () => {
    const tokens = viewFiles[TOKEN_DEFINITION_KEY];
    expect(tokens).toMatch(/export const TOKENS\b/);
    expect(tokens).toMatch(/export function toCssVars\b/);
  });
});
