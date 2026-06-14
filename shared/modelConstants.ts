/**
 * PURPOSE: Centralized Model Definitions
 * Single source of truth for all supported AI models
 */

export interface ReasoningEffort {
  value: string;
  label: string;
  description: string;
}

/**
 * Codex (OpenAI) Models
 *
 * Note: Codex models are discovered dynamically from the installed Codex CLI.
 * Static fallback models are intentionally empty to avoid stale provider choices.
 */
export const CODEX_MODELS = {
  OPTIONS: [] as string[],

  DEFAULT: '',
};

/**
 * Codex reasoning effort options.
 *
 * Note: Each model can expose a narrower subset at runtime via Codex CLI
 * discovery. These values are a fallback shape that mirrors CLI terminology.
 */
export const CODEX_REASONING_EFFORTS: {
  OPTIONS: ReasoningEffort[];
  DEFAULT: string;
} = {
  OPTIONS: [
    { value: 'low', label: 'Low', description: 'Fast responses with lighter reasoning' },
    { value: 'medium', label: 'Medium', description: 'Balances speed and reasoning depth for everyday tasks' },
    { value: 'high', label: 'High', description: 'Greater reasoning depth for complex problems' },
    { value: 'xhigh', label: 'Max', description: 'Extra high reasoning depth for complex problems' }
  ],
  DEFAULT: 'medium',
};
