/**
 * PURPOSE: Define the acceptance contract for removing high-frequency frontend
 * business polling while preserving connection heartbeat behavior.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const chatInterfaceSource = readFileSync('frontend/components/chat/view/ChatInterface.tsx', 'utf8');
const projectsStateSource = readFileSync('frontend/hooks/useProjectsState.ts', 'utf8');
const workflowDetailSource = readFileSync(
  'frontend/components/main-content/view/subcomponents/WorkflowDetailView.tsx',
  'utf8',
);
const websocketContextSource = readFileSync('frontend/contexts/WebSocketContext.tsx', 'utf8');

function compactSource(source: string): string {
  /**
   * Collapse whitespace so the contract can match behavior across formatting
   * changes without depending on exact line breaks.
   */
  return source.replace(/\s+/g, ' ');
}

test('chat session status reconciliation is event-driven, not a 4 second interval', () => {
  /**
   * A stable chat page must not keep asking the backend whether the session is
   * done; completion and transcript changes should arrive through scoped events.
   */
  const compactChat = compactSource(chatInterfaceSource);

  assert.doesNotMatch(
    chatInterfaceSource,
    /SESSION_STATUS_RECONCILE_INTERVAL_MS\s*=\s*4_?000/,
    'ChatInterface must not define a fixed 4s session-status polling cadence',
  );
  assert.doesNotMatch(
    compactChat,
    /setInterval\s*\([^)]*reconcileSessionStatus[^)]*\)/,
    'ChatInterface must not schedule reconcileSessionStatus with setInterval',
  );
  assert.doesNotMatch(
    compactChat,
    /setInterval\s*\([^)]*check-session-status[^)]*\)/,
    'ChatInterface must not send check-session-status from a fixed interval',
  );
});

test('workflow planning detail does not poll the full projects endpoint every second', () => {
  /**
   * A workflow waiting for its planning child session should refresh from
   * workflow/session events or a finite retry, not by polling /api/projects.
   */
  const compactProjects = compactSource(projectsStateSource);

  assert.doesNotMatch(
    compactProjects,
    /setInterval\s*\([^)]*handleSidebarRefresh[^)]*,\s*1000\s*\)/,
    'useProjectsState must not poll handleSidebarRefresh every second',
  );
  assert.doesNotMatch(
    compactProjects,
    /shouldPollWorkflowPlanningSession[\s\S]{0,1200}setInterval/,
    'workflow planning child-session recovery must not use an infinite interval',
  );
});

test('background project refresh does not remount workflow detail through full-page loading', () => {
  /**
   * Watcher-driven workflow refreshes still call the project list endpoint.
   * They must not flip the global project loading flag after the initial load,
   * otherwise the current workflow detail visibly flashes to "Loading ozw".
   */
  assert.match(
    projectsStateSource,
    /const hasLoadedProjectsRef = useRef\(false\);/,
    'useProjectsState must track whether the first project list load finished',
  );
  assert.match(
    projectsStateSource,
    /const shouldShowInitialLoading = !hasLoadedProjectsRef\.current;[\s\S]{0,220}if \(shouldShowInitialLoading\) \{[\s\S]{0,80}setIsLoadingProjects\(true\);/,
    'fetchProjects must only enter the full-page loading state for the initial load',
  );
  assert.match(
    projectsStateSource,
    /if \(shouldShowInitialLoading\) \{[\s\S]{0,80}setIsLoadingProjects\(false\);/,
    'fetchProjects must only leave the guarded initial loading state it entered',
  );
});

test('go runner workflow detail does not poll workflow state every second', () => {
  /**
   * Go-runner state/log changes already have watcher events; the detail view
   * should react to those events instead of constantly pulling the same route.
   */
  const compactWorkflow = compactSource(workflowDetailSource);

  assert.doesNotMatch(
    compactWorkflow,
    /setInterval\s*\(\s*refreshWorkflow\s*,\s*1000\s*\)/,
    'WorkflowDetailView must not poll refreshWorkflow every second',
  );
});

test('workflow detail keeps stale detail visible while revalidating same workflow', () => {
  /**
   * A watcher-driven refresh may arrive every few seconds while a workflow is
   * running.  The detail pane should keep the previous detail model visible
   * until the next detail request succeeds, otherwise users see a reload flash.
   */
  assert.match(
    workflowDetailSource,
    /type FreshWorkflowState = \{[\s\S]*identityKey: string;[\s\S]*workflow: ProjectWorkflow;[\s\S]*\};/,
    'Workflow detail must bind cached detail to a project/workflow identity',
  );
  assert.doesNotMatch(
    workflowDetailSource,
    /setFreshWorkflow\s*\(\s*null\s*\)/,
    'Workflow detail must not clear the visible detail when revalidating the same workflow',
  );
  assert.match(
    workflowDetailSource,
    /current\?\.identityKey === identityKey \? current : null/,
    'Workflow detail may clear stale detail only when navigating to another workflow',
  );
});

test('websocket heartbeat remains allowed because it does not refresh business state', () => {
  /**
   * This proposal removes business polling only.  Heartbeats keep stale sockets
   * recoverable and should remain separate from project/session refresh logic.
   */
  assert.match(
    websocketContextSource,
    /CHAT_HEARTBEAT_INTERVAL_MS/,
    'chat websocket heartbeat should remain available',
  );
});
