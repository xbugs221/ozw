/**
 * PURPOSE: Estimate OpenAI standard API token charges in renminbi for manual
 * session turn summaries.
 */
import type { ChatTokenUsage } from '../types/types';

type ModelPrice = {
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  cacheWriteUsdPerMillion: number;
  outputUsdPerMillion: number;
};

export type TokenCostEstimate = {
  cny: number;
  modelLabel: string;
  usd: number;
};

/**
 * European Central Bank reference rates on 2026-07-24:
 * EUR/CNY 7.7047 divided by EUR/USD 1.1377.
 */
export const USD_CNY_REFERENCE_RATE = 6.7722;

/**
 * Public OpenAI standard pricing in USD per one million tokens.
 * Source: https://developers.openai.com/api/docs/models/compare
 */
const MODEL_PRICES: Array<{ matches: RegExp; label: string; price: ModelPrice }> = [
  {
    matches: /^gpt-5\.6-sol(?:-|$)/i,
    label: 'GPT-5.6 Sol',
    price: { inputUsdPerMillion: 5, cachedInputUsdPerMillion: 0.5, cacheWriteUsdPerMillion: 6.25, outputUsdPerMillion: 30 },
  },
  {
    matches: /^gpt-5\.6-terra(?:-|$)/i,
    label: 'GPT-5.6 Terra',
    price: { inputUsdPerMillion: 2.5, cachedInputUsdPerMillion: 0.25, cacheWriteUsdPerMillion: 3.125, outputUsdPerMillion: 15 },
  },
  {
    matches: /^gpt-5\.6-luna(?:-|$)/i,
    label: 'GPT-5.6 Luna',
    price: { inputUsdPerMillion: 1, cachedInputUsdPerMillion: 0.1, cacheWriteUsdPerMillion: 1.25, outputUsdPerMillion: 6 },
  },
  {
    matches: /^gpt-5\.4(?:-|$)/i,
    label: 'GPT-5.4',
    price: { inputUsdPerMillion: 2.5, cachedInputUsdPerMillion: 0.25, cacheWriteUsdPerMillion: 3.125, outputUsdPerMillion: 15 },
  },
  {
    matches: /^gpt-5\.3-codex(?:-|$)/i,
    label: 'GPT-5.3 Codex',
    price: { inputUsdPerMillion: 1.75, cachedInputUsdPerMillion: 0.175, cacheWriteUsdPerMillion: 2.1875, outputUsdPerMillion: 14 },
  },
];

/**
 * Estimate one turn without double charging cached input or reasoning output.
 */
export function estimateOpenAiTokenCostCny(
  model: string | undefined,
  usage: ChatTokenUsage | undefined,
): TokenCostEstimate | null {
  if (!model || !usage) {
    return null;
  }
  const modelPrice = MODEL_PRICES.find(({ matches }) => matches.test(model));
  if (!modelPrice) {
    return null;
  }
  const inputTokens = Math.max(0, usage.inputTokens || 0);
  const cachedInputTokens = Math.min(inputTokens, Math.max(0, usage.cachedInputTokens || 0));
  const uncachedInputTokens = inputTokens - cachedInputTokens;
  const cacheWriteInputTokens = Math.max(0, usage.cacheWriteInputTokens || 0);
  const outputTokens = Math.max(0, usage.outputTokens || 0);
  const usd = (
    uncachedInputTokens * modelPrice.price.inputUsdPerMillion
    + cachedInputTokens * modelPrice.price.cachedInputUsdPerMillion
    + cacheWriteInputTokens * modelPrice.price.cacheWriteUsdPerMillion
    + outputTokens * modelPrice.price.outputUsdPerMillion
  ) / 1_000_000;
  return {
    cny: usd * USD_CNY_REFERENCE_RATE,
    modelLabel: modelPrice.label,
    usd,
  };
}

/**
 * Keep small estimates visible without adding noisy precision to normal turns.
 */
export function formatTokenCostCny(cny: number): string {
  if (cny < 0.01) {
    return `¥${cny.toFixed(3)}`;
  }
  return `¥${cny.toFixed(2)}`;
}
