/**
 * PURPOSE: Dedicated Playwright configuration for OpenSpec acceptance tests,
 * oz change contract tests, and explicitly targeted e2e acceptance specs.
 * Reuses the main e2e fixture/bootstrap pipeline while keeping test discovery scoped.
 */
import baseConfig from './playwright.config.ts';

process.env.CCFLOW_FAKE_RUNNER = process.env.CCFLOW_FAKE_RUNNER || '1';
process.env.CCFLOW_FAKE_RUNNER_DELAY_MS = process.env.CCFLOW_FAKE_RUNNER_DELAY_MS || '8000';
process.env.CODEX_INDEX_CACHE_TTL_MS = '0';
process.env.PROJECTS_CACHE_TTL_MS = '0';

export default {
  ...baseConfig,
  testDir: '.',
  testMatch: [
    'tests/spec/**/*.spec.ts',
    'tests/e2e/**/*.spec.ts',
    'docs/changes/**/tests/**/*.spec.ts',
  ],
};
