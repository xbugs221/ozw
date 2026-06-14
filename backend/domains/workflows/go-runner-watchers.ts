/**
 * PURPOSE: Share Go runner watcher registration logic between HTTP routes,
 * startup bootstrap, and tests without coupling tests to the full Express app.
 */

/**
 * Register Go runner watchers for every visible Go-backed workflow.
 */
export async function ensureGoRunnerWatchersForProjects(
  projects: Array<{ fullPath?: string; path?: string; workflows?: Array<{ runId?: string | number; runner?: string }> }> = [],
  watchWorkflowRun: (project: Record<string, unknown>, workflow: Record<string, unknown>) => Promise<unknown>
) {
  /**
   * PURPOSE: Workflow listing can adopt external oz flow runs after startup, so the
   * caller must be able to make those newly visible runs live-refreshable.
   */
  if (typeof watchWorkflowRun !== 'function') {
    throw new TypeError('watchWorkflowRun is required');
  }

  for (const project of Array.isArray(projects) ? projects : []) {
    for (const workflow of (project as Record<string, unknown>)?.workflows as Array<Record<string, unknown>> || []) {
      await watchWorkflowRun(project as Record<string, unknown>, workflow);
    }
  }
}
