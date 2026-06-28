/**
 * 文件目的：让 32 提案的浏览器合同测试复用仓库真实 Playwright 夹具和本地服务。
 */
import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import baseConfig from '../../../playwright.config.ts';

const CHANGE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(CHANGE_DIR, '../../..');

export default defineConfig({
  ...baseConfig,
  testDir: path.join(CHANGE_DIR, 'tests'),
  testMatch: '**/*.spec.ts',
  outputDir: path.join(REPO_ROOT, 'test-results', '32-history-prefetch', 'playwright'),
  globalSetup: path.join(REPO_ROOT, 'tests/e2e/helpers/playwright-global-setup.ts'),
  use: {
    ...baseConfig.use,
    trace: 'off',
  },
});
