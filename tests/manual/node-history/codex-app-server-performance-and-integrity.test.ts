// @ts-nocheck -- Proposal acceptance test: execution phase owns final strictness.
/**
 * PURPOSE: Guard the Codex app-server steer migration against the old message
 * duplication/loss regressions and avoid project-wide realtime performance
 * regressions.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

/**
 * Read a UTF-8 source file from the repository root.
 */
async function source(path) {
  return readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
}

test('Codex capability and composer default running behavior use steer, not queue', async () => {
  const runtimeSource = await source('backend/native-agent-runtime.ts');
  const composerSource = await source('frontend/components/chat/hooks/useChatComposerState.ts');

  assert.match(
    runtimeSource,
    /codex:\s*{[\s\S]*runningInput:\s*\[[^\]]*['"]steer['"]/,
    'Codex provider capabilities must advertise steer for running manual input',
  );
  assert.match(
    runtimeSource,
    /codex:\s*{[\s\S]*steer:\s*true/,
    'Codex provider capabilities must set steer=true',
  );
  assert.doesNotMatch(
    composerSource,
    /provider\s*===\s*['"]codex['"][\s\S]{0,200}runningBehavior\s*=\s*['"]queue['"]/,
    'Codex running composer input must not default to queue after app-server steer migration',
  );
});

test('Codex app-server runtime is long-lived and does not broadcast full project snapshots for live events', async () => {
  const runtimeSource = await source('backend/codex-app-server-runtime.ts');

  assert.match(
    runtimeSource,
    /turn\/steer/,
    'runtime must call the Codex app-server turn/steer method',
  );
  assert.match(
    runtimeSource,
    /expectedTurnId/,
    'runtime must send expectedTurnId so stale active-turn state cannot steer the wrong turn',
  );
  assert.match(
    runtimeSource,
    /(getOrCreate|ensure).{0,40}(AppServer|Client|Daemon)/s,
    'runtime must reuse an app-server client/daemon instead of spawning per message',
  );
  assert.doesNotMatch(
    runtimeSource,
    /broadcastProjectsUpdated|projects_updated\s*{[\s\S]*projects\s*:/,
    'app-server live notifications must not send full project snapshots',
  );
});

test('terminal transcript reconcile still drops stale live cards and scoped refresh avoids full project fetch', async () => {
  const realtimeSource = await source('frontend/components/chat/hooks/useChatRealtimeHandlers.ts');
  const projectsStateSource = await source('frontend/hooks/useProjectsState.ts');
  const codexCompleteBlock = realtimeSource.match(/case 'codex-complete': \{[\s\S]*?break;/)?.[0] || '';
  const codexErrorBlock = realtimeSource.match(/case 'codex-error': \{[\s\S]*?break;/)?.[0] || '';
  const sessionAbortedBlock = realtimeSource.match(/case 'session-aborted': \{[\s\S]*?break;/)?.[0] || '';

  assert.deepEqual(
    [...codexCompleteBlock.matchAll(/preserveLiveMessages:\s*(true|false)/g)].map((match) => match[1]),
    ['true', 'true'],
    'codex-complete must preserve live rows while delayed JSONL catches up',
  );
  assert.match(
    codexErrorBlock,
    /preserveLiveMessages:\s*false/,
    'codex-error must still let provider history be terminal authority',
  );
  assert.match(
    sessionAbortedBlock,
    /preserveLiveMessages:\s*false/,
    'abort reconcile must still let provider history be terminal authority',
  );
  assert.doesNotMatch(
    projectsStateSource,
    /if\s*\(\s*latestMessage\.type\s*===\s*['"]session_changed['"][\s\S]{0,500}fetchProjects\s*\(/,
    'session_changed handling must stay scoped and avoid /api/projects full refresh',
  );
  assert.match(
    realtimeSource,
    /window\.setTimeout\([\s\S]*?,\s*500\)/,
    'terminal JSONL retry should remain bounded instead of becoming high-frequency polling',
  );
});

test('Codex composer only steers when a concrete active turn marker exists', async () => {
  const composerSource = await source('frontend/components/chat/hooks/useChatComposerState.ts');
  const realtimeSource = await source('frontend/components/chat/hooks/useChatRealtimeHandlers.ts');

  assert.match(
    composerSource,
    /function hasActiveTurnMarker/,
    'composer must distinguish stale processing markers from active-turn markers',
  );
  assert.match(
    composerSource,
    /provider\s*===\s*['"]codex['"][\s\S]*sessionHasActiveTurn[\s\S]*runningBehavior\s*=\s*['"]steer['"]/,
    'Codex must steer only when the current session has an active turn marker',
  );
  assert.match(
    realtimeSource,
    /removeItem\(`ozw-processing-session:\$\{sessionId\}`\)/,
    'terminal lifecycle cleanup must clear stale processing markers for every known alias',
  );
  assert.match(
    realtimeSource,
    /removeItem\(`ozw-active-turn:\$\{sessionId\}`\)/,
    'terminal lifecycle cleanup must clear stale active-turn markers for every known alias',
  );
});
