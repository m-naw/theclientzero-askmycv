import { describe, expect, it } from "vitest";
// @ts-expect-error — provided by @cloudflare/vitest-pool-workers at runtime
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { createRemoteJWKSet, jwtVerify } from "jose";
import worker from "../worker";
import { createAnthropicMock } from "./harness/anthropic-mock";
import { createJwksMock } from "./harness/jwks-mock";
import { putJson, getJson } from "./harness/kv";

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

describe("JWKS mock issues verifiable JWTs", () => {
  it("verifies a valid JWT and rejects a forged one against the same JWKS", async () => {
    const jwks = await createJwksMock();
    const jwksUrl = "https://jwks.test/cdn-cgi/access/certs";

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === jwksUrl) {
        return jwks.fetchHandler(new Request(url));
      }
      return realFetch(input as RequestInfo);
    }) as typeof fetch;

    try {
      const valid = await jwks.issueJwt({
        aud: "aud-123",
        iss: "https://team.cloudflareaccess.com",
        email: "owner@example.com",
      });
      const forged = await jwks.issueJwt({
        aud: "aud-123",
        iss: "https://team.cloudflareaccess.com",
        email: "owner@example.com",
        forge: true,
      });

      const remoteJwks = createRemoteJWKSet(new URL(jwksUrl));

      const { payload } = await jwtVerify(valid, remoteJwks, {
        audience: "aud-123",
        issuer: "https://team.cloudflareaccess.com",
      });
      expect(payload.email).toBe("owner@example.com");

      await expect(
        jwtVerify(forged, remoteJwks, {
          audience: "aud-123",
          issuer: "https://team.cloudflareaccess.com",
        }),
      ).rejects.toThrow();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
