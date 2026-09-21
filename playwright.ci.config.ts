/**
 * PURPOSE: Keep the required CI browser gate focused on active specification
 * contracts; the legacy end-to-end suite has its own slower smoke workflow.
 */
import baseConfig from './playwright.config.ts';

export default {
  ...baseConfig,
  testDir: '.',
  testMatch: [
    'tests/spec/**/*.spec.ts',
    'docs/changes/**/tests/**/*.spec.ts',
  ],
  testIgnore: ['docs/changes/archive/**'],
};
