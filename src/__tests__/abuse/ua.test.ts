/**
 * Unit tests for src/abuse/ua.ts — bot user-agent detection.
 * Runs inside @cloudflare/vitest-pool-workers (Miniflare).
 */

import { describe, it, expect } from "vitest";
import { isBotUserAgent } from "../../abuse/ua";

describe("isBotUserAgent", () => {
  it("returns true when ua is null", () => {
    expect(isBotUserAgent(null)).toBe(true);
  });

  it("returns true when ua is empty string", () => {
    expect(isBotUserAgent("")).toBe(true);
  });

  it("returns true when ua is shorter than 8 characters", () => {
    expect(isBotUserAgent("abc")).toBe(true);
    expect(isBotUserAgent("1234567")).toBe(true);
  });

  it("returns false when ua is exactly 8 characters and not a known bot", () => {
    expect(isBotUserAgent("12345678")).toBe(false);
  });

  it("returns true for curl user agents", () => {
    expect(isBotUserAgent("curl/7.68.0")).toBe(true);
    expect(isBotUserAgent("curl/8.1.2")).toBe(true);
  });

  it("returns true for wget user agents", () => {
    expect(isBotUserAgent("wget/1.21.2")).toBe(true);
  });

  it("returns true for python-requests user agents", () => {
    expect(isBotUserAgent("python-requests/2.28.0")).toBe(true);
  });

  it("returns true for httpie user agents", () => {
    expect(isBotUserAgent("HTTPie/3.0.0")).toBe(true);
  });

  it("returns true for go-http-client user agents", () => {
    expect(isBotUserAgent("go-http-client/1.1")).toBe(true);
  });

  it("returns false for normal browser user agents", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    expect(isBotUserAgent(ua)).toBe(false);
  });

  it("returns false for Safari user agent", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
    expect(isBotUserAgent(ua)).toBe(false);
  });

  it("is case insensitive for bot patterns", () => {
    expect(isBotUserAgent("CURL/7.0")).toBe(true);
    expect(isBotUserAgent("Python-Requests/2.0")).toBe(true);
  });
});
