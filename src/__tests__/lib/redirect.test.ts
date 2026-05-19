import { describe, it, expect } from "vitest";
import { sanitizeNext } from "../../lib/redirect";

describe("sanitizeNext", () => {
  it("returns / for null", () => {
    expect(sanitizeNext(null)).toBe("/");
  });

  it("returns / for undefined", () => {
    expect(sanitizeNext(undefined)).toBe("/");
  });

  it("returns / for empty string", () => {
    expect(sanitizeNext("")).toBe("/");
  });

  it("returns / for bare slash", () => {
    expect(sanitizeNext("/")).toBe("/");
  });

  it("accepts /admin", () => {
    expect(sanitizeNext("/admin")).toBe("/admin");
  });

  it("accepts /admin?tab=config", () => {
    expect(sanitizeNext("/admin?tab=config")).toBe("/admin?tab=config");
  });

  it("rejects //evil.com (protocol-relative)", () => {
    expect(sanitizeNext("//evil.com")).toBe("/");
  });

  it("rejects /\\evil (backslash trick)", () => {
    expect(sanitizeNext("/\\evil")).toBe("/");
  });

  it("rejects https://evil.com (absolute URL)", () => {
    expect(sanitizeNext("https://evil.com")).toBe("/");
  });

  it("rejects javascript:alert(1)", () => {
    expect(sanitizeNext("javascript:alert(1)")).toBe("/");
  });

  it("rejects overlong input (>512 chars)", () => {
    expect(sanitizeNext("/" + "a".repeat(520))).toBe("/");
  });

  it("rejects encoded traversal %2F%2Fevil.com", () => {
    // %2F%2F decodes to // — should be caught after decoding
    expect(sanitizeNext("%2F%2Fevil.com")).toBe("/");
  });

  it("rejects encoded scheme %6aavascript:alert", () => {
    // decodes to javascript:alert — no leading slash so rejected
    expect(sanitizeNext("%6aavascript:alert")).toBe("/");
  });

  it("accepts /dashboard/stats with query string", () => {
    expect(sanitizeNext("/dashboard/stats?foo=bar")).toBe("/dashboard/stats?foo=bar");
  });

  it("accepts already-encoded but safe path %2Fadmin", () => {
    // %2F decodes to / → /admin
    expect(sanitizeNext("%2Fadmin")).toBe("/admin");
  });

  it("accepts path with encoded space", () => {
    expect(sanitizeNext("/admin%20panel")).toBe("/admin panel");
  });
});
