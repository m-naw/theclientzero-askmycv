import { describe, expect, it } from "vitest";
import { renderAdminForm } from "../../views/admin-form";

describe("renderAdminForm", () => {
  const prefill = {
    display_name: "Jane Doe",
    headline: "Senior backend engineer",
    location: "Berlin",
    linkedin_url: "https://linkedin.com/in/jane",
    github_url: "https://github.com/jane",
    pdf_cv_url: "https://example.com/cv.pdf",
    accent_color: "#aa11bb",
    cv_markdown: "# Jane Doe\n\nExperience…",
    model: "claude-sonnet-4-6",
    daily_budget_usd: 7,
    max_msgs_per_hour: 25,
  };

  const html = renderAdminForm({ prefill, email: "owner@example.com" });

  it("renders all field names (same set as setup form)", () => {
    for (const field of [
      "display_name",
      "headline",
      "anthropic_api_key",
      "cv_markdown",
      "location",
      "linkedin_url",
      "github_url",
      "pdf_cv_url",
      "accent_color",
      "model",
      "daily_budget_usd",
      "max_msgs_per_hour",
    ]) {
      expect(html).toContain(`name="${field}"`);
    }
  });

  it("pre-fills values from provided config", () => {
    expect(html).toContain('value="Jane Doe"');
    expect(html).toContain('value="Berlin"');
    expect(html).toContain('value="https://linkedin.com/in/jane"');
    expect(html).toContain('value="#aa11bb"');
    expect(html).toContain('value="7"');
    expect(html).toContain("Jane Doe");
  });

  it("treats anthropic_api_key as optional (no required attribute)", () => {
    const apiKeyBlock = html.slice(html.indexOf('name="anthropic_api_key"'));
    const closeTag = apiKeyBlock.slice(0, apiKeyBlock.indexOf(">"));
    expect(closeTag).not.toContain("required");
  });

  it("shows helper text explaining empty = no change for api key", () => {
    expect(html).toMatch(/leave.*blank.*keep|keep.*existing/i);
  });

  it("posts to /admin/save", () => {
    expect(html).toMatch(/<form[^>]*method="POST"[^>]*action="\/admin\/save"/);
  });

  it("honors the accent_color from prefill in CSS vars", () => {
    expect(html).toContain("--color-accent: #aa11bb");
  });
});
