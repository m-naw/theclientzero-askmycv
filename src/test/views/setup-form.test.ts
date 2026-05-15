import { describe, expect, it } from "vitest";
import { renderSetupForm } from "../../views/setup-form";

describe("renderSetupForm", () => {
  const html = renderSetupForm();

  it("renders the four required field names", () => {
    expect(html).toMatch(/name="display_name"[^>]*required/);
    expect(html).toMatch(/name="headline"[^>]*required/);
    expect(html).toMatch(/name="anthropic_api_key"[^>]*required/);
    expect(html).toMatch(/name="cv_markdown"[^>]*required/);
  });

  it("renders the five optional field names", () => {
    expect(html).toContain('name="location"');
    expect(html).toContain('name="linkedin_url"');
    expect(html).toContain('name="github_url"');
    expect(html).toContain('name="pdf_cv_url"');
    expect(html).toContain('name="accent_color"');
  });

  it("wraps advanced fields in a collapsible <details> section", () => {
    expect(html).toMatch(/<details[^>]*class="advanced"/);
    const detailsBlock = html.slice(html.indexOf("<details"), html.indexOf("</details>"));
    expect(detailsBlock).toContain('name="model"');
    expect(detailsBlock).toContain('name="daily_budget_usd"');
    expect(detailsBlock).toContain('name="max_msgs_per_hour"');
  });

  it("posts to /setup", () => {
    expect(html).toMatch(/<form[^>]*method="POST"[^>]*action="\/setup"/);
  });

  it("does not leak a pre-filled api key value when prefill provided", () => {
    const out = renderSetupForm({
      prefill: { display_name: "Jane", anthropic_api_key: "sk-ant-SECRET" },
    });
    expect(out).toContain('value="Jane"');
    expect(out).not.toContain("sk-ant-SECRET");
  });
});
