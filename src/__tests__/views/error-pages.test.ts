/**
 * Unit tests for src/views/error-pages.ts — SC1 and SC2 requirements.
 *
 * SC1: renderExpiredSetup
 *   - Contains "dash.cloudflare.com", "setup_window_start", "Delete", "STATE", "10-minute"
 *   - UTC ISO8601 timestamp rendered
 *   - >=6 <li> elements
 *   - HTML citation comment
 *   - No docs/ anchors
 *
 * SC2: renderLoginForm
 *   - Contains <details><summary>Forgot password</summary>
 *   - Inner >=6 <li> with "dash.cloudflare.com", "admin_password_hash", "Delete", "STATE"
 *   - HTML citation comment
 *   - No display_name leak when unauthenticated
 */

import { describe, it, expect } from "vitest";
import { renderExpiredSetup } from "../../views/error-pages";
import { renderLoginForm } from "../../views/login";

// ---------------------------------------------------------------------------
// renderExpiredSetup — SC1
// ---------------------------------------------------------------------------
describe("renderExpiredSetup (SC1)", () => {
  it("contains dash.cloudflare.com URL", () => {
    const html = renderExpiredSetup({});
    expect(html).toContain("dash.cloudflare.com");
  });

  it("contains setup_window_start literal", () => {
    const html = renderExpiredSetup({});
    expect(html).toContain("setup_window_start");
  });

  it('contains "Delete" action step', () => {
    const html = renderExpiredSetup({});
    expect(html).toContain("Delete");
  });

  it('contains "STATE" KV namespace reference', () => {
    const html = renderExpiredSetup({});
    expect(html).toContain("STATE");
  });

  it('labels window as "10-minute"', () => {
    const html = renderExpiredSetup({});
    expect(html).toContain("10-minute");
  });

  it("renders UTC ISO8601 expiration timestamp when setupWindowStart is provided", () => {
    // setup_window_start represents the start epoch ms
    const startMs = 1_700_000_000_000; // a fixed epoch timestamp
    const html = renderExpiredSetup({ setupWindowStart: String(startMs) });
    // Expiration = start + 10 min
    const expiredAt = new Date(startMs + 600_000).toISOString();
    expect(html).toContain(expiredAt);
  });

  it("has at least 6 <li> elements in recovery instructions", () => {
    const html = renderExpiredSetup({});
    const liMatches = html.match(/<li>/g) ?? [];
    expect(liMatches.length).toBeGreaterThanOrEqual(6);
  });

  it("contains an HTML citation comment", () => {
    const html = renderExpiredSetup({});
    // An HTML comment that looks like a citation (<!-- ... -->)
    expect(html).toMatch(/<!--.*?-->/s);
  });

  it("does not contain any docs/ anchor links", () => {
    const html = renderExpiredSetup({});
    expect(html).not.toMatch(/href=["'][^"']*docs\//);
    expect(html).not.toMatch(/docs\/[a-z]/);
  });

  it("contains admin_password_hash KV key in recovery steps", () => {
    const html = renderExpiredSetup({});
    expect(html).toContain("admin_password_hash");
  });
});

// ---------------------------------------------------------------------------
// renderLoginForm — SC2
// ---------------------------------------------------------------------------
describe("renderLoginForm (SC2)", () => {
  it("contains <details><summary>Forgot password</summary> block", () => {
    const html = renderLoginForm({});
    expect(html).toContain("<details");
    expect(html).toContain("<summary>Forgot password</summary>");
  });

  it("contains dash.cloudflare.com in forgot-password section", () => {
    const html = renderLoginForm({});
    expect(html).toContain("dash.cloudflare.com");
  });

  it("contains admin_password_hash in forgot-password section", () => {
    const html = renderLoginForm({});
    expect(html).toContain("admin_password_hash");
  });

  it('contains "Delete" action step in forgot-password section', () => {
    const html = renderLoginForm({});
    expect(html).toContain("Delete");
  });

  it('contains "STATE" KV namespace reference in forgot-password section', () => {
    const html = renderLoginForm({});
    expect(html).toContain("STATE");
  });

  it("has at least 6 <li> elements in forgot-password recovery steps", () => {
    const html = renderLoginForm({});
    const liMatches = html.match(/<li>/g) ?? [];
    expect(liMatches.length).toBeGreaterThanOrEqual(6);
  });

  it("contains an HTML citation comment", () => {
    const html = renderLoginForm({});
    expect(html).toMatch(/<!--.*?-->/s);
  });

  it("does not contain any docs/ anchor links", () => {
    const html = renderLoginForm({});
    expect(html).not.toMatch(/href=["'][^"']*docs\//);
    expect(html).not.toMatch(/docs\/[a-z]/);
  });

  it("does not leak display_name when called without credentials", () => {
    const html = renderLoginForm({});
    // No display_name field or user-specific info should appear
    expect(html).not.toContain("display_name");
  });
});
