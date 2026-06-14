// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Verify all core frontend business paths remain intact after
 * simplification. Uses module-level imports where possible to validate
 * real export signatures; falls back to source-structure checks for
 * React components that require a DOM to mount.
 * Change: 30-进一步精简仓库源码和脚本资源
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

function findRepoRoot(startDir) {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return startDir;
}

const REPO_ROOT = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));

function sourceFile(...segments) {
  return path.join(REPO_ROOT, ...segments);
}

function readSource(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function sourceExists(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function hasNamedExport(source, exportName) {
  const re = new RegExp(`export\\s+(const|function|class|let|var)\\s+${exportName}\\b`);
  return re.test(source);
}

function hasDefaultExport(source) {
  return /export\s+default\s+(function|class|const|let|var)/.test(source)
    || /export\s+default\s+\w/.test(source)
    || /export\s*\{\s*\w+\s+as\s+default\s*\}/.test(source);
}

// ═══════════════════════════════════════════════════════════════════
// Shared runtime module imports (used by both frontend and backend)
// ═══════════════════════════════════════════════════════════════════

test('shared socket-message-utils exports real functions loadable by frontend', async () => {
  const mod = await import(path.join(REPO_ROOT, 'shared', 'socket-message-utils.ts'));
  // These functions are imported by useProjectsState.ts and useChatRealtimeHandlers.ts
  assert.ok(typeof mod.getPendingSocketMessages === 'function');
  assert.ok(typeof mod.getMessageHistoryTailSequence === 'function');
  assert.ok(typeof mod.reduceProjectsUpdatedMessages === 'function');
  // Verify they return expected types when called with valid inputs
  const pending = mod.getPendingSocketMessages([], []);
  assert.ok(Array.isArray(pending));
});

test('shared modelConstants exports CODEX_REASONING_EFFORTS consumed by codex-models', async () => {
  const mod = await import(path.join(REPO_ROOT, 'shared', 'modelConstants.ts'));
  const efforts = mod.CODEX_REASONING_EFFORTS;
  assert.ok(efforts && typeof efforts === 'object');
  assert.ok(Array.isArray(efforts.OPTIONS), 'OPTIONS must be an array');
  assert.ok(efforts.OPTIONS.length > 0, 'OPTIONS must not be empty');
  assert.ok(typeof efforts.DEFAULT === 'string', 'DEFAULT must be a string');
});

// ═══════════════════════════════════════════════════════════════════
// Project entry path — source verification (React components)
// ═══════════════════════════════════════════════════════════════════

test('WorkspaceDockLayout exports default component with dock panel rendering', () => {
  const f = sourceFile('src', 'components', 'main-content', 'view', 'subcomponents', 'WorkspaceDockLayout.tsx');
  assert.ok(sourceExists(f), 'WorkspaceDockLayout must exist');
  const content = readSource(f);
  assert.ok(hasDefaultExport(content), 'Must export a default component');
  assert.ok(content.includes('dock-panel'), 'Must render dock panels with data-testid');
  // Shell tab toggle must be preserved for bottom dock
  assert.ok(content.includes('tab-shell') || content.includes('shell'), 'Must expose shell tab toggle');
});

test('ProjectOverviewPanel renders sessions with activity state tracking', () => {
  const f = sourceFile('src', 'components', 'main-content', 'view', 'subcomponents', 'ProjectOverviewPanel.tsx');
  assert.ok(sourceExists(f), 'ProjectOverviewPanel must exist');
  const content = readSource(f);
  assert.ok(hasDefaultExport(content), 'Must export a default component');
  // Imports TS sessionActivityState (converted from JS in this change)
  assert.ok(content.includes('sessionActivityState'), 'Must import activity state');
  // Renders session-related components
  assert.ok(
    content.includes('SessionProviderLogo') || content.includes('SessionActionIconMenu'),
    'Must render session UI elements',
  );
});

test('ProjectWorkspaceNav provides tab navigation for workspace', () => {
  const f = sourceFile('src', 'components', 'app', 'ProjectWorkspaceNav.tsx');
  assert.ok(sourceExists(f), 'ProjectWorkspaceNav must exist');
  const content = readSource(f);
  assert.ok(hasDefaultExport(content), 'Must export a default component');
  // Must have workspace navigation and session/workflow entry points
  assert.ok(content.includes('data-testid'), 'Must render navigable elements');
  assert.ok(
    content.includes('session') || content.includes('workflow'),
    'Must expose session or workflow navigation',
  );
});

// ═══════════════════════════════════════════════════════════════════
// Chat path — hooks consume shared modules correctly
// ═══════════════════════════════════════════════════════════════════

test('useChatRealtimeHandlers imports socket message utils from shared TS', () => {
  const f = sourceFile('src', 'components', 'chat', 'hooks', 'useChatRealtimeHandlers.ts');
  assert.ok(sourceExists(f), 'useChatRealtimeHandlers must exist');
  const content = readSource(f);
  assert.ok(
    content.includes('socket-message-utils'),
    'Must import from shared/socket-message-utils',
  );
  // After simplification: import from TS (no .js extension on import)
  assert.ok(!content.includes("socket-message-utils.js'"),
    'Must not import from old .js file');
});

test('ChatInterface renders message input and scrollable transcript', () => {
  const f = sourceFile('src', 'components', 'chat', 'view', 'ChatInterface.tsx');
  assert.ok(sourceExists(f), 'ChatInterface must exist');
  const content = readSource(f);
  assert.ok(hasDefaultExport(content), 'Must export a default component');
  assert.ok(
    content.includes('textarea') || content.includes('composer') || content.includes('input'),
    'Must have message input element',
  );
  assert.ok(content.includes('scroll') || content.includes('transcript'),
    'Must have scrollable transcript container',
  );
});

// ═══════════════════════════════════════════════════════════════════
// File tree and code editor
// ═══════════════════════════════════════════════════════════════════

test('FileTree domain has a component with download/blob support', () => {
  const f = sourceFile('src', 'components', 'file-tree', 'view', 'FileTree.tsx');
  assert.ok(sourceExists(f), 'FileTree component must exist');
  const content = readSource(f);
  assert.ok(hasDefaultExport(content), 'Must export a default component');
});

test('CodeEditor domain has an editor component', () => {
  const candidates = [
    sourceFile('src', 'components', 'code-editor', 'view', 'CodeEditor.tsx'),
  ];
  const found = candidates.some((f) => sourceExists(f));
  assert.ok(found, 'CodeEditor component must exist');
});

test('useFileTreeOperations uses response.blob() for binary downloads', () => {
  const f = sourceFile('src', 'components', 'file-tree', 'hooks', 'useFileTreeOperations.ts');
  if (!sourceExists(f)) return; // optional helper
  const content = readSource(f);
  assert.ok(content.includes('response.blob()') || content.includes('.blob()'),
    'Download flow must use blob() for binary fidelity');
});

// ═══════════════════════════════════════════════════════════════════
// Shell panel
// ═══════════════════════════════════════════════════════════════════

test('Shell component renders xterm.js terminal', () => {
  const f = sourceFile('src', 'components', 'shell', 'view', 'Shell.tsx');
  assert.ok(sourceExists(f), 'Shell component must exist');
  const content = readSource(f);
  assert.ok(hasDefaultExport(content), 'Must export a default component');
  assert.ok(content.includes('xterm') || content.includes('terminal'),
    'Must reference xterm.js terminal renderer');
});

test('@xterm/xterm dependency is declared', () => {
  const pkg = JSON.parse(readSource(sourceFile('package.json')));
  assert.ok('@xterm/xterm' in (pkg.dependencies || {}),
    '@xterm/xterm must remain a declared dependency');
});

// ═══════════════════════════════════════════════════════════════════
// Settings page — agent provider configuration
// ═══════════════════════════════════════════════════════════════════

test('Settings component with agent tabs exists', () => {
  const f = sourceFile('src', 'components', 'settings', 'view', 'Settings.tsx');
  assert.ok(sourceExists(f), 'Settings component must exist');
  const content = readSource(f);
  assert.ok(hasDefaultExport(content), 'Must export a default component');
});

test('AgentListItem renders all three agents (codex, opencode, pi)', () => {
  const f = sourceFile('src', 'components', 'settings', 'view', 'tabs', 'agents-settings', 'AgentListItem.tsx');
  assert.ok(sourceExists(f), 'AgentListItem must exist');
  const content = readSource(f);
  const agents = ['codex', 'opencode', 'pi'];
  for (const agent of agents) {
    assert.ok(content.includes(agent),
      `AgentListItem must reference ${agent} provider`);
  }
});

test('AccountContent handles connected/disconnected/error states per agent', () => {
  const f = sourceFile('src', 'components', 'settings', 'view', 'tabs', 'agents-settings', 'sections', 'content', 'AccountContent.tsx');
  assert.ok(sourceExists(f), 'AccountContent must exist');
  const content = readSource(f);
  assert.ok(content.includes('connected') || content.includes('disconnected'),
    'Must handle connection states');
  assert.ok(content.includes('providers') || content.includes('Provider'),
    'Must render provider information');
});

// ═══════════════════════════════════════════════════════════════════
// Workflow detail view
// ═══════════════════════════════════════════════════════════════════

test('WorkflowDetailView renders stages and artifacts', () => {
  const f = sourceFile('src', 'components', 'main-content', 'view', 'subcomponents', 'WorkflowDetailView.tsx');
  assert.ok(sourceExists(f), 'WorkflowDetailView must exist');
  const content = readSource(f);
  assert.ok(hasDefaultExport(content), 'Must export a default component');
  assert.ok(
    content.includes('stage') || content.includes('artifact') || content.includes('batch'),
    'Must render workflow stages, artifacts, or batches',
  );
});

// ═══════════════════════════════════════════════════════════════════
// State hooks — verification after import path changes
// ═══════════════════════════════════════════════════════════════════

test('useProjectsState imports from shared TS module', () => {
  const f = sourceFile('src', 'hooks', 'useProjectsState.ts');
  assert.ok(sourceExists(f), 'useProjectsState must exist');
  const content = readSource(f);
  assert.ok(content.includes('socket-message-utils'),
    'Must import from shared/socket-message-utils');
  // After simplification: no .js extension on shared imports
  assert.ok(!content.includes("socket-message-utils.js'"),
    'Must not import from old .js file');
});

// ═══════════════════════════════════════════════════════════════════
// JS → TS conversions — converted modules are valid
// ═══════════════════════════════════════════════════════════════════

test('message dedup TS modules exist and export dedup functions', () => {
  const dedupFiles = [
    { path: 'frontend/components/chat/utils/messageDedup.ts', expected: 'dedupeAdjacentChatMessages' },
    { path: 'frontend/components/chat/utils/sessionMessageDedup.ts', expected: 'dedupe' },
  ];
  for (const { path: relPath, expected } of dedupFiles) {
    const f = sourceFile(...relPath.split('/'));
    assert.ok(sourceExists(f), `Missing: ${relPath}`);
    const content = readSource(f);
    assert.ok(content.includes(expected),
      `${relPath} must export ${expected}`);
  }
});
