/**
 * PURPOSE: Run manual acceptance checks against a developer-provided real ozw
 * instance without starting or mutating the isolated Playwright fixture server.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/manual',
  testMatch: [
    'manual-session-identity-real.spec.ts',
    'oz-flow-session-render-real.spec.ts',
  ],
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
