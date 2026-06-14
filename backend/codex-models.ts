// @ts-nocheck -- Migration baseline: JS-to-TS rename complete. Types will be tightened incrementally.
/**
 * PURPOSE: Discover Codex model metadata from OpenAI's model API and the locally installed Codex CLI catalog.
 */
import { execFile as execFileCallback } from 'child_process';
import { constants as fsConstants } from 'fs';
import { access, readdir, readFile, realpath } from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

import { CODEX_REASONING_EFFORTS } from '../shared/modelConstants.js';

const execFile = promisify(execFileCallback);
const DISCOVERY_TIMEOUT_MS = 15_000;
const DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1_000;
const CLI_WRAPPER_SUFFIX = `${path.sep}@openai${path.sep}codex${path.sep}bin${path.sep}codex.js`;
const DEFAULT_OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';

let cachedCatalog = null;
let cachedAt = 0;

/**
 * Convert a model slug into a readable fallback label.
 * @param {string} slug - Codex model slug.
 * @returns {string} Display label.
 */
function slugToLabel(slug) {
  return slug
    .split('-')
    .map((part) => {
      if (/^\d/.test(part)) {
        return part;
      }

      return part.toUpperCase();
    })
    .join('-');
}

/**
 * Resolve the OpenAI models endpoint from environment settings.
 * @param {NodeJS.ProcessEnv|object} env - Runtime environment.
 * @returns {string} Fully qualified models endpoint.
 */
function resolveOpenAIModelsUrl(env) {
  if (typeof env.OPENAI_MODELS_URL === 'string' && env.OPENAI_MODELS_URL.trim()) {
    return env.OPENAI_MODELS_URL.trim();
  }

  if (typeof env.OPENAI_BASE_URL === 'string' && env.OPENAI_BASE_URL.trim()) {
    const parsedUrl = new URL(env.OPENAI_BASE_URL.trim());
    const pathname = parsedUrl.pathname.replace(/\/+$/, '').replace(/\/v1$/, '');
    parsedUrl.pathname = `${pathname}/v1/models`;
    parsedUrl.search = '';
    parsedUrl.hash = '';
    return parsedUrl.toString();
  }

  return DEFAULT_OPENAI_MODELS_URL;
}

/**
 * Fetch JSON with a timeout so catalog discovery cannot stall chat startup.
 * @param {string} url - Request URL.
 * @param {object} options - Fetch options.
 * @param {Function} fetchImpl - Fetch implementation.
 * @returns {Promise<object>} Parsed JSON payload.
 */
async function fetchJsonWithTimeout(url, options, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      ...options,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`openai-models-api-${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Read account-visible model IDs from OpenAI's official models API.
 * @param {NodeJS.ProcessEnv|object} env - Runtime environment.
 * @param {Function} fetchImpl - Fetch implementation.
 * @returns {Promise<string[]>} Account-visible model IDs.
 */
async function fetchOpenAIModelList(env, fetchImpl) {
  const apiKey = typeof env.OPENAI_API_KEY === 'string' ? env.OPENAI_API_KEY.trim() : '';
  if (!apiKey) {
    throw new Error('openai-api-key-missing');
  }

  const payload = await fetchJsonWithTimeout(resolveOpenAIModelsUrl(env), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  }, fetchImpl);

  if (!Array.isArray(payload?.data)) {
    throw new Error('openai-models-api-invalid-payload');
  }

  const seenModels = new Set();
  const models = [];
  for (const model of payload.data) {
    const id = typeof model?.id === 'string' ? model.id.trim() : '';
    if (!id || seenModels.has(id)) {
      continue;
    }

    seenModels.add(id);
    models.push(id);
  }

  return models;
}

/**
 * Read Codex's local model cache when API discovery is unavailable.
 * @param {NodeJS.ProcessEnv|object} env - Runtime environment.
 * @returns {Promise<{models: Array<object>, defaultModel: string}|null>} Cached model catalog.
 */
async function readCachedCodexModelCatalog(env) {
  const home = typeof env.HOME === 'string' && env.HOME.trim()
    ? env.HOME.trim()
    : process.env.HOME;
  if (!home) {
    return null;
  }

  try {
    const rawCache = await readFile(path.join(home, '.codex', 'models_cache.json'), 'utf8');
    return __normalizeCodexModelCatalog(JSON.parse(rawCache));
  } catch {
    return null;
  }
}

/**
 * Keep only model IDs that belong in the Codex model selector.
 * @param {string[]} modelIds - Account-visible model IDs.
 * @param {{models: Array<object>}} catalog - Embedded Codex catalog metadata.
 * @returns {string[]} Codex-relevant model IDs.
 */
export function __selectCodexModelIds(modelIds, catalog) {
  const catalogSlugs = new Set(catalog.models.map((model) => model.value));
  return modelIds.filter((modelId) => (
    catalogSlugs.has(modelId)
    || /^gpt-5(?:[.-]|$)/i.test(modelId)
    || /^gpt-[0-9.]+-codex(?:[.-]|$)/i.test(modelId)
    || /^codex(?:[.-]|$)/i.test(modelId)
  ));
}

/**
 * Merge model API slugs with embedded catalog metadata.
 * @param {{models: Array<object>, defaultModel: string}} catalog - Base catalog.
 * @param {string[]} listedModels - Model list from account-visible API data.
 * @param {{appendCatalogModels?: boolean}} options - Merge behavior.
 * @returns {{models: Array<object>, defaultModel: string}} Merged catalog.
 */
export function __mergeCatalogWithModelList(catalog, listedModels, options = {}) {
  const fallbackReasoningOptions = CODEX_REASONING_EFFORTS.OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
    description: option.description,
  }));

  if (!Array.isArray(listedModels) || listedModels.length === 0) {
    return catalog;
  }

  const catalogBySlug = new Map(catalog.models.map((model) => [model.value, model]));
  const mergedModels = [];
  const mergedSeen = new Set();

  const appendModel = (model) => {
    if (mergedSeen.has(model.value)) {
      return;
    }

    mergedSeen.add(model.value);
    mergedModels.push(model);
  };

  for (const modelSlug of listedModels) {
    const existingModel = catalogBySlug.get(modelSlug);
    if (existingModel) {
      appendModel(existingModel);
      continue;
    }

    appendModel({
      value: modelSlug,
      label: slugToLabel(modelSlug),
      defaultReasoningEffort: CODEX_REASONING_EFFORTS.DEFAULT,
      reasoningOptions: fallbackReasoningOptions,
    });
  }

  if (options.appendCatalogModels !== false) {
    for (const model of catalog.models) {
      appendModel(model);
    }
  }

  const defaultModel = mergedModels.some((model) => model.value === catalog.defaultModel)
    ? catalog.defaultModel
    : mergedModels[0]?.value || catalog.defaultModel;

  return {
    models: mergedModels,
    defaultModel,
  };
}

/**
 * Find the first executable `codex` command on PATH.
 * @returns {Promise<string|null>} Absolute path to the wrapper or binary.
 */
async function findCodexCommandPath() {
  const searchPaths = (process.env.PATH || '').split(path.delimiter).filter(Boolean);

  for (const directory of searchPaths) {
    const candidate = path.join(directory, process.platform === 'win32' ? 'codex.exe' : 'codex');
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Continue searching other PATH entries.
    }
  }

  return null;
}

/**
 * Resolve the vendored native Codex binary when the PATH entry is the Node wrapper.
 * @param {string} wrapperPath - Resolved `codex` command path.
 * @returns {Promise<string>} Absolute path to the executable binary.
 */
async function resolveCodexBinaryPath(wrapperPath) {
  const resolvedPath = await realpath(wrapperPath);
  if (!resolvedPath.endsWith(CLI_WRAPPER_SUFFIX)) {
    return resolvedPath;
  }

  const openaiNodeModulesPath = path.join(path.dirname(resolvedPath), '..', 'node_modules', '@openai');
  const packages = await readdir(openaiNodeModulesPath, { withFileTypes: true });

  for (const entry of packages) {
    if (!entry.isDirectory() || !entry.name.startsWith('codex-')) {
      continue;
    }

    const vendorRoot = path.join(openaiNodeModulesPath, entry.name, 'vendor');
    try {
      const targets = await readdir(vendorRoot, { withFileTypes: true });
      for (const targetEntry of targets) {
        if (!targetEntry.isDirectory()) {
          continue;
        }

        const binaryPath = path.join(
          vendorRoot,
          targetEntry.name,
          'codex',
          process.platform === 'win32' ? 'codex.exe' : 'codex',
        );
        await access(binaryPath, fsConstants.X_OK);
        return binaryPath;
      }
    } catch {
      // Ignore packages without a vendored binary for this platform.
    }
  }

  return resolvedPath;
}

/**
 * Extract the embedded model catalog JSON blob from `strings` output.
 * @param {string} stringsOutput - Raw output from the `strings` command.
 * @returns {object|null} Parsed model catalog JSON when present.
 */
export function __extractEmbeddedModelCatalog(stringsOutput) {
  const marker = '"models": [';
  const markerIndex = stringsOutput.indexOf(marker);
  if (markerIndex < 0) {
    return null;
  }

  const startIndex = stringsOutput.lastIndexOf('{', markerIndex);
  if (startIndex < 0) {
    return null;
  }

  let braceDepth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = startIndex; index < stringsOutput.length; index += 1) {
    const character = stringsOutput[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (character === '\\') {
        isEscaped = true;
        continue;
      }

      if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === '{') {
      braceDepth += 1;
      continue;
    }

    if (character === '}') {
      braceDepth -= 1;
      if (braceDepth === 0) {
        const jsonText = stringsOutput.slice(startIndex, index + 1);
        return JSON.parse(jsonText);
      }
    }
  }

  return null;
}

/**
 * Normalize the embedded Codex model catalog into a frontend-ready shape.
 * @param {object|null} catalog - Embedded Codex catalog.
 * @returns {{models: Array<object>, defaultModel: string}|null} Normalized model data.
 */
export function __normalizeCodexModelCatalog(catalog) {
  if (!catalog || !Array.isArray(catalog.models)) {
    return null;
  }

  const models = catalog.models
    .filter((model) => model?.visibility === 'list' && typeof model?.slug === 'string')
    .sort((left, right) => (left?.priority ?? Number.MAX_SAFE_INTEGER) - (right?.priority ?? Number.MAX_SAFE_INTEGER))
    .map((model) => ({
      value: model.slug,
      label: model.display_name || slugToLabel(model.slug),
      defaultReasoningEffort: model.default_reasoning_level || CODEX_REASONING_EFFORTS.DEFAULT,
      reasoningOptions: Array.isArray(model.supported_reasoning_levels)
        ? model.supported_reasoning_levels.map((option) => ({
          value: option.effort,
          label: slugToLabel(option.effort),
          description: option.description || '',
        }))
        : CODEX_REASONING_EFFORTS.OPTIONS,
    }));

  if (models.length === 0) {
    return null;
  }

  return { models, defaultModel: models[0].value };
}

/**
 * Inspect OpenAI's models API and the installed Codex CLI catalog.
 * @param {{env?: object, fetchImpl?: Function}} options - Discovery dependencies for tests.
 * @returns {Promise<{models: Array<object>, defaultModel: string, source?: string, fetchError?: string}>} Discovered model metadata.
 */
export async function discoverCodexModelCatalog(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  let listedModels = [];
  let fetchError = '';

  if (typeof fetchImpl === 'function') {
    try {
      listedModels = await fetchOpenAIModelList(env, fetchImpl);
    } catch (error) {
      fetchError = error?.message || 'openai-models-api-unavailable';
    }
  } else {
    fetchError = 'fetch-unavailable';
  }

  const cachedModelCatalog = await readCachedCodexModelCatalog(env);
  if (cachedModelCatalog) {
    const selectableModels = __selectCodexModelIds(listedModels, cachedModelCatalog);
    if (selectableModels.length > 0) {
      return {
        ...__mergeCatalogWithModelList(cachedModelCatalog, selectableModels, { appendCatalogModels: false }),
        source: 'openai-models-api',
      };
    }

    if (listedModels.length === 0) {
      return {
        ...cachedModelCatalog,
        source: 'codex-models-cache',
        ...(fetchError ? { fetchError } : {}),
      };
    }
  }

  const codexCommandPath = await findCodexCommandPath();
  if (!codexCommandPath) {
    const selectableModels = __selectCodexModelIds(listedModels, { models: [] });
    if (selectableModels.length > 0) {
      return {
        ...__mergeCatalogWithModelList({ models: [], defaultModel: '' }, selectableModels, { appendCatalogModels: false }),
        source: 'openai-models-api',
      };
    }

    return {
      models: [],
      defaultModel: '',
      source: 'codex-cli-unavailable',
      fetchError: fetchError || 'codex-command-not-found',
    };
  }

  const binaryPath = await resolveCodexBinaryPath(codexCommandPath);
  const { stdout } = await execFile('strings', [binaryPath], {
    timeout: DISCOVERY_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  });

  const catalog = __normalizeCodexModelCatalog(__extractEmbeddedModelCatalog(stdout));
  if (!catalog && listedModels.length === 0) {
    return {
      models: [],
      defaultModel: '',
      source: 'codex-cli-unavailable',
      fetchError: fetchError || 'model-list-empty',
    };
  }

  const discoveredCatalog = catalog || { models: [], defaultModel: '' };
  const selectableModels = __selectCodexModelIds(listedModels, discoveredCatalog);
  if (selectableModels.length > 0) {
    return {
      ...__mergeCatalogWithModelList(discoveredCatalog, selectableModels, { appendCatalogModels: false }),
      source: 'openai-models-api',
    };
  }

  return {
    ...discoveredCatalog,
    source: 'codex-cli-embedded-catalog',
    ...(fetchError ? { fetchError } : {}),
  };
}

/**
 * Return a cached Codex model catalog to avoid shelling out on every request.
 * @param {{env?: object, fetchImpl?: Function}} options - Discovery dependencies for tests.
 * @returns {Promise<{models: Array<object>, defaultModel: string, source?: string, fetchError?: string}>} Cached or fresh model metadata.
 */
export async function getCodexModelCatalog(options = {}) {
  const now = Date.now();
  if (cachedCatalog && now - cachedAt < DISCOVERY_CACHE_TTL_MS) {
    return cachedCatalog;
  }

  try {
    cachedCatalog = await discoverCodexModelCatalog(options);
  } catch (error) {
    cachedCatalog = {
      models: [],
      defaultModel: '',
      source: 'codex-cli-unavailable',
      fetchError: error?.message || 'model-list-unavailable',
    };
  }
  cachedAt = now;
  return cachedCatalog;
}
