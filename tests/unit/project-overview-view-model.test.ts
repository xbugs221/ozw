/**
 * 文件目的：验证 projectOverviewViewModel 保护项目总览 workflow/session 入口。
 * 业务风险：总览入口切片错误会让用户看不到正在跟进的 workflow 或手动 session。
 */
import { expect, it } from 'vitest';
import { buildProjectOverviewSections, buildManualSessionCards, buildWorkflowGroups } from '../../frontend/components/main-content/project-overview/projectOverviewViewModel.ts';

it('projectOverviewViewModel keeps workflow and session sections aligned with display mode', () => {
  /** 用户切换总览模式时，只应隐藏对应区域，不应改变数量统计。 */
  const sections = buildProjectOverviewSections({ workflows: [{ id: 'w1' } as any], sessions: [{ id: 's1' } as any], displayMode: 'workflows' });
  expect(sections.showWorkflowSection).toBe(true);
  expect(sections.showSessionSection).toBe(false);
  expect(sections.workflowCount).toBe(1);
  expect(sections.sessionCount).toBe(1);
});

it('projectOverviewViewModel slices collapsed workflow groups and manual session cards', () => {
  /** 折叠状态只限制展示数量，展开后必须恢复完整入口。 */
  expect(buildWorkflowGroups(['latest', 'older'], false, 1)).toEqual(['latest']);
  expect(buildWorkflowGroups(['latest', 'older'], true, 1)).toEqual(['latest', 'older']);
  expect(buildManualSessionCards(['c1', 'c2', 'c3'] as any, false, 2)).toEqual(['c1', 'c2']);
});
