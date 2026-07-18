/**
 * PURPOSE: Resolve project, workflow, and session selection from URLs without
 * embedding route parsing business rules in useProjectsState.
 */
import type { Project, ProjectSession, ProjectWorkflow } from '../../types/app';
import {
  getProjectRoutePath,
  parseIndexedRouteSegment,
} from '../../utils/projectRoute';
import { isWorkflowOwnedSession } from '../../utils/workflowSessions';
import { resolveSessionProvider } from '../../utils/session-provider';
import { getProjectSessions } from './projectSessionCollections';

export type ResolvedRouteSelection = {
  project: Project | null;
  workflow: ProjectWorkflow | null;
  session: ProjectSession | null;
};

type WorkflowChildSessionRouteEntry = ProjectWorkflow['childSessions'][number];
type WorkflowRunnerProcessRouteEntry = NonNullable<ProjectWorkflow['runnerProcesses']>[number];

export const normalizePathname = (pathname: string): string => {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/g, '') || '/';
};

/**
 * Resolve the workflow child session addressed by a nested session URL.
 */
export function findWorkflowChildSessionForRoute(
  workflow: ProjectWorkflow,
  route: {
    childAddress: string;
    isByIdAddress: boolean;
    addressStage: string;
    addressRole: string;
    addressSessionId: string;
    runnerProcess: WorkflowRunnerProcessRouteEntry | null;
  },
): WorkflowChildSessionRouteEntry | null {
  const childSessions = workflow.childSessions || [];
  const encodedChildAddress = route.childAddress.split('/').map(encodeURIComponent).join('/');
  const exactChildSession = childSessions.find((entry) => (
    entry.address === route.childAddress ||
    entry.routePath?.endsWith(`/sessions/${encodedChildAddress}`) ||
    entry.routePath?.endsWith(`/sessions/${route.childAddress}`) ||
    (route.isByIdAddress && entry.id === route.addressSessionId)
  )) || null;
  if (exactChildSession) return exactChildSession;

  if (!route.isByIdAddress && route.addressRole) {
    const roleChildSession = childSessions.find((entry) => (
      entry.stageKey === route.addressStage && entry.role === route.addressRole
    )) || null;
    if (roleChildSession) return roleChildSession;
  }

  const runnerSessionId = route.runnerProcess?.sessionId;
  if (runnerSessionId) {
    const runnerChildSession = childSessions.find((entry) => entry.id === runnerSessionId) || null;
    if (runnerChildSession) return runnerChildSession;
  }

  if (!route.isByIdAddress && !route.addressRole) {
    return childSessions.find((entry) => (
      entry.stageKey === route.addressStage && !entry.address && !entry.routePath
    )) || null;
  }

  return null;
}

/**
 * Resolve the selected project, workflow, and session for a pathname.
 */
export const resolveRouteSelection = (
  projects: Project[],
  pathname: string,
  search = typeof window === 'undefined' ? '' : window.location.search,
): ResolvedRouteSelection => {
  const normalizedPathname = normalizePathname(pathname);
  if (normalizedPathname === '/') return { project: null, workflow: null, session: null };

  const legacySessionMatch = normalizedPathname.match(/^\/session\/([^/]+)$/);
  if (legacySessionMatch) {
    const legacySessionId = decodeURIComponent(legacySessionMatch[1]);
    for (const project of projects) {
      const session = getProjectSessions(project).find((entry) => entry.id === legacySessionId) || null;
      if (session) return { project, workflow: null, session };
    }
    const cNMatch = legacySessionId.match(/^c(\d+)$/);
    if ((legacySessionId.startsWith('codex-') || cNMatch !== null) && projects[0]) {
      const routeIndex = cNMatch ? Number(cNMatch[1]) : undefined;
      const searchParams = new URLSearchParams(search);
      const projectPathParam = searchParams.get('projectPath') || '';
      const providerParam = searchParams.get('provider') || 'codex';
      const resolvedProject = projectPathParam
        ? projects.find((p) => (p.fullPath || p.path) === projectPathParam) || projects[0]
        : projects[0];
      return {
        project: resolvedProject,
        workflow: null,
        session: {
          id: legacySessionId,
          routeIndex,
          summary: legacySessionId.startsWith('codex-') ? 'Codex Session' : `会话${String(routeIndex ?? '')}`,
          provider: providerParam as ProjectSession['provider'],
          __provider: providerParam as ProjectSession['__provider'],
          __projectName: resolvedProject?.name,
          projectPath: projectPathParam || resolvedProject?.fullPath || resolvedProject?.path || '',
        } as ProjectSession,
      };
    }
  }

  const matchedProject = [...projects]
    .sort((left, right) => getProjectRoutePath(right).length - getProjectRoutePath(left).length)
    .find((project) => {
      const projectRoute = getProjectRoutePath(project);
      return normalizedPathname === projectRoute || normalizedPathname.startsWith(`${projectRoute}/`);
    }) || null;
  if (!matchedProject) return { project: null, workflow: null, session: null };

  const projectRoute = getProjectRoutePath(matchedProject);
  const remainder = normalizedPathname.slice(projectRoute.length).replace(/^\/+/g, '');
  if (!remainder) return { project: matchedProject, workflow: null, session: null };

  const routeSegments = remainder.split('/').filter(Boolean);
  const workflowRunId = routeSegments[0] === 'runs' ? decodeURIComponent(routeSegments[1] || '') : '';
  const sessionRouteIndex = parseIndexedRouteSegment(routeSegments[0], 'c');

  if (workflowRunId && routeSegments.length === 2) {
    const workflow = (matchedProject.workflows || []).find((entry) => (
      entry.runId === workflowRunId || entry.id === workflowRunId
    )) || null;
    return { project: matchedProject, workflow, session: null };
  }

  if (sessionRouteIndex && routeSegments.length === 1) {
    const searchParams = new URLSearchParams(search);
    const routeProvider = searchParams.get('provider');
    const hintedProvider = routeProvider === 'pi' ? 'pi' : routeProvider === 'claude' ? 'claude' : null;
    const session = getProjectSessions(matchedProject).find((entry) => (
      entry.routeIndex === sessionRouteIndex
      && !isWorkflowOwnedSession(matchedProject, entry)
      && (!hintedProvider || resolveSessionProvider(null, entry, matchedProject) === hintedProvider)
    )) || null;
    return {
      project: matchedProject,
      workflow: null,
      session: session || {
        id: `c${sessionRouteIndex}`,
        routeIndex: sessionRouteIndex,
        title: `会话${sessionRouteIndex}`,
        summary: `会话${sessionRouteIndex}`,
        provider: hintedProvider || 'codex',
        __provider: hintedProvider || 'codex',
        projectPath: matchedProject.fullPath || matchedProject.path || '',
        __projectName: matchedProject.name,
      } as ProjectSession,
    };
  }

  if (workflowRunId && routeSegments.length >= 4 && routeSegments[2] === 'sessions') {
    const workflow = (matchedProject.workflows || []).find((entry) => (
      entry.runId === workflowRunId || entry.id === workflowRunId
    )) || null;
    const childAddress = routeSegments.slice(3).map((segment) => decodeURIComponent(segment || '').trim()).filter(Boolean).join('/');
    if (!workflow || !childAddress) return { project: matchedProject, workflow: null, session: null };

    const childAddressParts = childAddress.split('/').filter(Boolean);
    const isByIdAddress = childAddressParts[0] === 'by-id' && childAddressParts.length >= 2;
    const addressStage = isByIdAddress ? '' : childAddressParts[0] || '';
    const addressRole = isByIdAddress ? '' : childAddressParts[1] || '';
    const addressSessionId = isByIdAddress ? childAddressParts.slice(1).join('/') : '';
    const runnerProcess = (workflow.runnerProcesses || []).find((entry) => (
      isByIdAddress
        ? entry.sessionId === addressSessionId
        : (entry.stage === addressStage && Boolean(addressRole) && entry.role === addressRole)
    )) || null;
    const childSession = findWorkflowChildSessionForRoute(workflow, {
      childAddress,
      isByIdAddress,
      addressStage,
      addressRole,
      addressSessionId,
      runnerProcess,
    });
    const projectSession = getProjectSessions(matchedProject).find((entry) => (
      entry.id === childSession?.id ||
      entry.id === runnerProcess?.sessionId ||
      (entry.workflowId === workflow.id && (
        entry.stageKey === childAddress ||
        entry.id === childAddress ||
        entry.stageKey === runnerProcess?.stage
      ))
    )) || null;
    const session = (childSession || projectSession)
      ? (() => {
          const sessionProvider = resolveSessionProvider(childSession, projectSession, matchedProject);
          const baseSession = projectSession || {
            id: childSession?.id || runnerProcess?.sessionId || `${workflow.id}-${childAddress}`,
            title: childSession?.title,
            summary: childSession?.summary,
          };
          return {
            ...baseSession,
            routeIndex: projectSession?.routeIndex,
            workflowId: childSession?.workflowId || projectSession?.workflowId || workflow.id,
            projectPath: childSession?.projectPath || projectSession?.projectPath || matchedProject.fullPath || matchedProject.path,
            role: childSession?.role || runnerProcess?.role,
            stageKey: childSession?.stageKey || projectSession?.stageKey || runnerProcess?.stage,
            __provider: sessionProvider,
            __projectName: matchedProject.name,
          };
        })()
      : null;
    return { project: matchedProject, workflow: null, session };
  }

  return { project: matchedProject, workflow: null, session: null };
};

/**
 * Extract the stable `/cN` route segment for a project-level manual session.
 */
export const getDirectSessionRouteIndex = (
  project: Project | null,
  pathname: string,
): number | null => {
  if (!project) return null;

  const normalizedPathname = normalizePathname(pathname);
  const projectRoute = getProjectRoutePath(project);
  if (!normalizedPathname.startsWith(`${projectRoute}/`)) return null;

  const remainder = normalizedPathname.slice(projectRoute.length).replace(/^\/+/g, '');
  const routeSegments = remainder.split('/').filter(Boolean);
  if (routeSegments.length !== 1) return null;

  return parseIndexedRouteSegment(routeSegments[0], 'c');
};

/**
 * Resolve the freshest workflow snapshot available for child-session navigation.
 */
export const findWorkflowById = (
  project: Project | null | undefined,
  workflowId: string | undefined,
): ProjectWorkflow | null => {
  if (!project || !workflowId) return null;
  return (project.workflows || []).find((workflow) => workflow.id === workflowId) || null;
};

/**
 * Detect whether the workflow detail already has a routable planning session.
 */
export const hasPlanningChildSession = (workflow: ProjectWorkflow | null): boolean => (
  Boolean((workflow?.childSessions || []).some((session) => session.stageKey === 'planning'))
);

/**
 * Keep workflow details fresh only while the planning child session is expected.
 */
export const shouldPollWorkflowPlanningSession = (workflow: ProjectWorkflow | null): boolean => {
  if (!workflow || hasPlanningChildSession(workflow)) return false;
  const planningStatus = (workflow.stageStatuses || []).find((stage) => stage.key === 'planning')?.status;
  return workflow.stage === 'planning' || planningStatus === 'active' || planningStatus === 'ready';
};
