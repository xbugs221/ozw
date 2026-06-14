/**
 * PURPOSE: Playwright configuration for manual diagnostics that require
 * developer-provided external state and should not run in default e2e suites.
 */
import baseConfig from './playwright.config.ts';

export default {
  ...baseConfig,
  testDir: './tests/manual',
  testMatch: '**/*.spec.ts',
};
