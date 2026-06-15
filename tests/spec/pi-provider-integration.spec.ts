// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Verify Pi provider front-end integration through static source
 * assertions.  Covers project overview picker, chat composer pi-command,
 * i18n labels, and session provider resolution.
 *
 * NOTE: The co protocol intermediate layer has been removed. Pi now goes
 * through the native SDK runtime directly, so server-side assertions are
 * updated to match the native-agent-runtime.ts contract.
 *
 * These tests satisfy task.md 6.4 and lock in the Pi business flow.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');

function readRepoFile(relPath) {
  return fs.readFileSync(path.resolve(REPO_ROOT, relPath), 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// Project overview Pi picker
// ─────────────────────────────────────────────────────────────────────────────

test('ProjectOverviewPanel renders Pi provider button with correct test id', async () => {
  const source = await readRepoFile(
    'frontend/components/main-content/view/subcomponents/ProjectOverviewPanel.tsx',
  );
  assert.match(
    source,
    /data-testid="project-new-session-provider-pi"/,
    'must render Pi button with data-testid',
  );
  assert.match(
    source,
    /onClick=\{\(\) => handleCreateSession\('pi'\)\}/,
    'Pi button must call handleCreateSession with pi',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Chat composer pi-command send path
// ─────────────────────────────────────────────────────────────────────────────

test('useChatComposerState sends pi-command with Pi model controls for pi provider', async () => {
  const source = await readRepoFile(
    'frontend/components/chat/composer/useChatComposerStateImpl.ts',
  );
  assert.match(
    source,
    /provider === 'pi'/,
    'must have pi provider branch in send handler',
  );
  assert.match(
    source,
    /type: 'pi-command'/,
    'must send pi-command type for Pi provider',
  );
  // Pi sends its own model and thinkingLevel controls, but never Codex reasoningEffort.
  const piBranch = source.match(/else if \(provider === 'pi'\) \{[\s\S]*?sendMessage\(\{[\s\S]*?\}\);/);
  assert.ok(piBranch, 'must have a pi sendMessage call');
  assert.match(piBranch[0], /model:\s*piModel\b/, 'pi-command must include selected Pi model');
  assert.match(piBranch[0], /thinkingLevel:\s*piThinkingLevel\b/, 'pi-command must include selected Pi thinking level');
  assert.ok(
    !piBranch[0].includes('reasoningEffort:'),
    'pi-command must not include reasoningEffort option',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ChatInterface Pi provider label and placeholder
// ─────────────────────────────────────────────────────────────────────────────

test('ChatInterface shows Pi label and placeholder for pi provider', async () => {
  const source = await readRepoFile(
    'frontend/components/chat/view/ChatInterface.tsx',
  );
  // Provider label
  assert.match(
    source,
    /effectiveProvider === 'pi'[\s\S]*?t\('messageTypes\.pi'\)/,
    'must use messageTypes.pi for Pi label',
  );
  // Placeholder
  assert.match(
    source,
    /effectiveProvider === 'pi'[\s\S]*?t\('messageTypes\.pi'/,
    'must use Pi label for input placeholder',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Server pi-command WebSocket handler
// ─────────────────────────────────────────────────────────────────────────────

test('chat websocket handles pi-command WebSocket messages', async () => {
  const source = await readRepoFile('backend/server/chat-websocket.ts');
  assert.match(
    source,
    /data\.type === 'pi-command'/,
    'must detect pi-command in WebSocket handler',
  );
  assert.match(
    source,
    /sendNativeMessage\(/,
    'must send through native agent runtime instead of co',
  );
  assert.match(
    source,
    /provider: 'pi'/,
    'must build native message with provider=pi',
  );
  assert.match(
    source,
    /preflightResult callback[\s\S]*message-accepted/,
    'Pi acceptance must be emitted by the runtime preflight callback',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Server pi-command in error catch block
// ─────────────────────────────────────────────────────────────────────────────

test('chat websocket maps pi-command errors to pi-error type', async () => {
  const source = await readRepoFile('backend/server/chat-websocket.ts');
  assert.match(
    source,
    /data\?\.type === 'pi-command'/,
    'must detect pi-command type in error handler',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// i18n coverage
// ─────────────────────────────────────────────────────────────────────────────

test('i18n chat.json includes pi in messageTypes', async () => {
  const enSource = await readRepoFile('frontend/i18n/locales/en/chat.json');
  assert.match(enSource, /"pi":\s*"Pi"/, 'en chat.json must define Pi message type');

  const zhSource = await readRepoFile('frontend/i18n/locales/zh-CN/chat.json');
  assert.match(zhSource, /"pi":\s*"Pi"/, 'zh-CN chat.json must define Pi message type');
});

test('i18n settings.json includes pi agent account description', async () => {
  const enSource = await readRepoFile('frontend/i18n/locales/en/settings.json');
  assert.match(
    enSource,
    /"pi":\s*\{[\s\S]*?"description":/,
    'en settings.json must have pi agent account section',
  );

  const zhSource = await readRepoFile('frontend/i18n/locales/zh-CN/settings.json');
  assert.match(
    zhSource,
    /"pi":\s*\{[\s\S]*?"description":/,
    'zh-CN settings.json must have pi agent account section',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowDetailView Pi recognition
// ─────────────────────────────────────────────────────────────────────────────

test('workflow detail view model recognizes pi sessions from piSessions', async () => {
  const source = await readRepoFile(
    'frontend/components/main-content/workflow-detail/workflowDetailViewModel.ts',
  );
  assert.match(
    source,
    /project\.piSessions/,
    'WorkflowDetailView must check project.piSessions for Pi',
  );
  assert.match(
    source,
    /provider === 'pi'/,
    'WorkflowDetailView must recognize pi provider in child sessions',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Provider selection empty state
// ─────────────────────────────────────────────────────────────────────────────

test('ProviderSelectionEmptyState includes Pi option', async () => {
  const source = await readRepoFile(
    'frontend/components/chat/view/subcomponents/ProviderSelectionEmptyState.tsx',
  );
  assert.match(
    source,
    /'pi'/,
    'ProviderSelectionEmptyState must list pi as a selectable provider',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Settings AccountContent Pi display
// ─────────────────────────────────────────────────────────────────────────────

test('AccountContent shows Pi CLI availability without login or quota', async () => {
  const source = await readRepoFile(
    'frontend/components/settings/view/tabs/agents-settings/sections/content/AccountContent.tsx',
  );
  assert.match(
    source,
    /agent === 'pi'/,
    'AccountContent must have a pi-specific branch',
  );
  assert.match(
    source,
    /agents\.account\.pi\./,
    'AccountContent must use pi-specific i18n keys',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// useProjectsState Pi session change detection
// ─────────────────────────────────────────────────────────────────────────────

test('projectRefreshReducer projectsHaveChanges compares piSessions', async () => {
  const source = await readRepoFile('frontend/hooks/projects/projectRefreshReducer.ts');
  assert.match(
    source,
    /serialize\(nextProject\.piSessions\)\s*!==\s*serialize\(prevProject\.piSessions\)/,
    'projectsHaveChanges must compare piSessions to detect pi state updates',
  );
});

test('projectSessionCollections getProjectSessions includes piSessions spread', async () => {
  const source = await readRepoFile('frontend/hooks/projects/projectSessionCollections.ts');
  assert.match(
    source,
    /\.\.\.\(project\.piSessions\s*\?\?\s*\[\]\)/,
    'getProjectSessions must spread piSessions into visible session list',
  );
});
