/**
 * PURPOSE: Verify first-run credential output is delayed until a successful
 * HTTP listen callback and never exposes a token to non-interactive logs.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { formatFirstRunFailureHint, formatFirstRunNotice, printFirstRunNotice } from '../../backend/server/first-run-notice.ts';

const state = {
  accessTokenGenerated: true,
  accessToken: 'a'.repeat(32),
  envPath: '/private/.ozw/.env',
};

/**
 * Close an HTTP server after each listen-boundary test.
 */
function closeServer(server: http.Server): Promise<void> {
  /** A created server must not hold the test process open. */
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test('TTY first-run notice includes URL, configuration path, and token', () => {
  /** Operators at a terminal may copy the newly generated credential once. */
  const lines = formatFirstRunNotice(state, {
    displayHost: '127.0.0.1',
    port: 3001,
    isTTY: true,
  });

  assert.match(lines.join('\n'), /Login URL: http:\/\/127\.0\.0\.1:3001/);
  assert.match(lines.join('\n'), /Configuration: \/private\/.ozw\/.env/);
  assert.match(lines.join('\n'), new RegExp(`Access token: ${state.accessToken}`));
});

test('non-TTY first-run notice never includes the access token', () => {
  /** CI and redirected process logs must not disclose the browser credential. */
  const lines = formatFirstRunNotice(state, {
    displayHost: '127.0.0.1',
    port: 3001,
    isTTY: false,
  });

  assert.match(lines.join('\n'), /Login URL:/);
  assert.match(lines.join('\n'), /Configuration:/);
  assert.doesNotMatch(lines.join('\n'), new RegExp(state.accessToken));
});

test('port collision does not execute the successful-listen credential output', async () => {
  /** A failed bind must leave token display exclusively behind a successful callback. */
  const occupied = http.createServer();
  await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
  const address = occupied.address();
  assert.ok(address && typeof address !== 'string');

  const contender = http.createServer();
  const lines: string[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      contender.once('error', reject);
      contender.listen(address.port, '127.0.0.1', () => {
        printFirstRunNotice(state, {
          displayHost: '127.0.0.1',
          port: address.port,
          isTTY: true,
        }, (line) => lines.push(line));
        resolve();
      });
    }).then(
      () => assert.fail('port collision unexpectedly listened'),
      (error: NodeJS.ErrnoException) => assert.equal(error.code, 'EADDRINUSE'),
    );

    assert.equal(lines.length, 0);
    assert.doesNotMatch(lines.join('\n'), new RegExp(state.accessToken));
    const recoveryHint = formatFirstRunFailureHint(state);
    assert.match(recoveryHint ?? '', /\/private\/.ozw\/.env/);
    assert.doesNotMatch(recoveryHint ?? '', new RegExp(state.accessToken));
  } finally {
    await closeServer(occupied);
    if (contender.listening) await closeServer(contender);
  }
});
