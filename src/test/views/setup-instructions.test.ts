import { describe, expect, it } from "vitest";
import { renderSetupInstructions } from "../../views/setup-instructions";

describe("renderSetupInstructions", () => {
  const html = renderSetupInstructions();

  it("contains the literal 'Cloudflare Access'", () => {
    expect(html).toContain("Cloudflare Access");
  });

  it("references /setup and /admin paths", () => {
    expect(html).toContain("/setup");
    expect(html).toContain("/admin");
  });

  it("warns against gating the chat/root path", () => {
    expect(html).toMatch(/do NOT gate.*chat path|chat path.*NOT/i);
  });

  it("provides a continue affordance", () => {
    expect(html).toMatch(/Continue/i);
    expect(html).toMatch(/href="\/setup"/);
  });

  it("embeds a polling mechanism (setInterval) in the rendered HTML", () => {
    expect(html).toContain("setInterval");
  });
});
