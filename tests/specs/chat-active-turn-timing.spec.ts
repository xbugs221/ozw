// @ts-nocheck -- Static contract checks scan runtime/UI source patterns across TS/TSX files.
/**
 * Sources: 2026-06-13-108-记录聊天运行轮次开始时间
 *
 * PURPOSE: Verify active turn timing is anchored by backend turnStartedAt,
 * survives status refreshes, and drives the visible chat running indicator.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const rootDir = process.cwd();
const evidenceDir = path.join(rootDir, 'test-results', 'active-turn-started-at');

/**
 * Read a repository file by relative path so assertions exercise real source.
 *
 * @param {string} relativePath
 * @returns {Promise<string>}
 */
async function readProjectFile(relativePath) {
  return readFile(path.join(rootDir, relativePath), 'utf8');
}

/**
 * Persist a compact state snapshot for review and QA evidence collection.
 *
 * @param {string} fileName
 * @param {Record<string, boolean>} checks
 * @returns {Promise<void>}
 */
async function writeEvidence(fileName, checks) {
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    path.join(evidenceDir, fileName),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), checks }, null, 2)}\n`,
    'utf8',
  );
}

test('backend active turn status exposes stable turnStartedAt', async () => {
  /**
   * Business rule: backend owns the turn timing anchor. Status pushes and status
   * queries must expose that same anchor instead of letting a refresh reset it.
   */
  const nativeRuntime = await readProjectFile('backend/native-agent-runtime.ts');
  const codexRuntime = await readProjectFile('backend/codex-app-server-runtime.ts');
  const chatWebSocket = await readProjectFile('backend/server/chat-websocket.ts');

  const checks = {
    runtimeEventCarriesTurnStartedAt:
      /type:\s*'session-status'[\s\S]*turnStartedAt\?:\s*string/.test(nativeRuntime),
    nativeRecordsHaveTurnStartedAt:
      /type\s+CodexSessionRecord[\s\S]*turnStartedAt\??:/.test(nativeRuntime)
      && /type\s+PiSessionRecord[\s\S]*turnStartedAt\??:/.test(nativeRuntime),
    nativeStatusReturnsTurnStartedAt:
      /getNativeSessionStatus[\s\S]*turnStartedAt/.test(nativeRuntime),
    nativeProcessingStatusSendsTurnStartedAt:
      /type:\s*'session-status'[\s\S]*isProcessing:\s*true[\s\S]*turnStartedAt/.test(nativeRuntime),
    codexAppServerStoresTurnStartedAt:
      /turnStartedAt\??:/.test(codexRuntime)
      && /case\s+'turn\/started'[\s\S]*turnStartedAt/.test(codexRuntime),
    codexAppServerStatusReturnsTurnStartedAt:
      /getCodexAppServerSessionStatus[\s\S]*turnStartedAt/.test(codexRuntime),
    websocketCheckSessionStatusPassesTurnStartedAt:
      /type:\s*'session-status'[\s\S]*turnStartedAt:\s*status\.turnStartedAt/.test(chatWebSocket)
      || /check-session-status[\s\S]*turnStartedAt:\s*status\.turnStartedAt/.test(nativeRuntime),
    runningFollowupDoesNotResetTurnStartedAt:
      /wasRunning[\s\S]*turnStartedAt/.test(nativeRuntime)
      || /if\s*\([^)]*!.*running[\s\S]*turnStartedAt\s*=/.test(nativeRuntime),
  };

  await writeEvidence('backend-contract.json', checks);

  for (const [name, passed] of Object.entries(checks)) {
    assert.equal(passed, true, `缺少后端 turnStartedAt 合同项: ${name}`);
  }
});

test('frontend chat composer renders active turn indicator from backend turnStartedAt', async () => {
  /**
   * Business rule: the visible running timer must use the backend active turn
   * start time and disappear when the turn stops.
   */
  const realtimeHandlers = await readProjectFile('frontend/components/chat/hooks/useChatRealtimeHandlers.ts');
  const chatInterface = await readProjectFile('frontend/components/chat/view/ChatInterface.tsx');
  const chatComposer = await readProjectFile('frontend/components/chat/view/subcomponents/ChatComposer.tsx');
  const runningVerbs = await readProjectFile('frontend/components/chat/constants/runningVerbs.ts');
  const chatSources = [realtimeHandlers, chatInterface, chatComposer, runningVerbs].join('\n');

  const checks = {
    realtimeReadsTurnStartedAt:
      /latestMessage\.turnStartedAt/.test(realtimeHandlers)
      || /latestMessage\[['"]turnStartedAt['"]\]/.test(realtimeHandlers),
    stateTracksActiveTurnStartedAt:
      /activeTurnStartedAt/.test(chatSources) || /turnStartedAt/.test(chatInterface),
    indicatorHasStableTestId:
      /data-testid=["']chat-active-turn-indicator["']/.test(chatSources),
    elapsedHasStableTestId:
      /data-testid=["']chat-active-turn-elapsed["']/.test(chatSources),
    elapsedUsesBackendAbsoluteTime:
      /Date\.parse\([^)]*turnStartedAt/.test(chatSources)
      || /new Date\([^)]*turnStartedAt/.test(chatSources),
    elapsedRefreshesEverySecond:
      /setInterval[\s\S]*1000/.test(chatComposer),
    statusUsesLocalVerbPool:
      /RUNNING_STATUS_VERBS/.test(runningVerbs)
      && /RUNNING_STATUS_VERBS[\s\S]*Analyze[\s\S]*Verify/.test(runningVerbs)
      && !/\['Thinking', 'Reading context', 'Working'\]/.test(chatComposer),
    statusVerbRotatesEveryFiveSeconds:
      /RUNNING_VERB_INTERVAL_MS\s*=\s*5000/.test(runningVerbs)
      && /setInterval[\s\S]*RUNNING_VERB_INTERVAL_MS/.test(chatComposer),
    indicatorClearsWhenTurnStops:
      /setActiveTurnStartedAt\(null\)/.test(chatSources)
      || /activeTurnStartedAt[^=]*=\s*null/.test(chatSources),
  };

  await writeEvidence('frontend-contract.json', checks);

  for (const [name, passed] of Object.entries(checks)) {
    assert.equal(passed, true, `缺少前端 active turn 提示合同项: ${name}`);
  }
});
