// @ts-nocheck -- Pi SDK model shapes are consumed dynamically by the server catalog.
/**
 * PURPOSE: Discover Pi model metadata for frontend model and thinking-level controls.
 */
import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';

const PI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const PLAYWRIGHT_FAKE_PI_MODEL = {
  value: 'playwright/pi-fake',
  provider: 'playwright',
  id: 'pi-fake',
  label: 'Playwright Pi Fake',
  reasoning: true,
  thinkingOptions: PI_THINKING_LEVELS.map((level) => ({
    value: level,
    label: level === 'xhigh' ? 'XHigh' : level.charAt(0).toUpperCase() + level.slice(1),
  })),
  defaultThinkingLevel: 'medium',
};

function shouldUseFakePiCatalog() {
  /**
   * Keep browser e2e isolated from the developer machine's real Pi auth state.
   */
  return process.env.CCFLOW_FAKE_RUNNER === '1' || process.env.CBW_FAKE_PI_RUNTIME === '1';
}

/**
 * Convert a Pi SDK model into a compact option for the chat UI.
 * @param {object} model - Pi SDK model registry entry.
 * @returns {object} Normalized model catalog entry.
 */
function normalizePiModel(model) {
  const provider = String(model?.provider || '').trim();
  const id = String(model?.id || '').trim();
  const value = provider && id ? `${provider}/${id}` : id;
  const reasoning = model?.reasoning === true;
  const thinkingLevelMap = model?.thinkingLevelMap && typeof model.thinkingLevelMap === 'object'
    ? model.thinkingLevelMap
    : null;
  const thinkingOptions = (reasoning ? PI_THINKING_LEVELS : ['off'])
    .filter((level) => !thinkingLevelMap || thinkingLevelMap[level] !== null)
    .map((level) => ({
      value: level,
      label: level === 'xhigh' ? 'XHigh' : level.charAt(0).toUpperCase() + level.slice(1),
    }));

  return {
    value,
    provider,
    id,
    label: String(model?.name || value),
    reasoning,
    thinkingOptions,
    defaultThinkingLevel: thinkingOptions.some((option) => option.value === 'medium')
      ? 'medium'
      : (thinkingOptions[0]?.value || 'off'),
  };
}

/**
 * Load authenticated Pi models from the SDK registry.
 * @returns {Promise<{models: Array<object>}>} Available model catalog.
 */
export async function getPiModelCatalog() {
  if (shouldUseFakePiCatalog()) {
    return { models: [PLAYWRIGHT_FAKE_PI_MODEL] };
  }

  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const models = modelRegistry.getAvailable().map(normalizePiModel);
  return { models };
}
