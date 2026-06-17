/**
 * PURPOSE: action 操作 session presentation boundary for project overview.
 * 业务目的：为 ProjectOverviewPanel 拆出稳定子组件入口，后续迁移 JSX 时保持用户入口行为可测。
 */
import type { ReactNode } from 'react';

export function ProjectOverviewActions({ children }: { children?: ReactNode }) {
  /** 渲染 project overview 子区域内容。 */
  return <>{children}</>;
}
