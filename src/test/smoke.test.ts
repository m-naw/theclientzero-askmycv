import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env, createExecutionContext, fetchMock, waitOnExecutionContext } from "cloudflare:test";
import worker from "../worker";
import { createAnthropicMock } from "./harness/anthropic-mock";
import { createJwksMock } from "./harness/jwks-mock";
import { putJson, getJson } from "./harness/kv";
import { TEST_JWKS_KV_KEY } from "../routes/jwks-source";

describe("Workers runtime primitives inside miniflare", () => {
  it("KV.put honours expirationTtl", async () => {
    const kv = (env as { STATE: KVNamespace }).STATE;
    await kv.put("smoke:ttl", "x", { expirationTtl: 60 });
    expect(await kv.get("smoke:ttl")).toBe("x");
  });

  it("ReadableStream + Response streaming works", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("hello "));
        controller.enqueue(encoder.encode("world"));
        controller.close();
      },
    });
    const text = await new Response(stream).text();
    expect(text).toBe("hello world");
  });

  it("crypto.subtle is available", async () => {
    const key = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
      "verify",
    ]);
    expect(key).toBeDefined();
  });

  it("KV JSON helpers round-trip", async () => {
    const kv = (env as { STATE: KVNamespace }).STATE;
    await putJson(kv, "smoke:cfg", { hello: "world" });
    expect(await getJson<{ hello: string }>(kv, "smoke:cfg")).toEqual({ hello: "world" });
  });
});

describe("Worker boot + Anthropic SSE mock", () => {
  it("GET / returns the placeholder body", async () => {
    const req = new Request("https://example.test/");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env as never, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("askmycv");
  });

  it("Anthropic mock emits the four required SSE event types end-to-end", async () => {
    const anthropic = createAnthropicMock();
    anthropic.queueResponse({
      textDeltas: ["I am ", "an SSE ", "mock."],
      inputTokens: 100,
      cacheReadInputTokens: 50,
      outputTokens: 7,
    });

    const upstream = await anthropic.fetchHandler(
      new Request("https://api.anthropic.test/v1/messages", {
        method: "POST",
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          system: [{ type: "text", text: "CV content here" }],
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 512,
          stream: true,
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(upstream.headers.get("content-type")).toBe("text/event-stream");
    const body = await upstream.text();

    for (const evt of ["message_start", "content_block_delta", "message_delta", "message_stop"]) {
      expect(body).toContain(`event: ${evt}`);
    }
    expect(body).toContain("I am ");
    expect(anthropic.receivedRequests).toHaveLength(1);
    expect(anthropic.receivedRequests[0].model).toBe("claude-haiku-4-5-20251001");
    expect(anthropic.receivedRequests[0].max_tokens).toBe(512);
  });
});

describe("JWKS injection wired through Worker /admin route", () => {
  const jwksUrl = "https://test-access.internal/cdn-cgi/access/certs";

  beforeEach(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    (env as Record<string, string>).ACCESS_JWKS_URL_OVERRIDE = jwksUrl;
  });

  afterEach(async () => {
    fetchMock.deactivate();
    const kv = (env as { STATE: KVNamespace }).STATE;
    await kv.delete("config");
    await kv.delete(TEST_JWKS_KV_KEY);
  });

  it("Worker /admin accepts a valid JWT and rejects a forged one", async () => {
    const jwks = await createJwksMock();

    // Seed KV: full StoredConfig + JWKS document (KV-based auth path)
    const kv = (env as { STATE: KVNamespace }).STATE;
    await kv.put("config", JSON.stringify({
      display_name: "Test Owner",
      headline: "Test headline",
      cv_markdown: "# Test CV\n\nSome content.",
      anthropic_api_key: "sk-ant-smoke-key",
      daily_budget_usd: 5,
      access_email: "owner@example.com",
      access_aud: "aud-123",
      access_team_domain: "team.cloudflareaccess.com",
      setup_timestamp: Date.now() - 10000,
    }));
    await kv.put(TEST_JWKS_KV_KEY, JSON.stringify(await jwks.getJwks()));

    const validJwt = await jwks.issueJwt({
      aud: "aud-123",
      iss: "https://team.cloudflareaccess.com",
      email: "owner@example.com",
    });
    const forgedJwt = await jwks.issueJwt({
      aud: "aud-123",
      iss: "https://team.cloudflareaccess.com",
      email: "owner@example.com",
      forge: true,
    });

    const ctxA = createExecutionContext();
    const validRes = await worker.fetch(
      new Request("https://example.test/admin", {
        headers: { "CF-Access-JWT-Assertion": validJwt },
      }),
      env as never,
      ctxA,
    );
    await waitOnExecutionContext(ctxA);
    expect(validRes.status).toBe(200);
    const validHtml = await validRes.text();
    expect(validHtml).toContain('name="cv_markdown"');

    const ctxB = createExecutionContext();
    const forgedRes = await worker.fetch(
      new Request("https://example.test/admin", {
        headers: { "CF-Access-JWT-Assertion": forgedJwt },
      }),
      env as never,
      ctxB,
    );
    await waitOnExecutionContext(ctxB);
    expect(forgedRes.status).toBe(403);
  });

  it("Worker /admin returns 403 when the CF-Access-JWT-Assertion header is absent", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://example.test/admin"),
      env as never,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(403);
  });
});
