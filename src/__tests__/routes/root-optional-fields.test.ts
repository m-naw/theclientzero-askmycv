/**
 * Tests for handleRoot forwarding optional StoredConfig profile fields
 * to renderChatPage (spec §9 F4 done_when).
 *
 * Runs inside @cloudflare/vitest-pool-workers (Miniflare) so KV and
 * Web Crypto behave as production Workers.
 *
 * Covers:
 * - GET / with optional fields set → HTML contains location, link hrefs
 * - GET / without optional fields → HTML renders without "undefined" leaks
 * - suggested_questions from config forwarded when present
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

/** Minimal valid StoredConfig with all required fields. */
function baseConfig(): StoredConfig {
  return {
    display_name: "John Smith",
    headline: "Backend engineer",
    cv_markdown: "# John Smith\n\n" + "Long CV content. ".repeat(20),
    anthropic_api_key: "sk-ant-test",
    daily_budget_usd: 5,
    access_email: "owner@test",
    access_aud: "test-aud",
    access_team_domain: "test.cloudflareaccess.com",
    setup_timestamp: Date.now() - 1000,
  };
}

describe("GET / with optional profile fields in StoredConfig", () => {
  beforeEach(async () => {
    (env as Record<string, string>).ACCESS_JWKS_URL_OVERRIDE = "";
    await clearKv();
  });

  afterEach(async () => {
    await clearKv();
  });

  it("renders location when set in config", async () => {
    const cfg: StoredConfig = {
      ...baseConfig(),
      location: "Berlin, Germany",
    };
    await getEnv().STATE.put("config", JSON.stringify(cfg));

    const res = await runFetch(rootRequest());
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Berlin, Germany");
  });

  it("renders linkedin_url as anchor href when set", async () => {
    const cfg: StoredConfig = {
      ...baseConfig(),
      linkedin_url: "https://linkedin.com/in/johnsmith",
    };
    await getEnv().STATE.put("config", JSON.stringify(cfg));

    const res = await runFetch(rootRequest());
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('href="https://linkedin.com/in/johnsmith"');
  });

  it("renders github_url as anchor href when set", async () => {
    const cfg: StoredConfig = {
      ...baseConfig(),
      github_url: "https://github.com/johnsmith",
    };
    await getEnv().STATE.put("config", JSON.stringify(cfg));

    const res = await runFetch(rootRequest());
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('href="https://github.com/johnsmith"');
  });

  it("renders pdf_cv_url as anchor href when set", async () => {
    const cfg: StoredConfig = {
      ...baseConfig(),
      pdf_cv_url: "https://example.com/cv.pdf",
    };
    await getEnv().STATE.put("config", JSON.stringify(cfg));

    const res = await runFetch(rootRequest());
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('href="https://example.com/cv.pdf"');
  });

  it("renders all optional profile fields together", async () => {
    const cfg: StoredConfig = {
      ...baseConfig(),
      location: "Berlin, Germany",
      linkedin_url: "https://linkedin.com/in/johnsmith",
      github_url: "https://github.com/johnsmith",
      pdf_cv_url: "https://example.com/cv.pdf",
    };
    await getEnv().STATE.put("config", JSON.stringify(cfg));

    const res = await runFetch(rootRequest());
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Berlin, Germany");
    expect(html).toContain('href="https://linkedin.com/in/johnsmith"');
    expect(html).toContain('href="https://github.com/johnsmith"');
    expect(html).toContain('href="https://example.com/cv.pdf"');
  });

  it("does not leak 'undefined' when optional fields are absent", async () => {
    const cfg = baseConfig(); // no optional fields
    await getEnv().STATE.put("config", JSON.stringify(cfg));

    const res = await runFetch(rootRequest());
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("undefined");
  });

  it("uses suggested_questions from config when present (at least 3)", async () => {
    const cfg: StoredConfig = {
      ...baseConfig(),
      suggested_questions: [
        "What stack do you prefer?",
        "Tell me about your biggest project.",
        "How do you approach testing?",
        "What are your salary expectations?",
      ],
    };
    await getEnv().STATE.put("config", JSON.stringify(cfg));

    const res = await runFetch(rootRequest());
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("What stack do you prefer?");
    expect(html).toContain("Tell me about your biggest project.");
    expect(html).toContain("How do you approach testing?");
  });

  it("falls back to default suggested_questions when config has none", async () => {
    const cfg = baseConfig(); // no suggested_questions
    await getEnv().STATE.put("config", JSON.stringify(cfg));

    const res = await runFetch(rootRequest());
    expect(res.status).toBe(200);
    const html = await res.text();
    // Default questions should appear (spec: at least 2 visible)
    const chipMatches = html.match(/class="chip"/g) ?? [];
    expect(chipMatches.length).toBeGreaterThanOrEqual(2);
  });
});
