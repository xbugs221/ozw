/**
 * Sources: 2026-06-17-21-前端聊天session-identity收敛
 *
 * PURPOSE: Verify frontend chat session identity rules stay centralized in a
 * pure module shared by the chat view, composer, realtime handlers and session
 * state loader.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const IDENTITY_MODULE = 'frontend/components/chat/session/sessionIdentity.ts';
const EVIDENCE_PATH = path.join(REPO_ROOT, 'test-results/21-chat-session-identity/source-audit.json');

const CONSUMER_FILES = [
  'frontend/components/chat/view/ChatInterface.tsx',
  'frontend/components/chat/composer/useChatComposerStateImpl.ts',
  'frontend/components/chat/hooks/useChatRealtimeHandlersImpl.ts',
  'frontend/components/chat/session/useChatSessionStateImpl.ts',
];

/**
 * Read a repository file as UTF-8 text.
 */
async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * Return whether a repository file exists.
 */
async function sourceExists(relativePath: string): Promise<boolean> {
  try {
    await stat(path.join(REPO_ROOT, relativePath));
    return true;
  } catch {
    return false;
  }
}

/**
 * Count duplicate local definitions for session identity helpers.
 */
async function countDuplicateHelpers(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const relativePath of CONSUMER_FILES) {
    const source = await readRepoFile(relativePath);
    counts[relativePath] = (
      source.match(/\b(?:const|function)\s+(?:isTemporarySessionId|isUnsavedSessionId|isCbwRouteSessionId|resolveProjectSessionProvider|resolveSessionRoutingContext)\b/g) || []
    ).length;
  }
  return counts;
}

/**
 * Persist source and sample-result evidence for reviewers.
 */
async function writeEvidence(snapshot: unknown): Promise<void> {
  await mkdir(path.dirname(EVIDENCE_PATH), { recursive: true });
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

test('chat session identity rules are centralized and business samples resolve correctly', async () => {
  const duplicateHelpers = await countDuplicateHelpers();
  const hasIdentityModule = await sourceExists(IDENTITY_MODULE);
  const identitySource = hasIdentityModule ? await readRepoFile(IDENTITY_MODULE) : '';
  const exportedNames = [
    'isTemporarySessionId',
    'isCbwRouteSessionId',
    'getSessionLoadId',
    'resolveProjectSessionProvider',
    'resolveSessionRoutingContext',
  ].filter((name) => new RegExp(`\\b${name}\\b`).test(identitySource));

  const snapshot: Record<string, unknown> = {
    hasIdentityModule,
    exportedNames,
    duplicateHelpers,
    sampleResults: null,
  };

  assert.equal(hasIdentityModule, true, `${IDENTITY_MODULE} must exist`);

  const identity = await import(pathToFileURL(path.join(REPO_ROOT, IDENTITY_MODULE)).href) as {
    isTemporarySessionId(value?: string | null): boolean;
    isCbwRouteSessionId(value?: string | null): boolean;
    getSessionLoadId(session?: Record<string, unknown> | null): string;
    resolveProjectSessionProvider(project: unknown, sessionId?: string | null): 'codex' | 'pi' | null;
    resolveSessionRoutingContext(project: unknown, session: unknown, fallbackProvider?: 'codex' | 'pi'): {
      projectName: string;
      projectPath: string;
      provider: 'codex' | 'pi' | null;
      workflowId?: string;
      workflowStageKey?: string;
    };
  };

  const project = {
    name: 'demo',
    fullPath: '/work/demo',
    path: '/work/demo',
    codexSessions: [{ id: 'codex-native-1', routeIndex: 1 }],
    piSessions: [{ id: 'pi-native-9', routeIndex: 7 }],
  };
  const workflowSession = {
    id: 'workflow-child-1',
    __provider: 'pi',
    __projectName: 'demo-child',
    projectPath: '/work/demo-child',
    workflowId: 'run-1',
    stageKey: 'review_1',
  };

  const sampleResults = {
    newSessionIsTemporary: identity.isTemporarySessionId('new-session-1'),
    cRouteIsRoute: identity.isCbwRouteSessionId('c7'),
    codexProvider: identity.resolveProjectSessionProvider(project, 'codex-native-1'),
    piRouteProvider: identity.resolveProjectSessionProvider(project, 'c7'),
    routeBackedLoadId: identity.getSessionLoadId({
      id: '019ed912-8c02-7b40-9dff-85d1a90d02ec',
      routeIndex: 365,
      providerSessionId: '019ed912-8c02-7b40-9dff-85d1a90d02ec',
    }),
    workflowContext: identity.resolveSessionRoutingContext(project, workflowSession, 'codex'),
  };
  snapshot.sampleResults = sampleResults;
  await writeEvidence(snapshot);

  assert.deepEqual(exportedNames.sort(), [
    'getSessionLoadId',
    'isCbwRouteSessionId',
    'isTemporarySessionId',
    'resolveProjectSessionProvider',
    'resolveSessionRoutingContext',
  ].sort());
  assert.equal(sampleResults.newSessionIsTemporary, true, 'new-session-* must resolve as a temporary draft');
  assert.equal(sampleResults.cRouteIsRoute, true, 'cN must resolve as an ozw route alias');
  assert.equal(sampleResults.codexProvider, 'codex', 'direct Codex session id must resolve to codex');
  assert.equal(sampleResults.piRouteProvider, 'pi', 'cN routeIndex must resolve to the Pi session provider');
  assert.equal(
    sampleResults.routeBackedLoadId,
    'c365',
    'provider-backed cN pages must load messages through the route id so active-turn overlay is preserved',
  );
  assert.deepEqual(sampleResults.workflowContext, {
    projectName: 'demo-child',
    projectPath: '/work/demo-child',
    provider: 'pi',
    workflowId: 'run-1',
    workflowStageKey: 'review_1',
  });
  assert.deepEqual(
    Object.entries(duplicateHelpers).filter(([, count]) => count > 0),
    [],
    'chat components and hooks must not define duplicate session identity helpers',
  );
});
