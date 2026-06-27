// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Verify Codex model catalog extraction and normalization from CLI binaries.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  __extractEmbeddedModelCatalog,
  __mergeCatalogWithModelList,
  __normalizeCodexModelCatalog,
  __selectCodexModelIds,
  discoverCodexModelCatalog,
} from '../../backend/codex-models.ts';

const EMBEDDED_CATALOG_FIXTURE = `
noise before
{
  "models": [
    {
      "slug": "gpt-5.5",
      "display_name": "gpt-5.5",
      "default_reasoning_level": "medium",
      "supported_reasoning_levels": [
        { "effort": "low", "description": "Fast" },
        { "effort": "medium", "description": "Balanced" },
        { "effort": "high", "description": "Deep" },
        { "effort": "xhigh", "description": "Max" }
      ],
      "service_tiers": [
        { "id": "priority", "name": "Fast", "description": "1.5x speed" }
      ],
      "default_service_tier": null,
      "visibility": "list",
      "priority": 0
    },
    {
      "slug": "gpt-5.3-codex-spark",
      "display_name": "gpt-5.3-codex-spark",
      "default_reasoning_level": "medium",
      "supported_reasoning_levels": [
        { "effort": "medium", "description": "Adaptive" },
        { "effort": "high", "description": "Max depth" }
      ],
      "visibility": "list",
      "priority": 12
    },
    {
      "slug": "hidden-model",
      "display_name": "hidden-model",
      "default_reasoning_level": "medium",
      "supported_reasoning_levels": [],
      "visibility": "hide",
      "priority": 99
    }
  ]
}
noise after
`;

test('extracts embedded model catalog JSON from strings output', () => {
  const catalog = __extractEmbeddedModelCatalog(EMBEDDED_CATALOG_FIXTURE);

  assert.ok(catalog);
  assert.equal(catalog.models.length, 3);
  assert.equal(catalog.models[0].slug, 'gpt-5.5');
});

test('normalizes visible models and per-model reasoning options', () => {
  const normalized = __normalizeCodexModelCatalog(
    __extractEmbeddedModelCatalog(EMBEDDED_CATALOG_FIXTURE),
  );

  assert.ok(normalized);
  assert.equal(normalized.defaultModel, 'gpt-5.5');
  assert.deepEqual(
    normalized.models.map((model) => model.value),
    ['gpt-5.5', 'gpt-5.3-codex-spark'],
  );
  assert.deepEqual(
    normalized.models[1].reasoningOptions.map((option) => option.value),
    ['medium', 'high'],
  );
  assert.deepEqual(normalized.models[0].serviceTiers, [{
    id: 'priority',
    label: 'Fast',
    description: '1.5x speed',
  }]);
  assert.equal(normalized.models[0].defaultServiceTier, null);
});

test('filters OpenAI model API results to Codex-selectable models', () => {
  const catalog = __normalizeCodexModelCatalog(
    __extractEmbeddedModelCatalog(EMBEDDED_CATALOG_FIXTURE),
  );

  const selected = __selectCodexModelIds([
    'gpt-image-1',
    'whisper-1',
    'gpt-5.5',
    'gpt-5.4-mini',
    'gpt-4o',
    'gpt-5.3-codex-spark',
  ], catalog);

  assert.deepEqual(selected, [
    'gpt-5.5',
    'gpt-5.4-mini',
    'gpt-5.3-codex-spark',
  ]);
});

test('builds API-backed catalog without appending API-invisible embedded models', () => {
  const catalog = __normalizeCodexModelCatalog(
    __extractEmbeddedModelCatalog(EMBEDDED_CATALOG_FIXTURE),
  );

  const merged = __mergeCatalogWithModelList(catalog, ['gpt-5.3-codex-spark'], {
    appendCatalogModels: false,
  });

  assert.equal(merged.defaultModel, 'gpt-5.3-codex-spark');
  assert.deepEqual(
    merged.models.map((model) => model.value),
    ['gpt-5.3-codex-spark'],
  );
  assert.deepEqual(
    merged.models[0].reasoningOptions.map((option) => option.value),
    ['medium', 'high'],
  );
  assert.deepEqual(merged.models[0].serviceTiers, []);
});

test('discovers Codex models from OpenAI API and local metadata cache', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'ozw-codex-models-'));
  try {
    const codexDir = join(tempHome, '.codex');
    await mkdir(codexDir);
    await writeFile(
      join(codexDir, 'models_cache.json'),
      JSON.stringify(__extractEmbeddedModelCatalog(EMBEDDED_CATALOG_FIXTURE)),
      'utf8',
    );

    const catalog = await discoverCodexModelCatalog({
      env: {
        HOME: tempHome,
        OPENAI_API_KEY: 'test-key',
      },
      fetchImpl: async (url, request) => {
        assert.equal(url, 'https://api.openai.com/v1/models');
        assert.equal(request.headers.Authorization, 'Bearer test-key');
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: 'gpt-image-1' },
              { id: 'gpt-5.3-codex-spark' },
            ],
          }),
        };
      },
    });

    assert.equal(catalog.source, 'openai-models-api');
    assert.deepEqual(
      catalog.models.map((model) => model.value),
      ['gpt-5.3-codex-spark'],
    );
    assert.deepEqual(
      catalog.models[0].reasoningOptions.map((option) => option.value),
      ['medium', 'high'],
    );
    assert.deepEqual(catalog.models[0].serviceTiers, []);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});
