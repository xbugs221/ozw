/**
 * 文件目的：锁定项目侧栏按最近三天活动分组的时间边界与数据来源。
 * 业务风险：项目摘要缺失或历史会话有新活动时，项目不能被错误地归入“非活跃”。
 */
import { expect, it } from 'vitest';
import type { Project } from '../../frontend/types/app';
import { getProjectLastActivity, isProjectRecentlyActive } from '../../frontend/components/sidebar/utils/utils';

const NOW = Date.parse('2026-09-21T12:00:00.000Z');

function makeProject(overrides: Partial<Project> = {}): Project {
  /** 构造只包含侧栏活动判定所需字段的项目摘要。 */
  return {
    name: 'activity-project',
    displayName: 'Activity project',
    fullPath: '/tmp/activity-project',
    ...overrides,
  };
}

it('treats exactly three days of activity as recent and older activity as inactive', () => {
  /** 三天窗口包含边界时刻，但不包含边界之外的旧活动。 */
  const boundary = new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString();
  const justOlder = new Date(NOW - 3 * 24 * 60 * 60 * 1000 - 1).toISOString();

  expect(isProjectRecentlyActive(makeProject({ lastActivity: boundary }), NOW)).toBe(true);
  expect(isProjectRecentlyActive(makeProject({ lastActivity: justOlder }), NOW)).toBe(false);
});

it('keeps an empty project inactive while accepting a recent summary timestamp', () => {
  /** 没有摘要、没有会话时应落入非活跃；轻量项目摘要足够支持侧栏分组。 */
  expect(getProjectLastActivity(makeProject(), {}).getTime()).toBe(0);
  expect(isProjectRecentlyActive(makeProject(), NOW)).toBe(false);
  expect(isProjectRecentlyActive(makeProject({ lastActivity: new Date(NOW - 1).toISOString() }), NOW)).toBe(true);
});

it('uses recent activity from a historical provider session when the summary is stale', () => {
  /** 历史索引里的新消息优先于旧项目摘要，项目应回到主导航列表。 */
  const recentSession = new Date(NOW - 60 * 60 * 1000).toISOString();
  const project = makeProject({
    lastActivity: new Date(NOW - 10 * 24 * 60 * 60 * 1000).toISOString(),
    codexSessions: [{ id: 'historical-session', lastActivity: recentSession }],
  });

  expect(getProjectLastActivity(project, {}).toISOString()).toBe(recentSession);
  expect(isProjectRecentlyActive(project, NOW)).toBe(true);
});
