/**
 * Sources: 2026-06-16-5-Provider运行边界与AppServer重构, 2026-06-17-20-后端realtime协议与provider-runtime分层, 2026-06-19-30-移除OpenAI单次调用并统一Codex-app-server-steer, 41-接入Claude-Code会话与tmux-TUI
 *
 * PURPOSE: Verify the backend provider runtime boundary keeps Codex
 * app-server, Pi SDK, route binding, active-turn and live transcript ownership
 * separated in production source.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const SOURCE_AUDIT_PATH = path.join(REPO_ROOT, 'test-results/provider-runtime/source-audit.json');
const EVIDENCE_CONTRACTS = [
  'provider-runtime-source-audit -> test-results/provider-runtime/source-audit.json',
  'provider-binding-state -> test-results/provider-runtime/binding-state.json',
  'active-turn-runtime-log -> test-results/provider-runtime/active-turn-runtime.log',
];
const SOURCE_DIRS = ['backend', 'frontend', 'shared'];
const ACTIVE_SPEC_DIRS = ['docs/specs', 'tests/specs'];

type RuntimeSourceAudit = {
  oldCodexRuntimeExists: boolean;
  agentRouteImportsOldCodexRuntime: boolean;
  agentRouteCallsQueryCodex: boolean;
  agentRouteUsesAppServerRuntime: boolean;
  productionCodexExecJsonMatches: string[];
  productionOpenAiSdkImportMatches: string[];
  productionOpenAiHttpMatches: string[];
  frontendTranscribeRouteMatches: string[];
  packageHasOpenAiDependency: boolean;
  activeSpecMentionsOldRuntimeAsRequired: string[];
};

/**
 * Read a repository file as UTF-8 text.
 */
async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * Check whether a repository-relative path exists.
 */
async function exists(relativePath: string): Promise<boolean> {
  try {
    await stat(path.join(REPO_ROOT, relativePath));
    return true;
  } catch {
    return false;
  }
}

/**
 * Recursively list repository files relevant to runtime source contracts.
 */
async function listRuntimeFiles(relativeDir: string): Promise<string[]> {
  const root = path.join(REPO_ROOT, relativeDir);
  const result: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(REPO_ROOT, absolute);
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', 'test-results'].includes(entry.name)) {
          continue;
        }
        await walk(absolute);
        continue;
      }
      if (entry.isFile() && /\.(ts|tsx|js|jsx|json|md)$/.test(entry.name)) {
        result.push(relative);
      }
    }
  }

  if (await exists(relativeDir)) {
    await walk(root);
  }
  return result.sort();
}

/**
 * Return files whose content matches a forbidden runtime pattern.
 */
async function collectMatches(files: string[], pattern: RegExp): Promise<string[]> {
  const matches: string[] = [];
  for (const relativePath of files) {
    const source = await readRepoFile(relativePath);
    if (pattern.test(source)) {
      matches.push(relativePath);
    }
  }
  return matches;
}

/**
 * Return files with line-level active requirements for the removed runtime.
 */
async function collectOldRuntimeRequirementMatches(files: string[]): Promise<string[]> {
  const matches: string[] = [];
  const oldRuntimePattern = /backend\/openai-codex\.ts|queryCodex|codex\s+exec\s+--json/;
  const requirementPattern = /必须|应|需要|保留|继续/;
  const denialPattern = /不得|不能|不允许|不再|禁止|移除|删除/;

  for (const relativePath of files) {
    const source = await readRepoFile(relativePath);
    const hasRequirement = source
      .split(/\r?\n/)
      .some((line) => oldRuntimePattern.test(line)
        && requirementPattern.test(line)
        && !denialPattern.test(line));
    if (hasRequirement) {
      matches.push(relativePath);
    }
  }
  return matches;
}

/**
 * Assert that a module exposes a named function or const.
 */
function assertExports(source: string, symbol: string): void {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(source, new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${escaped}\\b`));
}

/**
 * Build and persist a source audit for Codex runtime and OpenAI direct-call removal.
 */
async function buildRuntimeSourceAudit(): Promise<RuntimeSourceAudit> {
  const sourceFiles = (
    await Promise.all(SOURCE_DIRS.map((dir) => listRuntimeFiles(dir)))
  ).flat();
  const activeSpecFiles = (
    await Promise.all(ACTIVE_SPEC_DIRS.map((dir) => listRuntimeFiles(dir)))
  ).flat();
  const agentRoute = (await exists('backend/routes/agent.impl.ts'))
    ? await readRepoFile('backend/routes/agent.impl.ts')
    : '';
  const packageJson = JSON.parse(await readRepoFile('package.json')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const audit: RuntimeSourceAudit = {
    oldCodexRuntimeExists: await exists('backend/openai-codex.ts'),
    agentRouteImportsOldCodexRuntime: /from\s+['"]\.\.\/openai-codex\.js['"]/.test(agentRoute),
    agentRouteCallsQueryCodex: /\bqueryCodex\s*\(/.test(agentRoute),
    agentRouteUsesAppServerRuntime:
      /codex-app-server|sendCodexAppServerMessage|createCodexAppServerRuntime|agent-session-runner/.test(agentRoute),
    productionCodexExecJsonMatches: await collectMatches(
      sourceFiles,
      /\[\s*['"]exec['"]\s*,\s*['"]--json['"]|codex\s+exec\s+--json/,
    ),
    productionOpenAiSdkImportMatches: await collectMatches(
      sourceFiles,
      /import\s*\(\s*['"]openai['"]\s*\)|from\s+['"]openai['"]|require\s*\(\s*['"]openai['"]\s*\)/,
    ),
    productionOpenAiHttpMatches: await collectMatches(
      sourceFiles,
      /api\.openai\.com\/v1\/audio\/transcriptions|OpenAI API key|Whisper API/i,
    ),
    frontendTranscribeRouteMatches: await collectMatches(
      sourceFiles.filter((file) => file.startsWith('frontend/')),
      /\/api\/transcribe-audio|transcribeAudio/i,
    ),
    packageHasOpenAiDependency: Boolean(
      packageJson.dependencies?.openai || packageJson.devDependencies?.openai,
    ),
    activeSpecMentionsOldRuntimeAsRequired: await collectOldRuntimeRequirementMatches(activeSpecFiles),
  };

  await mkdir(path.dirname(SOURCE_AUDIT_PATH), { recursive: true });
  await writeFile(SOURCE_AUDIT_PATH, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  return audit;
}

test('provider runtime boundary keeps only Codex on app-server and external providers on tmux TUI', async () => {
  assert.ok(EVIDENCE_CONTRACTS.some((entry) => entry.includes('provider-runtime-source-audit')));
  const router = await readRepoFile('backend/domains/provider-runtime/runtime-router.ts');
  const events = await readRepoFile('backend/domains/provider-runtime/provider-runtime-events.ts');
  const nativeRuntime = await readRepoFile('backend/native-agent-runtime.ts');
  const packageJson = await readRepoFile('package.json');

  assertExports(router, 'sendProviderRuntimeMessage');
  assert.match(router, /sendCodexAppServerMessage/, 'Codex branch must call app-server facade');
  assert.match(router, /provider !== ['"]codex['"][\s\S]*accepted: false/, 'runtime facade must reject Pi/Claude SDK or RPC execution');
  const composer = await readRepoFile('frontend/components/chat/composer/useChatComposerStateRuntime.impl.ts');
  assert.doesNotMatch(composer, /type:\s*['"]pi-command['"]/, 'browser composer must not send Pi runtime commands');
  assert.doesNotMatch(composer, /type:\s*['"]claude-command['"]/, 'browser composer must not send Claude runtime commands');
  assertExports(events, 'toProviderSessionStatusEvent');
  assertExports(events, 'toProviderRuntimeErrorEvent');
  assert.doesNotMatch(nativeRuntime, /@openai\/codex-sdk/);
  assert.doesNotMatch(packageJson, /"@openai\/codex-sdk"/);
});

test('cN route/provider session binding is centralized', async () => {
  assert.ok(EVIDENCE_CONTRACTS.some((entry) => entry.includes('provider-binding-state')));
  const binding = await readRepoFile('backend/domains/provider-runtime/provider-session-binding.ts');
  const chatWebsocket = await readRepoFile('backend/server/chat-websocket.ts');
  const chatCommandDispatcher = await readRepoFile('backend/server/realtime/chat-command-runtime.ts');
  const messagesHandler = await readRepoFile('backend/session-messages-handler.ts');

  for (const symbol of [
    'readProviderSessionBinding',
    'writeProviderSessionBinding',
    'resolveProviderSessionBinding',
    'assertProviderSessionProject',
  ]) {
    assertExports(binding, symbol);
  }

  assert.match(chatWebsocket, /createChatCommandDispatcher/);
  assert.match(chatCommandDispatcher, /provider-session-binding/);
  assert.match(messagesHandler, /provider-session-binding/);
  assert.doesNotMatch(chatWebsocket, /providerSessionIdForMerge\s*=/, 'chat websocket should not recreate message handler binding logic');
  assert.doesNotMatch(chatCommandDispatcher, /providerSessionIdForMerge\s*=/, 'chat command dispatcher should not recreate message handler binding logic');
});

test('active-turn overlay and live transcript stores have separate lifecycles', async () => {
  assert.ok(EVIDENCE_CONTRACTS.some((entry) => entry.includes('active-turn-runtime-log')));
  const activeTurn = await readRepoFile('backend/domains/provider-runtime/active-turn-store.ts');
  const liveTranscript = await readRepoFile('backend/domains/provider-runtime/live-transcript-store.ts');
  const messagesHandler = await readRepoFile('backend/session-messages-handler.ts');

  assertExports(activeTurn, 'getProviderActiveTurnOverlay');
  assertExports(activeTurn, 'clearProviderActiveTurnOverlay');
  assertExports(liveTranscript, 'getProviderLiveTranscriptSnapshot');
  assertExports(liveTranscript, 'clearProviderLiveTranscriptSnapshot');
  assert.match(messagesHandler, /getProviderActiveTurnOverlay/);
  assert.match(messagesHandler, /getProviderLiveTranscriptSnapshot/);
  assert.doesNotMatch(activeTurn, /liveMessages/);
  assert.doesNotMatch(liveTranscript, /activeTurn/);
});

test('native-agent-runtime is reduced to coordination instead of owning every rule', async () => {
  const nativeRuntime = await readRepoFile('backend/native-agent-runtime.ts');
  const lineCount = nativeRuntime.split(/\r?\n/).length;

  assert.ok(lineCount < 700, `native-agent-runtime.ts should be under 700 lines after boundary extraction, got ${lineCount}`);
  assert.match(nativeRuntime, /sendProviderRuntimeMessage|runtime-router/);
  assert.doesNotMatch(nativeRuntime, /function\s+mapCodexNativeToolItem/);
  assert.doesNotMatch(nativeRuntime, /function\s+mergeHistoryWithActiveTurnOverlay/);
});

test('Codex production execution only enters app-server runtime', async () => {
  const audit = await buildRuntimeSourceAudit();

  assert.equal(audit.oldCodexRuntimeExists, false);
  assert.equal(audit.agentRouteImportsOldCodexRuntime, false);
  assert.equal(audit.agentRouteCallsQueryCodex, false);
  assert.equal(audit.agentRouteUsesAppServerRuntime, true);
  assert.deepEqual(audit.productionCodexExecJsonMatches, []);
});

test('OpenAI audio transcription and GPT enhancement direct calls are removed', async () => {
  const audit = await buildRuntimeSourceAudit();

  assert.deepEqual(audit.productionOpenAiSdkImportMatches, []);
  assert.deepEqual(audit.productionOpenAiHttpMatches, []);
  assert.deepEqual(audit.frontendTranscribeRouteMatches, []);
  assert.equal(audit.packageHasOpenAiDependency, false);
});

test('active specs do not require the old Codex single-run path', async () => {
  const audit = await buildRuntimeSourceAudit();

  assert.deepEqual(audit.activeSpecMentionsOldRuntimeAsRequired, []);
});
