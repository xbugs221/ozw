/**
 * PURPOSE: Playwright end-to-end test configuration for CCUI.
 * Starts isolated local API/UI servers against a dedicated e2e HOME fixture,
 * then runs browser smoke tests without depending on the developer's real machine state.
 */
import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  PLAYWRIGHT_FIXTURE_AUTH_DB,
  PLAYWRIGHT_FIXTURE_HOME,
} from './tests/e2e/helpers/playwright-fixture.ts';

/**
 * Merge local `.env` values into process.env so Playwright derives ports from the
 * same source as the server bootstrap. Shell-provided variables still win.
 */
function loadOptionalEnvFile() {
  try {
    const envPath = path.join(process.cwd(), '.env');
    const envFile = fs.readFileSync(envPath, 'utf8');
    envFile.split('\n').forEach((line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith('#')) {
        return;
      }

      const [key, ...valueParts] = trimmedLine.split('=');
      if (key && valueParts.length > 0 && !process.env[key]) {
        process.env[key] = valueParts.join('=').trim();
      }
    });
  } catch (error) {
    const err = error as NodeJS.ErrnoException | null;
    if (err?.code !== 'ENOENT') {
      console.warn('Failed to load local .env file for Playwright:', err?.message || String(error));
    }
  }
}

loadOptionalEnvFile();

const ORIGINAL_HOME = process.env.HOME || process.env.USERPROFILE || process.cwd();
process.env.PLAYWRIGHT_ORIGINAL_HOME ||= ORIGINAL_HOME;
const PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH
  || path.join(ORIGINAL_HOME, '.cache', 'ms-playwright');

process.env.HOME = PLAYWRIGHT_FIXTURE_HOME;
process.env.USERPROFILE = PLAYWRIGHT_FIXTURE_HOME;
process.env.DATABASE_PATH = PLAYWRIGHT_FIXTURE_AUTH_DB;
process.env.XDG_STATE_HOME = path.join(process.cwd(), '.tmp', 'playwright-state-home');
process.env.PLAYWRIGHT_BROWSERS_PATH = PLAYWRIGHT_BROWSERS_PATH;
process.env.SHELL = '/bin/bash';

const AUTH_DB_PATH = PLAYWRIGHT_FIXTURE_AUTH_DB;
const SERVER_PORT = process.env.PLAYWRIGHT_SERVER_PORT || '4101';
const VITE_PORT = process.env.PLAYWRIGHT_VITE_PORT || '6174';
const HOST = process.env.PLAYWRIGHT_HOST || '127.0.0.1';
const DEFAULT_BASE_URL = `http://${HOST}:${VITE_PORT}`;
const EXTERNAL_BASE_URL = process.env.CCUI_E2E_BASE_URL || '';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  outputDir: './tests/test-results',
  fullyParallel: false,
  workers: 1,
  globalSetup: EXTERNAL_BASE_URL.length === 0
    ? './tests/e2e/helpers/playwright-global-setup.ts'
    : undefined,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: EXTERNAL_BASE_URL || DEFAULT_BASE_URL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  reporter: 'line',
});
