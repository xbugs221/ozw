/**
 * PURPOSE: Build project overview view-models for workflow groups and manual session cards.
 * 业务目的：把项目总览的 workflow/session 排序与切片规则从页面组合层拆出，便于测试用户入口是否稳定。
 */
import type { ProjectSession, ProjectWorkflow } from '../../../types/app';

export function buildWorkflowGroups<TGroup>(groups: TGroup[], showAll: boolean, defaultVisible: number): TGroup[] {
  /** 根据折叠状态返回应展示的 workflow 分组。 */
  return showAll ? groups : groups.slice(0, Math.max(0, defaultVisible));
}

export function buildManualSessionCards<TSession extends ProjectSession>(sessions: TSession[], showAll: boolean, defaultVisible: number): TSession[] {
  /** 根据折叠状态返回应展示的手动 session 卡片。 */
  return showAll ? sessions : sessions.slice(0, Math.max(0, defaultVisible));
}

export function buildProjectOverviewSections(input: { workflows?: ProjectWorkflow[]; sessions?: ProjectSession[]; displayMode?: 'all' | 'workflows' | 'sessions' }) {
  /** 计算项目总览当前应显示 workflow 区和 session 区。 */
  const displayMode = input.displayMode || 'all';
  return { showWorkflowSection: displayMode === 'all' || displayMode === 'workflows', showSessionSection: displayMode === 'all' || displayMode === 'sessions', workflowCount: input.workflows?.length || 0, sessionCount: input.sessions?.length || 0 };
}
