import { describe, expect, it } from "vitest";
import { renderChatPage } from "../../views/chat-page";

describe("renderChatPage", () => {
  const baseProps = {
    display_name: "Jane Doe",
    headline: "Senior backend engineer",
    suggested_questions: [
      "Tell me about your background.",
      "What are your standout achievements?",
    ],
    theme: 'light' as const,
  };

  it("renders display_name and headline as plain text", () => {
    const html = renderChatPage(baseProps);
    expect(html).toContain("Jane Doe");
    expect(html).toContain("Senior backend engineer");
  });

  it("escapes HTML in display_name to prevent injection", () => {
    const html = renderChatPage({ ...baseProps, display_name: "<script>x</script>" });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders anchors with exact href values when URLs provided", () => {
    const html = renderChatPage({
      ...baseProps,
      linkedin_url: "https://linkedin.com/in/jane",
      github_url: "https://github.com/jane",
      pdf_cv_url: "https://example.com/cv.pdf",
      location: "Berlin",
    });
    expect(html).toContain('href="https://linkedin.com/in/jane"');
    expect(html).toContain('href="https://github.com/jane"');
    expect(html).toContain('href="https://example.com/cv.pdf"');
    expect(html).toContain("Berlin");
  });

  it("renders at least 2 suggested-question chip controls", () => {
    const html = renderChatPage(baseProps);
    const matches = html.match(/class="chip"/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("includes a textarea/input for the message and a submit button", () => {
    const html = renderChatPage(baseProps);
    expect(html).toMatch(/<textarea[^>]*name="message"/);
    expect(html).toMatch(/<button[^>]*type="submit"/);
  });

  it("includes a streamed-message bubble family with citation-chip styling", () => {
    const html = renderChatPage(baseProps);
    expect(html).toContain("message-list");
    expect(html).toContain("citation-chip");
    expect(html).toContain("[cv]");
  });

  it("honors optional accent_color in the inline CSS variables", () => {
    const html = renderChatPage({ ...baseProps, accent_color: "#aa11bb" });
    expect(html).toContain("--color-accent: #aa11bb");
  });

  it("throws when fewer than 2 suggested questions are provided", () => {
    expect(() =>
      renderChatPage({ ...baseProps, suggested_questions: ["only one"] }),
    ).toThrow();
  });
});
