/**
 * Anthropic token pricing per model. Rates are USD per 1,000,000 tokens.
 * Spec §9 F6.
 */

export const MODEL_PRICING: Record<
  string,
  { inputPerMillion: number; cachedPerMillion: number; outputPerMillion: number }
> = {
  "claude-haiku-4-5-20251001": {
    inputPerMillion: 1,
    cachedPerMillion: 0.1,
    outputPerMillion: 5,
  },
  // Alias for any haiku variant
  haiku: {
    inputPerMillion: 1,
    cachedPerMillion: 0.1,
    outputPerMillion: 5,
  },
  sonnet: {
    inputPerMillion: 3,
    cachedPerMillion: 0.3,
    outputPerMillion: 15,
  },
};

/**
 * Compute cost in USD for a single Anthropic API call.
 * Falls back to haiku pricing for unknown models.
 */
export function computeCostUsd(params: {
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}): number {
  const { model, inputTokens, cachedInputTokens, outputTokens } = params;
  const rates = MODEL_PRICING[model] ?? MODEL_PRICING["haiku"];
  return (
    (inputTokens * rates.inputPerMillion +
      cachedInputTokens * rates.cachedPerMillion +
      outputTokens * rates.outputPerMillion) /
    1_000_000
  );
}
