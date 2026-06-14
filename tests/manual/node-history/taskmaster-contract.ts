// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Contract test verifying TaskMaster has been fully removed.
 * Change: 2026-05-16-29-移除TaskMaster和lucide图标依赖
 *
 * Verifies:
 * - No /api/taskmaster route registration in server
 * - No TaskMaster providers, components, or context in frontend
 * - No .taskmaster detection in project read model
 * - No TaskMaster WebSocket events
 * - VALID_TABS no longer includes 'tasks'
 * - i18n settings no longer have TaskMaster keys
 * - main-content types no longer define TaskMaster types
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const REPO_ROOT = resolve('.');

const readRepoFile = (path) => readFile(resolve(REPO_ROOT, path), 'utf8');

const exists = async (path) => {
  try {
    await stat(resolve(REPO_ROOT, path));
    return true;
  } catch {
    return false;
  }
};

// --- Server-side contract checks ---

test('server entry does not register /api/taskmaster route', async () => {
  const content = await readRepoFile('backend/index.ts');
  assert.doesNotMatch(content, /\/api\/taskmaster/);
  assert.doesNotMatch(content, /\.\/routes\/taskmaster/);
});

test('TaskMaster route file does not exist', async () => {
  assert.equal(await exists('backend/routes/taskmaster.js'), false);
});

test('TaskMaster domain directory does not exist', async () => {
  assert.equal(await exists('backend/domains/taskmaster'), false);
});

test('TaskMaster WebSocket utility does not exist', async () => {
  assert.equal(await exists('backend/utils/taskmaster-websocket.js'), false);
});

test('project read model does not detect .taskmaster folder', async () => {
  const content = await readRepoFile('backend/projects.ts');
  assert.doesNotMatch(content, /\.taskmaster/);
  assert.doesNotMatch(content, /detectTaskMasterFolder/);
  assert.doesNotMatch(content, /detectTaskMasterMCPServer/);
});

test('MCP detector no longer exposes taskmaster-specific detection', async () => {
  const content = await readRepoFile('backend/utils/mcp-detector.ts');
  assert.doesNotMatch(content, /detectTaskMasterMCPServer/);
  assert.doesNotMatch(content, /task-master-ai/);
});

test('MCP utils route does not have taskmaster-server endpoint', async () => {
  const content = await readRepoFile('backend/routes/mcp-utils.ts');
  assert.doesNotMatch(content, /taskmaster-backend/);
  assert.doesNotMatch(content, /detectTaskMasterMCPServer/);
});

// --- Frontend contract checks ---

test('TaskMaster context files do not exist', async () => {
  assert.equal(await exists('frontend/contexts/TaskMasterContext.jsx'), false);
  assert.equal(await exists('frontend/contexts/TasksSettingsContext.jsx'), false);
});

test('TaskMaster components directory does not exist', async () => {
  assert.equal(await exists('frontend/components/taskmaster'), false);
});

test('TaskMasterPanel component does not exist', async () => {
  assert.equal(
    await exists('frontend/components/main-content/view/subcomponents/TaskMasterPanel.tsx'),
    false,
  );
});

test('App.tsx does not import TaskMaster or TasksSettings providers', async () => {
  const content = await readRepoFile('frontend/App.tsx');
  assert.doesNotMatch(content, /TaskMasterProvider/);
  assert.doesNotMatch(content, /TasksSettingsProvider/);
  assert.doesNotMatch(content, /TaskMasterContext/);
  assert.doesNotMatch(content, /TasksSettingsContext/);
});

test('MainContent does not reference tasks tab or TaskMaster panel', async () => {
  const content = await readRepoFile('frontend/components/main-content/view/MainContent.tsx');
  assert.doesNotMatch(content, /TaskMasterPanel/);
  assert.doesNotMatch(content, /shouldShowTasksTab/);
  assert.doesNotMatch(content, /onShowAllTasks/);
  assert.doesNotMatch(content, /tasksEnabled/);
  assert.doesNotMatch(content, /isTaskMasterInstalled/);
});

test('tasks tab is not in the tab switcher', async () => {
  const content = await readRepoFile(
    'frontend/components/main-content/view/subcomponents/MainContentTabSwitcher.tsx',
  );
  assert.doesNotMatch(content, /TASKS_TAB/);
  assert.doesNotMatch(content, /'tasks'/);
  assert.doesNotMatch(content, /shouldShowTasksTab/);
});

test('AppTab type does not include tasks', async () => {
  const content = await readRepoFile('frontend/types/app.ts');
  assert.doesNotMatch(content, /'tasks'/);
});

test('Project type does not include taskmaster field', async () => {
  const content = await readRepoFile('frontend/types/app.ts');
  assert.doesNotMatch(content, /ProjectTaskmasterInfo/);
  assert.doesNotMatch(content, /taskmaster\?:/);
});

test('ChatInterface does not reference taskmaster events or tasks settings', async () => {
  const content = await readRepoFile('frontend/components/chat/view/ChatInterface.tsx');
  assert.doesNotMatch(content, /useTasksSettings/);
  assert.doesNotMatch(content, /TasksSettingsContext/);
  assert.doesNotMatch(content, /taskmaster-/);
});

test('Sidebar does not import TaskMaster context', async () => {
  const content = await readRepoFile('frontend/components/sidebar/view/Sidebar.tsx');
  assert.doesNotMatch(content, /useTaskMaster/);
  assert.doesNotMatch(content, /TaskMasterContext/);
  assert.doesNotMatch(content, /TasksSettingsContext/);
});

test('Sidebar project item does not render TaskIndicator', async () => {
  const content = await readRepoFile(
    'frontend/components/sidebar/view/subcomponents/SidebarProjectItem.tsx',
  );
  assert.doesNotMatch(content, /TaskIndicator/);
  assert.doesNotMatch(content, /getTaskIndicatorStatus/);
  assert.doesNotMatch(content, /tasksEnabled/);
  assert.doesNotMatch(content, /mcpServerStatus/);
});

test('ProviderSelectionEmptyState does not have task banners', async () => {
  const content = await readRepoFile(
    'frontend/components/chat/view/subcomponents/ProviderSelectionEmptyState.tsx',
  );
  assert.doesNotMatch(content, /NextTaskBanner/);
  assert.doesNotMatch(content, /tasksEnabled/);
  assert.doesNotMatch(content, /isTaskMasterInstalled/);
});

test('API utility does not have TaskMaster endpoints', async () => {
  const content = await readRepoFile('frontend/utils/api.ts');
  assert.doesNotMatch(content, /taskmaster:/);
  assert.doesNotMatch(content, /\/api\/taskmaster/);
});

test('Realtime handlers do not listen for taskmaster events', async () => {
  const content = await readRepoFile(
    'frontend/components/chat/hooks/useChatRealtimeHandlers.ts',
  );
  assert.doesNotMatch(content, /taskmaster-project-updated/);
});

test('VALID_TABS no longer includes tasks', async () => {
  const content = await readRepoFile('frontend/hooks/useProjectsState.ts');
  // After fix: VALID_TABS must not contain 'tasks'
  assert.match(content, /VALID_TABS.*\=.*new Set\(\[/);
  assert.doesNotMatch(content, /VALID_TABS.*'tasks'/);
});

test('Settings controller normalizes retired tasks tab to agents', async () => {
  const content = await readRepoFile(
    'frontend/components/settings/hooks/useSettingsController.ts',
  );
  assert.match(content, /tab === 'tasks'/);
  assert.match(content, /return 'agents'/);
});

test('i18n en settings does not contain TaskMaster mainTabs.tasks', async () => {
  const content = await readRepoFile('frontend/i18n/locales/en/settings.json');
  const parsed = JSON.parse(content);
  assert.equal('tasks' in (parsed.mainTabs || {}), false);
  assert.equal('tasks' in parsed, false);
});

test('i18n zh-CN settings does not contain TaskMaster mainTabs.tasks', async () => {
  const content = await readRepoFile('frontend/i18n/locales/zh-CN/settings.json');
  const parsed = JSON.parse(content);
  assert.equal('tasks' in (parsed.mainTabs || {}), false);
  assert.equal('tasks' in parsed, false);
});

test('main-content types do not define TaskMaster type aliases', async () => {
  const content = await readRepoFile('frontend/components/main-content/types/types.ts');
  assert.doesNotMatch(content, /TaskMasterTask/);
  assert.doesNotMatch(content, /TaskSelection/);
  assert.doesNotMatch(content, /TaskReference/);
  assert.doesNotMatch(content, /PrdFile/);
});
