/**
 * PURPOSE: Verify that specific historical compatibility shims identified
 * in the 51st change proposal have been removed from the codebase.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = process.cwd();

function readSource(...segments: string[]): string {
  return readFileSync(path.join(ROOT, ...segments), 'utf8');
}

test('settingsStorage.ts must not contain LEGACY_PROVIDER_SETTINGS_KEY fallback', () => {
  const content = readSource('src', 'utils', 'settingsStorage.ts');

  assert.ok(
    !content.includes('LEGACY_PROVIDER_SETTINGS_KEY'),
    'LEGACY_PROVIDER_SETTINGS_KEY must be removed from settingsStorage.ts',
  );
  assert.ok(
    !content.includes('claude-settings'),
    'Fallback read of "claude-settings" localStorage key must be removed',
  );
});

test('useSettingsController.ts must not map retired tabs', () => {
  const content = readSource('src', 'components', 'settings', 'hooks', 'useSettingsController.ts');

  assert.ok(
    !content.includes("tab === 'tools'"),
    'Retired tab compatibility for "tools" must be removed',
  );
  assert.ok(
    !content.includes("tab === 'tasks'"),
    'Retired tab compatibility for "tasks" must be removed',
  );
  assert.ok(
    !content.includes("tab === 'git'"),
    'Retired tab compatibility for "git" must be removed',
  );
  assert.ok(
    !content.includes("tab === 'api'"),
    'Retired tab compatibility for "api" must be removed',
  );
});

test('StandaloneShell.tsx must not expose compact prop', () => {
  const content = readSource('src', 'components', 'standalone-shell', 'view', 'StandaloneShell.tsx');

  assert.ok(
    !content.includes('compact?:'),
    'StandaloneShellProps must not include compact prop',
  );
  assert.ok(
    !content.includes('void compact'),
    'Component body must not contain void compact placeholder',
  );
});

test('MicButton.tsx must not expose mode prop', () => {
  const content = readSource('src', 'components', 'mic-button', 'view', 'MicButton.tsx');

  assert.ok(
    !content.includes('mode?:'),
    'MicButtonProps must not include mode prop',
  );
  assert.ok(
    !content.includes('void _mode'),
    'Component body must not contain void _mode placeholder',
  );
});
