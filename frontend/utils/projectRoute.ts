/**
 * PURPOSE: Build and parse canonical project, workflow, and session routes.
 */
import type { Project } from '../types/app';

type ProjectRouteTarget = Pick<Project, 'fullPath' | 'path' | 'name'> & { routePath?: string };
type WorkflowRouteTarget = { routeIndex?: number; id?: string; runId?: string };
type SessionRouteTarget = { routeIndex?: number; id?: string; role?: string; stageKey?: string; address?: string; routePath?: string };

function normalizeSlashPath(value: string): string {
  /**
   * Normalize filesystem-like project identities into browser pathname prefixes.
   */
  const normalized = String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!normalized || normalized === '/') {
    return '/';
  }
  return normalized.startsWith('/') ? normalized.replace(/\/+$/g, '') : `/${normalized.replace(/\/+$/g, '')}`;
}

function appendRouteSegment(routePrefix: string, segment: string): string {
  /**
   * Join canonical route pieces without producing a protocol-relative `//...`
   * URL when the project prefix is the root path.
   */
  const normalizedPrefix = normalizeSlashPath(routePrefix);
  return normalizedPrefix === '/' ? `/${segment}` : `${normalizedPrefix}/${segment}`;
}

export function getProjectRoutePath(project: ProjectRouteTarget): string {
  /**
   * Prefer the backend routePath because HOME-relative projects may need a
   * synthetic prefix such as `/~` when the project path is HOME itself.
   */
  return normalizeSlashPath(project.routePath || project.fullPath || project.path || project.name);
}

function assertIndexedSegment(prefix: 'w' | 'c', target: WorkflowRouteTarget | SessionRouteTarget): string {
  /**
   * Convert persisted route indexes into stable wN/cN URL segments.
   */
  if (prefix === 'c' && typeof target?.id === 'string' && /^c\d+$/.test(target.id)) {
    return target.id;
  }

  const routeIndex = Number(target?.routeIndex);
  if (!Number.isInteger(routeIndex) || routeIndex <= 0) {
    throw new Error(`Missing stable ${prefix.toUpperCase()} route index`);
  }
  return `${prefix}${routeIndex}`;
}

export function buildProjectRoute(project: ProjectRouteTarget): string {
  /**
   * Build the canonical route for a project overview.
   */
  return getProjectRoutePath(project);
}

export function buildProjectWorkflowRoute(
  project: ProjectRouteTarget,
  workflow: WorkflowRouteTarget,
): string {
  /**
   * Build the canonical route for one project workflow.
   */
  const runId = String(workflow.runId || workflow.id || '').trim();
  if (!runId) {
    throw new Error('Missing workflow run id');
  }
  return appendRouteSegment(buildProjectRoute(project), `runs/${encodeURIComponent(runId)}`);
}

export function buildProjectSessionRoute(
  project: ProjectRouteTarget,
  session: SessionRouteTarget,
): string {
  /**
   * Build the canonical route for one project-level chat session.
   */
  return appendRouteSegment(buildProjectRoute(project), assertIndexedSegment('c', session));
}

export function buildWorkflowChildSessionRoute(
  project: ProjectRouteTarget,
  workflow: WorkflowRouteTarget,
  session: SessionRouteTarget,
): string {
  /**
   * Build the canonical route for one runner-owned workflow child chat session.
   */
  const backendRoutePath = String(session.routePath || '').trim();
  if (backendRoutePath.startsWith('/runs/')) {
    return appendRouteSegment(buildProjectRoute(project), backendRoutePath.replace(/^\/+/g, ''));
  }
  const sessionAddress = String(session.address || session.stageKey || session.role || session.id || '').trim();
  if (!sessionAddress) {
    throw new Error('Missing workflow child session address');
  }
  return appendRouteSegment(
    buildProjectWorkflowRoute(project, workflow),
    `sessions/${sessionAddress.split('/').map(encodeURIComponent).join('/')}`,
  );
}

export function parseIndexedRouteSegment(segment: string, prefix: 'w' | 'c'): number | null {
  /**
   * Parse wN/cN route segments back into stable numeric route indexes.
   */
  const matched = String(segment || '').match(new RegExp(`^${prefix}(\\d+)$`));
  if (!matched) {
    return null;
  }

  const parsed = Number.parseInt(matched[1], 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
