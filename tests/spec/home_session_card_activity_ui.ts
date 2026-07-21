/**
 * PURPOSE: Business tests for project-home session card read receipts.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { TFunction } from 'i18next';

import {
  compareSessionsByCardSortMode,
  createSessionViewModel,
} from '../../frontend/components/sidebar/utils/utils.ts';
import type { ProjectSession } from '../../frontend/types/app.ts';
import { formatTimeAgo } from '../../frontend/utils/dateUtils.ts';
import {
  getSessionActivitySignature,
  getSessionProjectName,
  getViewedSessionKey,
  hasUnreadSessionActivity,
} from '../../frontend/components/main-content/view/subcomponents/sessionActivityState.ts';
import { getSessionRouteNumber } from '../../frontend/utils/sessionCardDisplay.ts';
import {
  getMobileProjectLabel,
  MOBILE_PROJECT_LABEL_MAX_CHARACTERS,
} from '../../frontend/components/sidebar/utils/projectLabel.ts';

test('mobile project labels stop at fifteen Unicode characters', () => {
  /**
   * Mobile navigation stays compact while desktop rendering keeps the source
   * label and emoji count as one visible character.
   */
  const fullLabel = '项目😀导航名称一二三四五六七八九十';
  const mobileLabel = getMobileProjectLabel(fullLabel);

  assert.equal(Array.from(mobileLabel).length, MOBILE_PROJECT_LABEL_MAX_CHARACTERS);
  assert.equal(mobileLabel, Array.from(fullLabel).slice(0, 15).join(''));
  assert.equal(fullLabel, '项目😀导航名称一二三四五六七八九十');
});

test('historical project-home sessions are read on first visit until activity changes', () => {
  /**
   * A missing localStorage signature means the sidebar has not recorded a newer
   * activity signature yet, so the project home must not light every old card.
   */
  const session = {
    id: 'c1',
    __provider: 'codex',
    messageCount: 2,
    updatedAt: '2026-04-29T01:00:00.000Z',
  };
  const signature = getSessionActivitySignature(session);

  assert.equal(
    hasUnreadSessionActivity({
      isSelected: false,
      viewedSignature: null,
      activitySignature: signature,
    }),
    false,
  );
  assert.equal(
    hasUnreadSessionActivity({
      isSelected: false,
      viewedSignature: '1:2026-04-29T00:00:00.000Z',
      activitySignature: signature,
    }),
    true,
  );
});

test('project-home recent-message sort reads snake_case provider activity timestamp', () => {
  /**
   * Some provider/read-model payloads expose the latest activity as
   * last_activity. Project-home cards must use that timestamp for both the
   * visible time label and the "最近消息" sort order.
   */
  const now = new Date('2026-06-01T12:00:00.000Z');
  const translate = ((key: string, params: { count?: number } = {}) => {
    const labels: Record<string, string> = {
      'time.oneHourAgo': '1 小时前',
      'time.hoursAgo': `${params.count} 小时前`,
      'status.unknown': '未知时间',
    };
    return labels[key] || key;
  }) as TFunction;
  const recentlyActiveOldRoute: ProjectSession & { __provider: 'codex' } = {
    id: 'c2',
    routeIndex: 2,
    __provider: 'codex',
    title: '旧编号最近有消息',
    createdAt: '2026-06-01T08:00:00.000Z',
    last_activity: '2026-06-01T11:00:00.000Z',
    messageCount: 4,
  };
  const newerRouteWithoutRecentMessage: ProjectSession & { __provider: 'codex' } = {
    id: 'c9',
    routeIndex: 9,
    __provider: 'codex',
    title: '新编号但消息更早',
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    messageCount: 2,
  };

  const viewModel = createSessionViewModel(recentlyActiveOldRoute, now, translate);
  const sorted = [newerRouteWithoutRecentMessage, recentlyActiveOldRoute]
    .sort((left, right) => compareSessionsByCardSortMode(left, right, 'updated', translate));

  assert.equal(viewModel.sessionTime, '2026-06-01T11:00:00.000Z');
  assert.equal(formatTimeAgo(viewModel.sessionTime, now, translate), '1 小时前');
  assert.equal(getSessionActivitySignature(recentlyActiveOldRoute), '4:2026-06-01T11:00:00.000Z');
  assert.equal(sorted[0].id, 'c2');
});

test('cross-project session cards use the source project key when clearing unread state', () => {
  /**
   * Worktree and cross-project sessions carry __projectName; read receipts must
   * use that same key for rendering and click clearing.
   */
  const homeProjectName = 'main-project';
  const session = {
    id: 'c2',
    __provider: 'codex',
    __projectName: 'worktree-project',
    messageCount: 4,
    updatedAt: '2026-04-29T02:00:00.000Z',
  };

  const sourceProjectName = getSessionProjectName(homeProjectName, session);
  const renderKey = getViewedSessionKey(sourceProjectName, session);
  const clickClearKey = getViewedSessionKey(getSessionProjectName(homeProjectName, session), session);

  assert.equal(sourceProjectName, 'worktree-project');
  assert.equal(clickClearKey, renderKey);
  assert.notEqual(renderKey, getViewedSessionKey(homeProjectName, session));
});

test('project-home session cards are wired to production activity rendering', async () => {
  /**
   * Guard the business path: the project overview card must use the activity
   * helpers directly, not leave them as isolated acceptance-test utilities.
   */
  const overviewSource = await readFile(
    new URL('../../frontend/components/main-content/project-overview/ProjectOverviewPanelRuntime.impl.tsx', import.meta.url),
    'utf8',
  );
  const actionMenuSource = await readFile(
    new URL('../../frontend/components/session-actions/SessionActionIconMenu.tsx', import.meta.url),
    'utf8',
  );

  assert.match(overviewSource, /formatTimeAgo\(sessionView\.sessionTime,\s*currentTime,\s*t\)/);
  assert.match(overviewSource, /hasUnreadSessionActivity\(/);
  assert.match(overviewSource, /writeViewedSessionSignature\(sessionKey,\s*activitySignature\)/);
  assert.match(overviewSource, /<SessionActionIconMenu/);
  assert.match(actionMenuSource, /<span>\{labels\.rename\}<\/span>/);
  assert.match(actionMenuSource, /<span>\{favoriteLabel\}<\/span>/);
  assert.match(actionMenuSource, /<span>\{labels\.delete\}<\/span>/);
});

test('project-home cards expose business sort choices while sidebar stays navigation-only', async () => {
  /**
   * Sorting must be a card-display concern. The visible #cN/#wN route numbers
   * remain sourced from routeIndex while users can sort by update time, title,
   * or provider.
   */
  const overviewSource = await readFile(
    new URL('../../frontend/components/main-content/project-overview/ProjectOverviewPanelRuntime.impl.tsx', import.meta.url),
    'utf8',
  );
  const sidebarProjectItemSource = await readFile(
    new URL('../../frontend/components/sidebar/view/subcomponents/SidebarProjectItem.tsx', import.meta.url),
    'utf8',
  );

  assert.match(overviewSource, /value: 'updated', label: '最近消息'/);
  assert.match(overviewSource, /value: 'title', label: '标题'/);
  assert.match(overviewSource, /value: 'provider', label: 'Provider'/);
  assert.match(overviewSource, /compareSessionsByCardSortMode\(sessionA, sessionB, sessionSortMode, t\)/);
  assert.match(overviewSource, /min-w-\[9\.5rem\][^"]*pr-10/);
  assert.doesNotMatch(sidebarProjectItemSource, /aria-label="手动会话排序"/);
  assert.doesNotMatch(sidebarProjectItemSource, /aria-label="工作流排序"/);
  assert.doesNotMatch(sidebarProjectItemSource, /新建/);
  assert.doesNotMatch(sidebarProjectItemSource, /openWorkflowComposer|createProjectWorkflow/);
  assert.doesNotMatch(sidebarProjectItemSource, /renderProjectMarker|active-dot/);
  assert.match(sidebarProjectItemSource, /\{mobileProjectLabel\}/);
  assert.match(sidebarProjectItemSource, /\{fullProjectLabel\}/);
});

test('project-home manual sessions collapse after five rows and keep request-prefix labels', async () => {
  /**
   * The project homepage should stay scannable for busy repos: render the first
   * five manual session rows, fold the rest behind an explicit button, and keep
   * the first-request prefix as the accessible row label.
   */
  const overviewSource = await readFile(
    new URL('../../frontend/components/main-content/project-overview/ProjectOverviewPanelRuntime.impl.tsx', import.meta.url),
    'utf8',
  );

  assert.match(overviewSource, /DEFAULT_VISIBLE_MANUAL_SESSION_CARDS = 5/);
  assert.match(overviewSource, /visibleSessions\.slice\(0, DEFAULT_VISIBLE_MANUAL_SESSION_CARDS\)/);
  assert.match(overviewSource, /显示更多手动会话/);
  assert.match(overviewSource, /收起手动会话/);
  assert.match(overviewSource, /getManualSessionCardTitle\(session, sessionView\.sessionName\)/);
  assert.match(overviewSource, /className="flex flex-col gap-2"/);
  assert.match(overviewSource, /aria-label=\{sessionCardTitle\}/);
  assert.match(overviewSource, /justify-between gap-3/);
  assert.match(overviewSource, /session\.label, session\.title, session\.routeTitle, session\.summary, session\.name/);
  assert.match(overviewSource, /preferredTitle\?\.trim\(\) \|\| fallbackName\.trim\(\) \|\| fallbackName/);
  assert.match(overviewSource, /className="min-w-0 flex-1 truncate text-sm text-foreground"/);
  assert.match(overviewSource, /title=\{sessionCardTitle\}/);
  assert.doesNotMatch(overviewSource, /Array\.from\(normalizedName\)\.slice\(0, 20\)/);
  const timePosition = overviewSource.indexOf('data-slot="manual-session-time"');
  const titlePosition = overviewSource.indexOf('data-slot="manual-session-title"');
  const routeNumberPosition = overviewSource.indexOf('data-slot="manual-session-route-number"');
  assert.ok(timePosition > 0 && timePosition < titlePosition);
  assert.ok(titlePosition < routeNumberPosition);
});

test('manual session cards share compact route number metadata', async () => {
  /**
   * The workspace nav and project homepage should present the same cN number
   * before updated time and provider identity, so users can match cards to URLs.
   */
  const overviewSource = await readFile(
    new URL('../../frontend/components/main-content/project-overview/ProjectOverviewPanelRuntime.impl.tsx', import.meta.url),
    'utf8',
  );
  const workspaceNavSource = await readFile(
    new URL('../../frontend/components/app/ProjectWorkspaceNav.tsx', import.meta.url),
    'utf8',
  );
  assert.equal(getSessionRouteNumber({ routeIndex: 7, id: 'provider-id' }), '7');
  assert.equal(getSessionRouteNumber({ id: 'c12' }), '12');
  assert.equal(getSessionRouteNumber({ id: 'codex-provider-id' }), null);
  assert.match(overviewSource, /getSessionRouteNumber\(session\)/);
  assert.match(workspaceNavSource, /getSessionRouteNumber\(session\)/);
  assert.match(workspaceNavSource, /<SessionProviderLogo[\s\S]*className="h-3\.5 w-3\.5 shrink-0 text-muted-foreground"/);
});

test('left navigation keeps workflow groups out of the project list', async () => {
  /**
   * Workflow history and active runs belong on the project homepage; the left
   * navigation remains a project list without nested workflow cards.
   */
  const workspaceNavSource = await readFile(
    new URL('../../frontend/components/app/ProjectWorkspaceNav.tsx', import.meta.url),
    'utf8',
  );
  const sidebarProjectItemSource = await readFile(
    new URL('../../frontend/components/sidebar/view/subcomponents/SidebarProjectItem.tsx', import.meta.url),
    'utf8',
  );
  const sidebarProjectListSource = await readFile(
    new URL('../../frontend/components/sidebar/view/subcomponents/SidebarProjectList.tsx', import.meta.url),
    'utf8',
  );

  assert.match(workspaceNavSource, /const activeWorkflows = useMemo\(\(\) => workflows\.filter\(\(workflow\) => !isWorkflowCompleted\(workflow\)\)/);
  assert.match(workspaceNavSource, /\{activeWorkflows\.length > 0 && \(/);
  assert.match(workspaceNavSource, /activeWorkflows\.map\(\(workflow\) =>/);
  assert.doesNotMatch(sidebarProjectItemSource, /SidebarProjectWorkflows|project-workflow-group|暂无需求工作流/);
  assert.doesNotMatch(sidebarProjectListSource, /SidebarProjectWorkflows|project-workflow-group/);
});
