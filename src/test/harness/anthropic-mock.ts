/**
 * Anthropic Messages API mock.
 *
 * Mirrors the request shape of @anthropic-ai/sdk's `client.messages.create({
 * model, system, messages, max_tokens, stream })` and, when stream is true,
 * emits the same SSE event sequence the real API uses:
 *
 *   message_start  → content_block_start → content_block_delta* →
 *   content_block_stop → message_delta → message_stop
 *
 * Swapping this mock for the real SDK against a live API key must not
 * require any code change in the Worker — the request shape is contract-
 * equivalent.
 */

export interface AnthropicRequest {
  model: string;
  system?: unknown;
  messages: Array<{ role: string; content: unknown }>;
  max_tokens: number;
  stream?: boolean;
}

export interface AnthropicMockResponseConfig {
  /** Text deltas to emit as content_block_delta events. */
  textDeltas: string[];
  /** input_tokens reported on message_start. */
  inputTokens?: number;
  /** cache_read_input_tokens reported on message_start. */
  cacheReadInputTokens?: number;
  /** output_tokens reported on message_delta. */
  outputTokens?: number;
  /** When set, the mock returns this HTTP status instead of streaming. */
  errorStatus?: number;
  /** When errorStatus is set, the body to return. */
  errorBody?: string;
}

export interface AnthropicMock {
  /** Queue the next response. FIFO. */
  queueResponse(config: AnthropicMockResponseConfig): void;
  /** All requests received, in order. */
  readonly receivedRequests: ReadonlyArray<AnthropicRequest>;
  /** A fetch handler suitable for Anthropic's POST /v1/messages. */
  fetchHandler: (request: Request) => Promise<Response>;
}

function sseFrame(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function createAnthropicMock(): AnthropicMock {
  const queue: AnthropicMockResponseConfig[] = [];
  const received: AnthropicRequest[] = [];

  const fetchHandler = async (request: Request): Promise<Response> => {
    const body = (await request.json()) as AnthropicRequest;
    received.push(body);

    const config = queue.shift() ?? {
      textDeltas: [""],
      inputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 0,
    };

    if (config.errorStatus !== undefined) {
      return new Response(config.errorBody ?? "", { status: config.errorStatus });
    }

    const messageId = `msg_${Math.random().toString(36).slice(2, 10)}`;
    const encoder = new TextEncoder();
    const deltas = config.textDeltas;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            sseFrame("message_start", {
              type: "message_start",
              message: {
                id: messageId,
                type: "message",
                role: "assistant",
                model: body.model,
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: {
                  input_tokens: config.inputTokens ?? 0,
                  cache_read_input_tokens: config.cacheReadInputTokens ?? 0,
                  output_tokens: 0,
                },
              },
            }),
          ),
        );
        controller.enqueue(
          encoder.encode(
            sseFrame("content_block_start", {
              type: "content_block_start",
              index: 0,
              content_block: { type: "text", text: "" },
            }),
          ),
        );
        for (const delta of deltas) {
          controller.enqueue(
            encoder.encode(
              sseFrame("content_block_delta", {
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text: delta },
              }),
            ),
          );
        }
        controller.enqueue(
          encoder.encode(
            sseFrame("content_block_stop", { type: "content_block_stop", index: 0 }),
          ),
        );
        controller.enqueue(
          encoder.encode(
            sseFrame("message_delta", {
              type: "message_delta",
              delta: { stop_reason: "end_turn", stop_sequence: null },
              usage: { output_tokens: config.outputTokens ?? 0 },
            }),
          ),
        );
        controller.enqueue(encoder.encode(sseFrame("message_stop", { type: "message_stop" })));
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };

  return {
    queueResponse(config) {
      queue.push(config);
    },
    get receivedRequests() {
      return received;
    },
    fetchHandler,
  };
}
