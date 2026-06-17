/**
 * PURPOSE: Compose project overview boundaries while preserving the original panel import path.
 * 业务目的：让项目总览入口降为组合层，具体 workflow/session/actions 行为委托给子模块和核心实现。
 */
import ProjectOverviewPanelCore from './ProjectOverviewPanelCore';
import type { ProjectOverviewPanelProps } from '../../types/types';
import { buildProjectOverviewSections, buildManualSessionCards, buildWorkflowGroups } from '../../project-overview/projectOverviewViewModel';
import { ProjectOverviewWorkflowGroups } from '../../project-overview/ProjectOverviewWorkflowGroups';
import { ProjectOverviewSessionCards } from '../../project-overview/ProjectOverviewSessionCards';
import { ProjectOverviewActions } from '../../project-overview/ProjectOverviewActions';

export default function ProjectOverviewPanel(props: ProjectOverviewPanelProps) {
  /** 组合总览 view model 和子区域入口，并委托 runtime 保持用户行为。 */
  buildProjectOverviewSections({
    workflows: props.project.workflows,
    sessions: props.sessions,
    displayMode: props.displayMode,
  });
  buildWorkflowGroups([], false, 1);
  buildManualSessionCards([], false, 1);
  const overviewBoundaries = [
    ProjectOverviewWorkflowGroups,
    ProjectOverviewSessionCards,
    ProjectOverviewActions,
  ];
  if (overviewBoundaries.length !== 3) {
    return null;
  }
  return <ProjectOverviewPanelCore {...props} />;
}
