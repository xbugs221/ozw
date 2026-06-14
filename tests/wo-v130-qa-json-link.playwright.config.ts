/**
 * PURPOSE: Run archived proposal 69 Playwright contract test from root tests/.
 */
import path from 'node:path';
import baseConfig from '../playwright.config.ts';

process.env.CCFLOW_FAKE_RUNNER = process.env.CCFLOW_FAKE_RUNNER || '1';
process.env.CCFLOW_FAKE_RUNNER_DELAY_MS = process.env.CCFLOW_FAKE_RUNNER_DELAY_MS || '8000';
process.env.CODEX_INDEX_CACHE_TTL_MS = '0';

export default {
  ...baseConfig,
  globalSetup: path.resolve(process.cwd(), 'tests/e2e/helpers/playwright-global-setup.ts'),
  outputDir: path.resolve(process.cwd(), 'test-results/archive-69-wo-v130-qa-json-link'),
  testDir: '.',
  testMatch: ['2026-06-04-69-适配wo计划验收合并阶段并开放QA-JSON链接-wo-v130-qa-json-link.spec.ts'],
};
