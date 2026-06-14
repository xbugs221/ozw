// Sources: 2026-06-13-107-清理左侧导航栏会话工作流残留逻辑
/**
 * PURPOSE: Keep the left project sidebar scoped to project navigation so old
 * session/workflow child-list behavior is not reintroduced.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const EVIDENCE_DIR = path.join(REPO_ROOT, 'test-results', 'project-sidebar-navigation-boundary');

/**
 * Resolve a repository-relative source path for structural assertions.
 */
function sourcePath(relativePath: string): string {
  return path.join(REPO_ROOT, relativePath);
}

/**
 * Read one source file as UTF-8 text for stable boundary checks.
 */
async function readSource(relativePath: string): Promise<string> {
  return fs.readFile(sourcePath(relativePath), 'utf8');
}

/**
 * Check whether a repository-relative file currently exists.
 */
async function fileExists(relativePath: string): Promise<boolean> {
  try {
    await fs.access(sourcePath(relativePath));
    return true;
  } catch {
    return false;
  }
}

/**
 * Persist the source audit so review can inspect exact matched tokens.
 */
async function writeAuditReport(report: Record<string, unknown>, fileName = 'source-audit.json'): Promise<void> {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await fs.writeFile(
    path.join(EVIDENCE_DIR, fileName),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
}

test('left sidebar does not own session or workflow child-list behavior', async () => {
  const controller = await readSource('frontend/components/sidebar/hooks/useSidebarController.ts');
  const sidebar = await readSource('frontend/components/sidebar/view/Sidebar.tsx');
  const sidebarModals = await readSource('frontend/components/sidebar/view/subcomponents/SidebarModals.tsx');
  const projectList = await readSource('frontend/components/sidebar/view/subcomponents/SidebarProjectList.tsx');
  const projectItem = await readSource('frontend/components/sidebar/view/subcomponents/SidebarProjectItem.tsx');
  const sidebarTypes = await readSource('frontend/components/sidebar/types/types.ts');

  const forbiddenControllerTokens = [
    'expandedProjects',
    'toggleProject',
    'loadingSessions',
    'additionalSessions',
    'initialSessionsLoaded',
    'projectHasMoreOverrides',
    'editingSession',
    'editingSessionName',
    'sessionDeleteConfirmation',
    'handleSessionClick',
    'toggleStarSession',
    'togglePendingSession',
    'toggleHiddenSession',
    'isSessionStarred',
    'isSessionPending',
    'showDeleteSessionConfirmation',
    'confirmDeleteSession',
    'loadMoreSessions',
    'updateSessionSummary',
    'api.updateSessionUiState',
    'api.sessions',
    'api.deleteSession',
    'api.deleteCodexSession',
    'isSidebarAttentionWorkflow',
    'isSidebarAttentionSession',
    'attention child rows',
  ];
  const forbiddenProjectListTokens = ['getProjectSessions', 'sessions={', 'currentTime'];
  const forbiddenProjectItemTokens = ['sessions:', 'SessionWithProvider', 'isSessionActive', 'project.workflows', 'currentTime'];
  const forbiddenSidebarTokens = ['sessionDeleteConfirmation', 'confirmDeleteSession', 'onSessionSelect', 'onSessionDelete'];
  const forbiddenTypeTokens = ['onSessionSelect', 'onSessionDelete', 'selectedSession', 'selectedWorkflow'];

  const audit = {
    controllerForbiddenMatches: forbiddenControllerTokens.filter((token) => controller.includes(token)),
    projectListForbiddenMatches: forbiddenProjectListTokens.filter((token) => projectList.includes(token)),
    projectItemForbiddenMatches: forbiddenProjectItemTokens.filter((token) => projectItem.includes(token)),
    sidebarForbiddenMatches: forbiddenSidebarTokens.filter((token) => sidebar.includes(token)),
    sidebarModalStillOwnsSessionDelete: sidebarModals.includes('sessionDeleteConfirmation'),
    typeForbiddenMatches: forbiddenTypeTokens.filter((token) => sidebarTypes.includes(token)),
    sidebarSessionItemExists: await fileExists('frontend/components/sidebar/view/subcomponents/SidebarSessionItem.tsx'),
  };

  await writeAuditReport(audit);

  assert.equal(audit.sidebarSessionItemExists, false, 'left sidebar must not render session rows');
  assert.deepEqual(audit.controllerForbiddenMatches, [], 'controller must not keep child-list state or session action APIs');
  assert.deepEqual(audit.projectListForbiddenMatches, [], 'project list must not receive project sessions');
  assert.deepEqual(audit.projectItemForbiddenMatches, [], 'project item must not depend on session or workflow child-list data');
  assert.deepEqual(audit.sidebarForbiddenMatches, [], 'sidebar must not pass session selection or deletion concerns');
  assert.equal(audit.sidebarModalStillOwnsSessionDelete, false, 'sidebar modals must not own session delete confirmation');
  assert.deepEqual(audit.typeForbiddenMatches, [], 'sidebar public types must not expose child-list props');
});

test('desktop sidebar collapse follows shared visibility preference', async () => {
  /**
   * Business rule: the desktop header collapse button must hide the left
   * navigation and persist that state for the same menu button that restores it.
   */
  const appContent = await readSource('frontend/components/app/AppContent.tsx');

  const audit = {
    desktopVisibilityReadsPreference:
      /const\s+isSidebarOpen\s*=\s*isMobile\s*\?\s*isMobileSidebarOpen\s*:\s*sidebarVisible/.test(appContent),
    desktopRenderReadsPreference:
      /!\s*isMobile\s*&&\s*sidebarVisible\s*\?/.test(appContent),
    desktopCollapsePersistsPreference:
      /handleDesktopSidebarCollapse[\s\S]*setPreference\(['"]sidebarVisible['"],\s*false\)/.test(appContent),
    desktopMenuPersistsPreference:
      /handleMenuClick[\s\S]*setPreference\(['"]sidebarVisible['"],\s*true\)/.test(appContent),
    noDetachedDesktopMirrorState:
      !/desktopSidebarVisible|setDesktopSidebarVisible/.test(appContent),
  };

  await writeAuditReport({ desktopSidebarCollapse: audit }, 'desktop-collapse-audit.json');

  for (const [name, passed] of Object.entries(audit)) {
    assert.equal(passed, true, `桌面侧栏折叠合同缺失: ${name}`);
  }
});
