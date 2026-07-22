// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Guard against reactivating retired Claude SDK and MCP UI surfaces.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const readSource = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const cliSourcePath = fileURLToPath(new URL('../../backend/cli.ts', import.meta.url));
const tsxCliPath = fileURLToPath(new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url));

const readOptionalSource = async (path) => {
  try {
    return await readSource(path);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
};

async function collectFiles(rootDir) {
  /** Recursively list source files without depending on host search binaries. */
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

test('settings controller no longer calls legacy Claude MCP endpoints', async () => {
  const settingsController = await readSource('frontend/components/settings/hooks/useSettingsController.ts');
  const settingsView = await readSource('frontend/components/settings/view/Settings.tsx');

  assert.doesNotMatch(settingsController, /\/api\/mcp/);
  assert.doesNotMatch(settingsView, /ClaudeMcpFormModal|openMcpForm|submitMcpForm/);
});

test('active session helpers do not fall back to Claude provider', async () => {
  const helperSources = await Promise.all([
    readSource('frontend/components/main-content/view/subcomponents/ProjectOverviewPanel.tsx'),
    readSource('frontend/components/main-content/view/subcomponents/MainContentTitle.tsx'),
    readSource('frontend/components/shell/hooks/useShellConnection.ts'),
    readSource('frontend/utils/workflowSessions.ts'),
    readSource('frontend/components/main-content/view/subcomponents/sessionActivityState.ts'),
  ]);

  for (const source of helperSources) {
    assert.doesNotMatch(source, /\|\|\s*['"]claude['"]/);
    assert.doesNotMatch(source, /\?\?\s*['"]claude['"]/);
  }
});

test('Claude SDK compatibility module file does not exist and no production imports', async () => {
  const source = await readOptionalSource('backend/claude-sdk.ts');
  assert.equal(source, '', 'backend/claude-sdk.js must not exist');

  const backendFiles = await collectFiles(path.join(repoRoot, 'backend'));
  const matchingFiles = [];
  for (const file of backendFiles) {
    const sourceText = await readFile(file, 'utf8');
    if (sourceText.includes('claude-sdk')) {
      matchingFiles.push(path.relative(repoRoot, file));
    }
  }
  assert.deepEqual(matchingFiles, [], 'no production code in backend/ should reference claude-sdk');
});

test('chat state no longer keeps Claude model or thinking-mode persistence', async () => {
  const providerState = await readSource('frontend/components/chat/hooks/useChatProviderState.ts');
  const chatInterface = await readSource('frontend/components/chat/view/ChatInterface.tsx');
  const composerState = await readSource('frontend/components/chat/hooks/useChatComposerState.ts');
  const chatLocale = await readSource('frontend/i18n/locales/en/chat.json');
  const settingsLocale = await readSource('frontend/i18n/locales/en/settings.json');

  assert.doesNotMatch(providerState, /claudeModel|claude-model|getDefaultClaudeModel|FALLBACK_CLAUDE/);
  assert.doesNotMatch(chatInterface, /claudeModel|handleSetThinkingMode|thinkingMode/);
  assert.doesNotMatch(composerState, /ozw-thinking-mode|thinkingMode|setThinkingMode/);
  assert.doesNotMatch(chatLocale, /"thinkingMode"|claudeDescription/);
  assert.doesNotMatch(settingsLocale, /claudeDescription/);
});

test('ozw CLI status and help do not advertise Claude runtime configuration', async () => {
  const cliSource = await readSource('backend/cli.ts');
  const statusOutput = execFileSync(process.execPath, [tsxCliPath, cliSourcePath, 'status'], { encoding: 'utf8' });
  const helpOutput = execFileSync(process.execPath, [tsxCliPath, cliSourcePath, 'help'], { encoding: 'utf8' });

  for (const output of [cliSource, statusOutput, helpOutput]) {
    assert.doesNotMatch(output, /CLAUDE_CLI_PATH/);
    assert.doesNotMatch(output, /Claude Projects Folder/);
    assert.doesNotMatch(output, /\.claude\/projects/);
    assert.doesNotMatch(output, /custom Claude CLI path/);
  }
});

test('global chat search no longer scans or returns Claude sessions', async () => {
  const projectsSource = await readSource('backend/projects.ts');

  assert.doesNotMatch(projectsSource, /extractClaudeSearchableMessages/);
  assert.doesNotMatch(projectsSource, /provider:\s*['"]claude['"]/);
  assert.doesNotMatch(projectsSource, /Claude Session/);
  assert.doesNotMatch(projectsSource, /getSessions\(project\.name,\s*Number\.MAX_SAFE_INTEGER/);
});

test('active frontend empty and tool states do not show Claude copy', async () => {
  /** Claude tmux TUI is supported; this contract only guards generic empty/tool states and retired SDK actions. */
  const shellSource = await readSource('frontend/components/shell/view/Shell.tsx');
  const activeSources = await Promise.all([
    readSource('frontend/components/sidebar/view/subcomponents/SidebarProjectsState.tsx'),
    readSource('frontend/components/main-content/view/subcomponents/MainContentStateView.tsx'),
    readSource('frontend/components/chat/tools/components/InteractiveRenderers/AskUserQuestionPanel.tsx'),
    readSource('frontend/i18n/locales/en/sidebar.json'),
    readSource('frontend/i18n/locales/en/common.json'),
    readSource('frontend/i18n/locales/en/chat.json'),
    readSource('frontend/i18n/locales/zh-CN/sidebar.json'),
    readSource('frontend/i18n/locales/zh-CN/common.json'),
    readSource('frontend/i18n/locales/zh-CN/chat.json'),
  ]);

  for (const source of activeSources) {
    assert.doesNotMatch(source, /Claude/);
    assert.doesNotMatch(source, /runClaudeCli/);
  }
  assert.doesNotMatch(shellSource, /runClaudeCli/);
  assert.match(shellSource, /providerRisk\.provider === ['"]claude['"]/, 'Shell must keep the explicit Claude TUI risk gate');
});

test('settings locale copy does not expose legacy Claude provider entries', async () => {
  const settingsLocales = await Promise.all([
    readSource('frontend/i18n/locales/en/settings.json'),
    readSource('frontend/i18n/locales/zh-CN/settings.json'),
  ]);

  for (const source of settingsLocales) {
    assert.doesNotMatch(source, /Claude/);
    assert.doesNotMatch(source, /Claude\/Codex/);
    assert.doesNotMatch(source, /"claude"\s*:/);
  }
});

test('session token usage no longer exposes Claude parsers', async () => {
  const usageSources = await Promise.all([
    readSource('backend/session-token-usage.ts'),
    readSource('tests/backend/session-token-usage.test.ts'),
  ]);

  for (const source of usageSources) {
    assert.doesNotMatch(source, /getClaudeSessionTokenUsage/);
    assert.doesNotMatch(source, /claude-session-jsonl|claude-sdk-model-usage/);
  }
});

test('frontend permission settings no longer expose retired Claude settings APIs', async () => {
  const permissionSources = await Promise.all([
    readOptionalSource('frontend/components/chat/utils/chatPermissions.ts'),
    readSource('frontend/components/chat/utils/chatStorage.ts'),
    readSource('frontend/components/chat/types/types.ts'),
    readSource('frontend/components/settings/hooks/useSettingsController.ts'),
    readSource('frontend/components/sidebar/hooks/useSidebarController.ts'),
    readSource('frontend/components/sidebar/utils/utils.ts'),
    readSource('frontend/utils/settingsStorage.ts'),
  ]);

  for (const source of permissionSources) {
    assert.doesNotMatch(source, /buildClaudeToolPermissionEntry/);
    assert.doesNotMatch(source, /getClaudePermissionSuggestion/);
    assert.doesNotMatch(source, /grantClaudeToolPermission/);
    assert.doesNotMatch(source, /CLAUDE_SETTINGS_KEY|getClaudeSettings/);
    assert.doesNotMatch(source, /ClaudeSettings|ClaudePermissionSuggestion|PermissionGrantResult/);
    assert.doesNotMatch(source, /claude-settings/);
  }
});

test('browser acceptance specs no longer create positive Claude history fixtures', async () => {
  const browserSpecSources = await Promise.all([
    readSource('tests/e2e/helpers/playwright-fixture.ts'),
    readSource('tests/e2e/project-visibility.spec.ts'),
    readSource('tests/e2e/history-scroll-preservation.spec.ts'),
    readSource('tests/spec/chat-history-full-text-search.spec.ts'),
    readSource('tests/spec/chat-history-search-regressions.spec.ts'),
    readSource('tests/spec/chat-tool-structured-rendering.spec.ts'),
    readSource('tests/spec/chat-file-links-open-in-editor.spec.ts'),
    readSource('tests/spec/chat-update-plan-empty-result.spec.ts'),
    readSource('tests/spec/chat-history-search-production-routing.spec.ts'),
    readSource('tests/spec/project-workflow-control-plane.spec.ts'),
    readSource('tests/spec/codex-jsonl-message-rendering.spec.ts'),
    readSource('tests/spec/codex-jsonl-single-source-rendering.spec.ts'),
  ]);

  for (const source of browserSpecSources) {
    assert.doesNotMatch(source, /writeClaudeSession|buildClaudeTranscript|openFixtureClaudeSession/);
    assert.doesNotMatch(source, /provider:\s*['"]claude['"]/);
    assert.doesNotMatch(source, /\.claude/);
    assert.doesNotMatch(source, /Claude history|Claude session|Claude assistant/);
  }
});
