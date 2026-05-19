import { describe, expect, it } from "vitest";
import { renderLayout, type LayoutProps } from "../../views/layout";

describe("renderLayout", () => {
  const baseProps: LayoutProps = {
    title: "Test Page",
    body: "<p>Hello</p>",
  };

  it("renders data-theme attribute defaulting to light", () => {
    const html = renderLayout(baseProps);
    expect(html).toContain('data-theme="light"');
  });

  it("renders data-theme=dark when theme is dark", () => {
    const html = renderLayout({ ...baseProps, theme: "dark" });
    expect(html).toContain('data-theme="dark"');
  });

  it("renders og:title meta tag with escaped title", () => {
    const html = renderLayout({ ...baseProps, title: 'Jane <Doe> & "Co"' });
    expect(html).toContain('og:title');
    expect(html).toContain("Jane &lt;Doe&gt; &amp; &quot;Co&quot;");
    expect(html).not.toContain('<Doe>');
  });

  it("renders twitter:card meta tag", () => {
    const html = renderLayout(baseProps);
    expect(html).toContain('twitter:card');
    expect(html).toContain('content="summary"');
  });

  it("renders Google Fonts stylesheet link", () => {
    const html = renderLayout(baseProps);
    expect(html).toContain("fonts.googleapis.com");
    expect(html).toContain("Fraunces");
    expect(html).toContain("Instrument+Sans");
    expect(html).toContain("JetBrains+Mono");
  });

  it("renders description meta tag when provided", () => {
    const html = renderLayout({ ...baseProps, description: "A great page" });
    expect(html).toContain('name="description"');
    expect(html).toContain("A great page");
  });

  it("omits description meta tag when not provided", () => {
    const html = renderLayout(baseProps);
    expect(html).not.toContain('name="description"');
  });

  it("HTML-escapes description content to prevent injection", () => {
    const html = renderLayout({ ...baseProps, description: '<script>alert("xss")</script>' });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders preconnect links for Google Fonts CDN", () => {
    const html = renderLayout(baseProps);
    expect(html).toContain('rel="preconnect"');
    expect(html).toContain("fonts.gstatic.com");
  });

  it("renders the provided body content", () => {
    const html = renderLayout({ ...baseProps, body: "<p>My Body</p>" });
    expect(html).toContain("<p>My Body</p>");
  });

  it("renders inlineScript when provided", () => {
    const html = renderLayout({ ...baseProps, inlineScript: "console.log('hi')" });
    expect(html).toContain("<script>console.log('hi')</script>");
  });

  it("omits script tag when inlineScript is not provided", () => {
    const html = renderLayout(baseProps);
    expect(html).not.toContain("<script>");
  });
});
