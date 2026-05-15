import { describe, expect, it } from "vitest";
import {
  renderAccessDenied,
  renderExpiredSetup,
  type AccessDenialReason,
} from "../../views/error-pages";

describe("renderExpiredSetup", () => {
  const html = renderExpiredSetup({ setupWindowStart: "2026-05-15T10:00:00Z" });

  it("names the expired setup window", () => {
    expect(html).toMatch(/expired/i);
    expect(html).toMatch(/setup window/i);
  });

  it("references the setup_window_start KV key by name", () => {
    expect(html).toContain("setup_window_start");
  });

  it("references the Cloudflare dashboard recovery path", () => {
    expect(html).toMatch(/Cloudflare dashboard/i);
    expect(html).toMatch(/KV/i);
  });

  it("renders without crashing when no timestamp is provided", () => {
    expect(renderExpiredSetup()).toContain("setup_window_start");
  });
});

describe("renderAccessDenied", () => {
  const reasons: AccessDenialReason[] = [
    "email_mismatch",
    "aud_mismatch",
    "team_domain_mismatch",
    "signature_invalid",
    "no_jwt",
  ];

  it("renders distinct wording per reason for all five reasons", () => {
    const bodies = new Map<string, string>();
    for (const reason of reasons) {
      const html = renderAccessDenied({ reason });
      expect(html).toContain(reason);
      bodies.set(reason, html);
    }
    const stripped = Array.from(bodies.values()).map((h) => {
      const start = h.indexOf("<section");
      const end = h.indexOf("</section>");
      return h.slice(start, end);
    });
    const unique = new Set(stripped);
    expect(unique.size).toBe(reasons.length);
  });

  it("email_mismatch wording mentions email and signing in with the owner identity", () => {
    const html = renderAccessDenied({
      reason: "email_mismatch",
      expectedEmail: "owner@example.com",
    });
    expect(html).toMatch(/email/i);
    expect(html).toContain("owner@example.com");
  });

  it("aud_mismatch wording references the Access application audience", () => {
    expect(renderAccessDenied({ reason: "aud_mismatch" })).toMatch(/audience|aud|Access application/i);
  });

  it("no_jwt wording instructs the visitor to sign in to Cloudflare Access", () => {
    expect(renderAccessDenied({ reason: "no_jwt" })).toMatch(/sign in|Cloudflare Access/i);
  });
});
