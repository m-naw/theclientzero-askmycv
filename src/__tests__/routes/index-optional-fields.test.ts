/**
 * Tests pinning handleRoot's behavior of forwarding all optional StoredConfig
 * profile fields (location, linkedin_url, github_url, pdf_cv_url,
 * suggested_questions) to renderChatPage.
 *
 * Runs inside @cloudflare/vitest-pool-workers (Miniflare) so KV semantics
 * and Web Crypto behave as on production Workers.
 *
 * Three test cases:
 * 1. All five optional fields present — HTML contains each value.
 * 2. Optional fields omitted (undefined) — corresponding anchors/location absent.
 * 3. suggested_questions is empty array — no question buttons rendered.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../worker";
import type { StoredConfig } from "../../types/config";

interface TestEnv {
  STATE: KVNamespace;
  ANTHROPIC_BASE_URL: string;
  ACCESS_JWKS_URL_OVERRIDE: string;
}

function getEnv(): TestEnv {
  return env as unknown as TestEnv;
}

async function clearKv(): Promise<void> {
  const kv = getEnv().STATE;
  for (const key of ["config", "setup_window_start"]) {
    await kv.delete(key);
  }
}

function rootRequest(): Request {
  return new Request("https://example.test/", { method: "GET" });
}

async function runFetch(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as never, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/** Minimal valid StoredConfig with all required fields, no optional fields. */
function baseConfig(): StoredConfig {
  return {
    display_name: "Test User",
    headline: "Full-stack engineer",
    cv_markdown: "# Test User\n\n" + "Extensive experience in software engineering. ".repeat(10),
    anthropic_api_key: "sk-ant-test",
    daily_budget_usd: 5,
    access_email: "owner@test",
    access_aud: "test-aud",
    access_team_domain: "test.cloudflareaccess.com",
    setup_timestamp: Date.now() - 1000,
  };
}

describe("GET / — handleRoot forwards optional StoredConfig profile fields to renderChatPage", () => {
  beforeEach(async () => {
    (env as Record<string, string>).ACCESS_JWKS_URL_OVERRIDE = "";
    await clearKv();
  });

  afterEach(async () => {
    await clearKv();
  });

  it("all five optional fields present — HTML contains location text, linkedin href, github href, pdf_cv href, and each suggested question", async () => {
    const cfg: StoredConfig = {
      ...baseConfig(),
      location: "Hamburg, Germany",
      linkedin_url: "https://linkedin.com/in/testuser",
      github_url: "https://github.com/testuser",
      pdf_cv_url: "https://example.com/testuser-cv.pdf",
      suggested_questions: [
        "What is your strongest technical skill?",
        "Describe a complex system you designed.",
        "How do you handle disagreements with teammates?",
        "What is your preferred engineering workflow?",
      ],
    };
    await getEnv().STATE.put("config", JSON.stringify(cfg));

    const res = await runFetch(rootRequest());
    expect(res.status).toBe(200);
    const html = await res.text();

    // location text present
    expect(html).toContain("Hamburg, Germany");

    // linkedin_url rendered as anchor href
    expect(html).toContain('href="https://linkedin.com/in/testuser"');

    // github_url rendered as anchor href
    expect(html).toContain('href="https://github.com/testuser"');

    // pdf_cv_url rendered as anchor href
    expect(html).toContain('href="https://example.com/testuser-cv.pdf"');

    // each suggested_questions entry rendered
    expect(html).toContain("What is your strongest technical skill?");
    expect(html).toContain("Describe a complex system you designed.");
    expect(html).toContain("How do you handle disagreements with teammates?");
    expect(html).toContain("What is your preferred engineering workflow?");
  });

  it("optional fields omitted (undefined) — corresponding location node and anchor elements absent from HTML", async () => {
    // baseConfig has no optional fields: no location, no linkedin_url, no github_url, no pdf_cv_url
    const cfg = baseConfig();
    await getEnv().STATE.put("config", JSON.stringify(cfg));

    const res = await runFetch(rootRequest());
    expect(res.status).toBe(200);
    const html = await res.text();

    // No location paragraph with "undefined" or empty value
    expect(html).not.toContain("undefined");

    // No LinkedIn anchor
    expect(html).not.toContain("linkedin.com");

    // No user-configured GitHub anchor. The mandatory maintainer
    // attribution footer (AGPL-3.0 Section 7(b)) always renders a link
    // to https://github.com/m-naw/theclientzero-askmycv, so we assert
    // that no user-supplied github.com URL leaks into the page header.
    expect(html).not.toMatch(/href="https:\/\/github\.com\/(?!m-naw\/)/);

    // No PDF CV anchor
    expect(html).not.toContain(".pdf");

    // Page should still render with default suggested questions (at least 2 chips)
    const chipMatches = html.match(/class="chip"/g) ?? [];
    expect(chipMatches.length).toBeGreaterThanOrEqual(2);
  });

  it("suggested_questions is empty array — falls back to defaults (no empty button set rendered)", async () => {
    const cfg: StoredConfig = {
      ...baseConfig(),
      suggested_questions: [],
    };
    await getEnv().STATE.put("config", JSON.stringify(cfg));

    const res = await runFetch(rootRequest());
    expect(res.status).toBe(200);
    const html = await res.text();

    // Should not render empty question buttons — falls back to defaults
    // The empty array triggers the fallback path in handleRoot (length < 2)
    // so the page renders with the built-in default questions
    const chipMatches = html.match(/class="chip"/g) ?? [];
    expect(chipMatches.length).toBeGreaterThanOrEqual(2);

    // The config's empty suggested_questions must not produce zero-chip output
    // (which would indicate renderChatPage was called with an empty array and threw)
    // Verify the page is a full HTML document, not an error page
    expect(html).toContain("<html");
    expect(html).toContain("Test User");
  });
});
