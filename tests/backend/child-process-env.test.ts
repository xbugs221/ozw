/**
 * PURPOSE: Verify user-visible shells and provider children retain useful user
 * configuration without inheriting ozw authentication or private runtime paths.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPortableCodexSpawnEnv } from '../../backend/domains/codex-app-server/stdio-transport.ts';
import { buildManagedTerminalEnvironment } from '../../backend/server/shell-websocket.ts';

const PRIVATE_VALUES: NodeJS.ProcessEnv = {
  API_KEY: 'legacy-browser-secret',
  DATABASE_PATH: '/private/ozw.db',
  OZW_ACCESS_TOKEN: 'browser-token',
  OZW_CLAUDE_ENV_FILE: '/private/claude.env',
  OZW_DATABASE_PATH_DEFAULTED: 'true',
  OZW_HOME: '/private/.ozw',
  OZW_JWT_SECRET_PATH: '/private/.jwt-secret',
  OZW_NEW_INTERNAL_PATH: '/private/future-state',
};

/** Assert one child environment keeps provider/user values but removes ozw secrets. */
function assertSanitizedEnvironment(environment: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(PRIVATE_VALUES)) {
    assert.equal(environment[key], undefined, `${key} must not reach a child process`);
  }
  assert.equal(environment.OPENAI_API_KEY, 'provider-key');
  assert.equal(environment.CUSTOM_USER_VALUE, 'keep-me');
}

test('managed shell environment removes ozw secrets and preserves user configuration', () => {
  /** Business case: an interactive terminal must not expose the Web UI token. */
  const environment = buildManagedTerminalEnvironment({
    ...PRIVATE_VALUES,
    CUSTOM_USER_VALUE: 'keep-me',
    NO_COLOR: '1',
    OPENAI_API_KEY: 'provider-key',
    PATH: '/usr/bin',
  });

  assertSanitizedEnvironment(environment);
  assert.equal(environment.NO_COLOR, undefined);
  assert.equal(environment.TERM, 'xterm-256color');
});

test('Codex spawn environment removes ozw secrets and preserves provider credentials', () => {
  /** Business case: Codex receives its provider key and executable PATH, not ozw credentials. */
  const environment = buildPortableCodexSpawnEnv({
    ...PRIVATE_VALUES,
    CUSTOM_USER_VALUE: 'keep-me',
    HOME: '/users/example',
    OPENAI_API_KEY: 'provider-key',
    PATH: '/custom/bin',
  });

  assertSanitizedEnvironment(environment);
  assert.match(environment.PATH ?? '', /\/users\/example\/\.local\/bin/u);
  assert.match(environment.PATH ?? '', /\/custom\/bin/u);
});
