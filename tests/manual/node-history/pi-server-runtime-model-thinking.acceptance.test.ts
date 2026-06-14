import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('server exposes a Pi model catalog API backed by Pi model discovery', () => {
  const indexSource = readRepoFile('backend/index.ts');

  assert.match(indexSource, /app\.get\('\/api\/pi\/models'/, 'server must expose GET /api/pi/models');
  assert.match(indexSource, /getPiModelCatalog|getPiModels|loadPiModelCatalog/, 'GET /api/pi/models must call Pi model catalog discovery');

  const piModelsSource = readRepoFile('backend/pi-models.ts');
  assert.match(piModelsSource, /ModelRegistry/, 'Pi model catalog must use Pi ModelRegistry');
  assert.match(piModelsSource, /getAvailable\(\)/, 'Pi model catalog should expose authenticated available models');
  assert.match(piModelsSource, /thinkingLevelMap/, 'Pi model catalog must respect model-specific thinkingLevelMap');
  assert.match(piModelsSource, /off|minimal|low|medium|high|xhigh/, 'Pi model catalog must expose Pi thinking levels');
});

test('websocket pi-command forwards model and thinkingLevel to native runtime', () => {
  const source = readRepoFile('backend/index.ts');
  const piCommandIndex = source.indexOf("data.type === 'pi-command'");
  assert.notEqual(piCommandIndex, -1, 'server must handle pi-command messages');

  const piBranch = source.slice(piCommandIndex, piCommandIndex + 4500);
  assert.match(piBranch, /sendNativeMessage\(\{[\s\S]*provider:\s*'pi'/, 'pi-command must call sendNativeMessage for provider pi');
  assert.match(piBranch, /model:\s*piProviderOptions\?\.model|model:\s*resolvedOptions\?\.model|model:\s*data\.options\?\.model/, 'pi-command must forward selected Pi model');
  assert.match(piBranch, /thinkingLevel:\s*piProviderOptions\?\.thinkingLevel|thinkingLevel:\s*resolvedOptions\?\.thinkingLevel|thinkingLevel:\s*data\.options\?\.thinkingLevel/, 'pi-command must forward selected Pi thinkingLevel');
});

test('native Pi runtime applies model and thinkingLevel through Pi AgentSession APIs', () => {
  const source = readRepoFile('backend/native-agent-runtime.ts');

  assert.match(source, /thinkingLevel\??:\s*string/, 'sendNativeMessage / Pi options must accept thinkingLevel');
  assert.match(
    source,
    /createAgentSession\(\{[\s\S]{0,900}model:[\s\S]{0,900}thinkingLevel:/,
    'new Pi sessions must call createAgentSession with model and thinkingLevel',
  );
  assert.match(source, /\.setModel\(/, 'idle Pi sessions must be able to apply model changes with setModel()');
  assert.match(source, /\.setThinkingLevel\(/, 'idle Pi sessions must be able to apply thinking level changes with setThinkingLevel()');
  assert.match(source, /queue_update[\s\S]{0,1000}session-queue-state/, 'Pi queue_update must be forwarded as a frontend queue-state event');
  assert.doesNotMatch(source, /ev\.type === 'model_select'|ev\.type === 'thinking_level_select'/, 'Pi runtime must not listen for extension-only model events through AgentSession.subscribe');
  assert.match(source, /thinking_level_changed[\s\S]{0,400}broadcastPiModelState/, 'Pi runtime must observe subscribe thinking_level_changed events');
  assert.match(source, /session\.session\.setModel\([\s\S]{0,500}session-model-state-updated/, 'idle Pi model changes must broadcast canonical session model state');
});

test('frontend consumes Pi queue state and shows running queue semantics', () => {
  const realtimeSource = readRepoFile('frontend/components/chat/hooks/useChatRealtimeHandlers.ts');
  const interfaceSource = readRepoFile('frontend/components/chat/view/ChatInterface.tsx');
  const composerSource = readRepoFile('frontend/components/chat/view/subcomponents/ChatComposer.tsx');

  assert.match(realtimeSource, /case 'session-queue-state'/, 'frontend realtime handler must consume Pi queue state');
  assert.match(interfaceSource, /setPiQueueState/, 'ChatInterface must hold Pi queue state for the active session');
  assert.match(composerSource, /data-testid="pi-running-queue-state"/, 'composer must render Pi queue state while running');
  assert.match(composerSource, /current input will steer this turn/, 'composer must explain steer semantics for running Pi input');
  assert.match(composerSource, /follow-up messages run later/, 'composer must explain follow-up semantics for queued Pi input');
  assert.match(composerSource, /Steering \{piSteeringCount\}/, 'composer must show steering queue count');
  assert.match(composerSource, /Follow-up \{piFollowUpCount\}/, 'composer must show follow-up queue count');
});

test('Pi queue state maps provider session events back to cN route sessions', async () => {
  const moduleUrl = pathToFileURL(path.join(repoRoot, 'frontend/components/chat/utils/piQueueState.ts')).href;
  const {
    buildPiQueueState,
    isPiQueueForActiveSession,
  } = await import(moduleUrl) as typeof import('../../../frontend/components/chat/utils/piQueueState');

  const queueState = buildPiQueueState({
    sessionId: 'pi-provider-1',
    ozwSessionId: 'c26',
    steering: ['s'],
    followUp: ['f'],
  });

  assert.deepEqual(queueState, {
    sessionId: 'c26',
    providerSessionId: 'pi-provider-1',
    steering: ['s'],
    followUp: ['f'],
  });
  assert.equal(isPiQueueForActiveSession(queueState, 'c26', 'c26'), true);
  assert.equal(isPiQueueForActiveSession(queueState, 'c27', 'c27'), false);
});

test('oz design and task describe the actual Pi SDK session event contract', () => {
  const designSource = readRepoFile('docs/changes/archive/2026-06-01-55-优化Pi会话模型和思考深度交互/design.md');
  const taskSource = readRepoFile('docs/changes/archive/2026-06-01-55-优化Pi会话模型和思考深度交互/task.md');

  assert.match(designSource, /thinking_level_changed -> session-model-state-updated/, 'design must document the AgentSession.subscribe thinking event');
  assert.match(designSource, /broadcast canonical session-model-state-updated/, 'design must document active canonical broadcast after idle model changes');
  assert.match(taskSource, /主动广播 canonical session model-state，并监听 `thinking_level_changed`/, 'task must match the implemented Pi runtime sync contract');
  assert.doesNotMatch(designSource, /model_select ->|thinking_level_select ->/, 'design must not claim extension-only events are AgentSession.subscribe events');
  assert.doesNotMatch(taskSource, /model_select|thinking_level_select/, 'task checklist must not keep the old extension-only event task');
});

test('Pi unavailable catalog blocks unknown model sends in the browser UI', () => {
  const providerStateSource = readRepoFile('frontend/components/chat/hooks/useChatProviderState.ts');
  const interfaceSource = readRepoFile('frontend/components/chat/view/ChatInterface.tsx');
  const composerStateSource = readRepoFile('frontend/components/chat/hooks/useChatComposerState.ts');
  const composerSource = readRepoFile('frontend/components/chat/view/subcomponents/ChatComposer.tsx');

  assert.match(providerStateSource, /if \(modelOptions\.length === 0\)[\s\S]{0,80}return ''/, 'empty Pi model catalog must not reuse persisted unknown model ids');
  assert.match(interfaceSource, /!piModelCatalogLoaded[\s\S]{0,140}Loading Pi model catalog/, 'Pi composer must expose a non-empty loading state before catalog discovery finishes');
  assert.match(interfaceSource, /piCanSend:\s*effectiveProvider !== 'pi' \|\| !piUnavailableMessage/, 'Pi submit guard must use the same blocked message that disables the composer');
  assert.match(composerStateSource, /provider === 'pi' && !piCanSend/, 'Pi submit path must block sends when no selectable model exists');
  assert.match(composerStateSource, /piUnavailableMessage\.trim\(\)[\s\S]{0,160}Pi is unavailable/, 'Pi blocked submit path must never append an empty error message');
  assert.match(composerSource, /data-testid="pi-model-unavailable"/, 'composer must show a user-visible Pi unavailable state');
});
