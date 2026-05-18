/**
 * Tests for src/auth/session.ts
 *
 * Written BEFORE implementation (TDD).
 * Uses Web Crypto (SubtleCrypto) — available in Cloudflare Workers runtime.
 */

import { describe, it, expect } from "vitest";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  signSession,
  verifySession,
  buildSetCookieHeader,
  buildClearCookieHeader,
} from "../../auth/session";
import type { AdminSessionPayload } from "../../types/auth";

const SECRET = "test-signing-secret-32-bytes-long!!";

function makePayload(overrides?: Partial<AdminSessionPayload>): AdminSessionPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: "admin",
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    ...overrides,
  };
}

describe("session constants", () => {
  it("SESSION_COOKIE_NAME is correct", () => {
    expect(SESSION_COOKIE_NAME).toBe("askmycv_admin_session");
  });

  it("SESSION_TTL_SECONDS is 7 days", () => {
    expect(SESSION_TTL_SECONDS).toBe(604800);
  });
});

describe("signSession + verifySession roundtrip", () => {
  it("sign and verify returns the original payload", async () => {
    const payload = makePayload();
    const token = await signSession(payload, SECRET);
    const verified = await verifySession(token, SECRET);
    expect(verified.sub).toBe("admin");
    expect(verified.iat).toBe(payload.iat);
    expect(verified.exp).toBe(payload.exp);
  });

  it("returns a non-empty string token", async () => {
    const token = await signSession(makePayload(), SECRET);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(10);
  });
});

describe("verifySession rejection cases", () => {
  it("rejects tampered payload", async () => {
    const payload = makePayload();
    const token = await signSession(payload, SECRET);
    // Tamper: replace the payload part (first segment before last dot)
    const parts = token.split(".");
    // token format: base64url(payload).base64url(sig)
    // Tamper the payload
    const tamperedPayload = btoa(JSON.stringify({ ...payload, sub: "hacker" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    const tampered = `${tamperedPayload}.${parts[parts.length - 1]}`;
    await expect(verifySession(tampered, SECRET)).rejects.toThrow();
  });

  it("rejects expired token", async () => {
    const pastExp = Math.floor(Date.now() / 1000) - 1;
    const payload = makePayload({ exp: pastExp });
    const token = await signSession(payload, SECRET);
    await expect(verifySession(token, SECRET)).rejects.toThrow(/expired/i);
  });

  it("rejects token signed with wrong secret", async () => {
    const token = await signSession(makePayload(), SECRET);
    await expect(verifySession(token, "wrong-secret")).rejects.toThrow();
  });

  it("rejects malformed token string", async () => {
    await expect(verifySession("not.a.valid.token.at.all", SECRET)).rejects.toThrow();
  });
});

describe("buildSetCookieHeader", () => {
  it("includes the cookie name and value", () => {
    const header = buildSetCookieHeader("testvalue");
    expect(header).toContain(`${SESSION_COOKIE_NAME}=testvalue`);
  });

  it("includes HttpOnly", () => {
    const header = buildSetCookieHeader("v");
    expect(header).toContain("HttpOnly");
  });

  it("includes Secure", () => {
    const header = buildSetCookieHeader("v");
    expect(header).toContain("Secure");
  });

  it("includes SameSite=Lax", () => {
    const header = buildSetCookieHeader("v");
    expect(header).toContain("SameSite=Lax");
  });

  it("includes Path=/admin", () => {
    const header = buildSetCookieHeader("v");
    expect(header).toContain("Path=/admin");
  });

  it("includes Max-Age when provided", () => {
    const header = buildSetCookieHeader("v", { maxAge: 3600 });
    expect(header).toContain("Max-Age=3600");
  });
});

describe("buildClearCookieHeader", () => {
  it("includes the cookie name", () => {
    const header = buildClearCookieHeader();
    expect(header).toContain(SESSION_COOKIE_NAME);
  });

  it("sets Max-Age=0 to expire the cookie", () => {
    const header = buildClearCookieHeader();
    expect(header).toContain("Max-Age=0");
  });

  it("includes Path=/admin", () => {
    const header = buildClearCookieHeader();
    expect(header).toContain("Path=/admin");
  });
});
