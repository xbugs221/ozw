// Sources: 40-支持只读浏览Hermes对话历史
/**
 * PURPOSE: Preserve the Hermes provider boundary after the originating change
 * is archived. Hermes may expose stored history, but never becomes a writable
 * Codex fallback or a realtime runtime session.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveProjectSessionProvider } from '../../frontend/components/chat/session/sessionIdentity.ts';
import { getProjectSessions, providerToSessionsKey } from '../../frontend/hooks/projects/projectSessionCollections.ts';
import { getProviderCapabilities, normalizeSessionProvider } from '../../frontend/utils/providerCapabilities.ts';

test('Hermes uses a profile-scoped session bucket and unknown providers fail closed', () => {
  const project = {
    name: 'hermes-project',
    fullPath: '/work/hermes-project',
    codexSessions: [{ id: 'codex-session', __provider: 'codex' }],
    piSessions: [],
    claudeSessions: [],
    hermesSessions: [{
      id: 'default~same-raw-session',
      providerSessionId: 'same-raw-session',
      providerScope: 'default',
      __provider: 'hermes',
      provider: 'hermes',
    }],
  };

  assert.equal(providerToSessionsKey('hermes'), 'hermesSessions');
  assert.equal(getProjectSessions(project as never).some((session) => session.id === 'default~same-raw-session'), true);
  assert.equal(
    resolveProjectSessionProvider(project as never, 'default~same-raw-session', project.hermesSessions[0] as never),
    'hermes',
  );
  assert.equal(normalizeSessionProvider('not-a-provider'), null);
  assert.equal(getProviderCapabilities('not-a-provider'), null);
});

test('Hermes capability grants only stored-session list and history reads', () => {
  assert.deepEqual(getProviderCapabilities('hermes'), {
    listSessions: true,
    readHistory: true,
    createSession: false,
    sendMessage: false,
    renameSession: false,
    deleteSession: false,
    subscribeRealtime: false,
    checkRuntimeStatus: false,
    shellResume: false,
  });
});
