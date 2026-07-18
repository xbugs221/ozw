/**
 * 文件目的：用真实 project/session/workflow 样例锁定项目路由、会话集合和刷新合并的低状态业务行为。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  resolveRouteSelection,
  shouldPollWorkflowPlanningSession,
} from '../../frontend/hooks/projects/projectRouteSelection';
import {
  getProjectSessions,
  getNextManualSessionRouteIndex,
  insertSessionIntoProject,
  isUpdateAdditive,
} from '../../frontend/hooks/projects/projectSessionCollections';
import {
  findRefreshedSelectedSession,
  mergeProjectSummaries,
  projectMatchesOverview,
} from '../../frontend/hooks/projects/projectRefreshReducer';
import { resolveSessionProvider } from '../../frontend/utils/session-provider';

type LooseProject = Record<string, any>;

function buildProjectFixture(): LooseProject {
  /**
   * 构造同时包含 Codex、Pi 和 workflow child session 的项目，模拟项目页真实 read model。
   */
  return {
    name: 'demo',
    displayName: 'Demo',
    routePath: '/projects/demo',
    fullPath: '/work/demo',
    manualSessionNextRouteIndex: 2,
    sessionMeta: { total: 2 },
    sessions: [
      { id: 'legacy-hidden', routeIndex: 9, hidden: true },
      { id: 'archived-session', routeIndex: 10, status: 'archived' },
    ],
    codexSessions: [
      { id: 'codex-1', routeIndex: 1, title: 'Codex 1', __provider: 'codex', projectPath: '/work/demo' },
    ],
    piSessions: [
      { id: 'pi-2', routeIndex: 2, title: 'Pi 2', __provider: 'pi', projectPath: '/work/demo' },
      { id: 'workflow-review', routeIndex: 12, title: 'Review child', __provider: 'pi', workflowId: 'workflow-1', stageKey: 'review_1', projectPath: '/work/demo' },
    ],
    workflows: [
      {
        id: 'workflow-1',
        runId: 'run-1',
        stage: 'review_1',
        stageStatuses: [{ key: 'planning', status: 'ready' }],
        childSessions: [
          {
            id: 'workflow-review',
            workflowId: 'workflow-1',
            stageKey: 'review_1',
            role: 'reviewer',
            provider: 'pi',
            address: 'review_1/reviewer',
            routePath: '/projects/demo/runs/run-1/sessions/review_1/reviewer',
            projectPath: '/work/demo',
          },
        ],
        runnerProcesses: [],
      },
    ],
  };
}

test('project routes keep project session and provider ownership stable', () => {
  /**
   * 用户从 URL 进入项目时，cN、legacy 和 workflow child route 都必须回到同一个业务会话。
   */
  const project = buildProjectFixture();
  const projects = [project] as any[];

  const directPiRoute = resolveRouteSelection(projects, '/projects/demo/c2');
  assert.equal(directPiRoute.project?.name, 'demo');
  assert.equal(directPiRoute.session?.id, 'pi-2');
  assert.equal(directPiRoute.session?.__provider, 'pi');

  const workflowChildRoute = resolveRouteSelection(projects, '/projects/demo/runs/run-1/sessions/review_1/reviewer');
  assert.equal(workflowChildRoute.project?.name, 'demo');
  assert.equal(workflowChildRoute.session?.id, 'workflow-review');
  assert.equal(workflowChildRoute.session?.workflowId, 'workflow-1');
  assert.equal(workflowChildRoute.session?.stageKey, 'review_1');
  assert.equal(workflowChildRoute.session?.__provider, 'pi');

  const legacyRoute = resolveRouteSelection(projects, '/session/c2', 'projectPath=/work/demo&provider=pi');
  assert.equal(legacyRoute.project?.fullPath, '/work/demo');
  assert.equal(legacyRoute.session?.id, 'c2');
  assert.equal(legacyRoute.session?.__provider, 'pi');

  const visibleSessionIds = getProjectSessions(project as any).map((session) => session.id);
  assert.deepEqual(visibleSessionIds, ['codex-1', 'pi-2', 'workflow-review']);
  assert.equal(getNextManualSessionRouteIndex(project as any), 13);
  assert.equal(shouldPollWorkflowPlanningSession(project.workflows[0]), true);
});

test('project cN route honors provider hint for Pi sessions', () => {
  /**
   * Pi 页面带 provider=pi 时，刷新或重进 cN URL 不能被同编号 Codex 会话抢占。
   */
  const project = buildProjectFixture();
  project.codexSessions.push({
    id: 'codex-route-2',
    routeIndex: 2,
    title: 'Codex route 2',
    __provider: 'codex',
    projectPath: '/work/demo',
  });
  const projects = [project] as any[];

  const defaultRoute = resolveRouteSelection(projects, '/projects/demo/c2');
  assert.equal(defaultRoute.session?.id, 'codex-route-2');
  assert.equal(defaultRoute.session?.__provider, 'codex');

  const hintedPiRoute = resolveRouteSelection(projects, '/projects/demo/c2', 'provider=pi&projectPath=/work/demo');
  assert.equal(hintedPiRoute.session?.id, 'pi-2');
  assert.equal(hintedPiRoute.session?.__provider, 'pi');
});

test('Claude cN route restores provider ownership without a query hint', () => {
  /** Claude 索引会先提供 provider 字段；直达或重载 URL 仍必须进入同一 Claude TUI。 */
  const project = buildProjectFixture();
  project.claudeSessions = [{
    id: 'claude-7',
    routeIndex: 7,
    title: 'Claude 7',
    provider: 'claude',
    projectPath: '/work/demo',
  }];

  const directRoute = resolveRouteSelection([project] as any[], '/projects/demo/c7');
  assert.equal(directRoute.session?.id, 'claude-7');
  assert.equal(directRoute.session?.provider, 'claude');
  assert.equal(resolveSessionProvider(null, directRoute.session, project), 'claude');

  const hintedRoute = resolveRouteSelection([project] as any[], '/projects/demo/c7', 'provider=claude');
  assert.equal(hintedRoute.session?.id, 'claude-7');
  assert.equal(hintedRoute.session?.provider, 'claude');
});

test('project refresh preserves loaded details and replaces temporary cN selection', () => {
  /**
   * 轻量列表刷新只能更新 summary 字段，不能抹掉用户当前已加载的详情和 provider sessions。
   */
  const detailedProject = buildProjectFixture();
  const summary = {
    name: 'demo',
    displayName: 'Demo refreshed',
    routePath: '/projects/demo',
    fullPath: '/work/demo',
    sessionMeta: { total: 99 },
    sessions: [],
    workflows: [],
  };

  const [merged] = mergeProjectSummaries([detailedProject as any], [summary as any]);
  assert.equal(merged.displayName, 'Demo refreshed');
  assert.deepEqual((merged.workflows || []).map((workflow: any) => workflow.id), ['workflow-1']);
  assert.deepEqual((merged.piSessions || []).map((session: any) => session.id), ['pi-2', 'workflow-review']);
  assert.ok(merged.sessionMeta, 'refresh merge must keep the loaded session meta');
  assert.equal(merged.sessionMeta.total, 2);

  const withOptimistic = insertSessionIntoProject(
    detailedProject as any,
    { id: 'pi-13', routeIndex: 13, title: 'Pi 13' } as any,
    'pi',
  ) as any;
  assert.equal(withOptimistic.piSessions[0].id, 'pi-13');
  assert.equal(withOptimistic.sessionMeta.total, 4);

  const refreshedSession = findRefreshedSelectedSession(
    withOptimistic,
    { id: 'c13', routeIndex: 13, __provider: 'pi' } as any,
    getProjectSessions as any,
  );
  assert.equal(refreshedSession?.id, 'pi-13');

  const additive = isUpdateAdditive(
    [withOptimistic] as any,
    [{ ...withOptimistic, piSessions: withOptimistic.piSessions.map((session: any) => (
      session.id === 'pi-13' ? { ...session, updated_at: 'changed' } : session
    )) }] as any,
    withOptimistic as any,
    { id: 'pi-13', title: 'Pi 13' } as any,
  );
  assert.equal(additive, false);
});

test('project refresh does not merge same-name projects with different paths', () => {
  /**
   * 项目列表存在同名或相近名称时，带路径的概览必须只归属同一路径，不能按名称兜底覆盖。
   */
  const detailedProject = {
    name: 'fixture-project',
    displayName: 'fixture-project',
    fullPath: '/workspace/fixture-project',
    codexSessions: [{ id: 'manual-session', routeIndex: 1 }],
  };
  const unrelatedSummary = {
    name: 'fixture-project',
    displayName: 'fixture-project',
    fullPath: '/workspace/other/fixture-project',
    sessionMeta: { total: 0 },
  };

  assert.equal(projectMatchesOverview(detailedProject as any, unrelatedSummary as any), false);
  const [merged] = mergeProjectSummaries([detailedProject as any], [unrelatedSummary as any]);
  assert.equal(merged.fullPath, '/workspace/other/fixture-project');
  assert.equal(merged.codexSessions, undefined);
});
