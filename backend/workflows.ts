// @ts-nocheck -- Complex cross-module type dependencies; needs dedicated pass.
/**
 * PURPOSE: Build project workflow read models from oz flow runner state.
 * ozw keeps the Web control plane thin: automatic workflow facts come from
 * oz flow's user-state run path, not from a local workflow mirror.
 */
import { listOpenSpecChanges } from './domains/openspec/oz-client.js';
import { db } from './database/db.js';
import {
  abortGoWorkflowRun,
  resumeGoWorkflowRun,
  startGoWorkflowRun,
} from './domains/workflows/go-runner-client.js';
import {
  listBatchReadModels,
  listWorkflowOverviewReadModels,
  listWorkflowReadModels,
} from './domains/workflows/workflow-read-model.js';
import { workflowOverviewIndexDb } from './workflow-overview-index-store.js';

/**
 * Read active OpenSpec changes through the CLI so ozw follows OpenSpec's own discovery rules.
 */
async function listOpenSpecCliChanges(projectPath) {
  /**
   * PURPOSE: Use OpenSpec as the source of truth for active proposal discovery
   * instead of duplicating its root/config resolution in ozw.
   */
  if (!projectPath) {
    return [];
  }

  try {
    return await listOpenSpecChanges(projectPath);
  } catch (error) {
    return [];
  }
}

/**
 * Enumerate active OpenSpec changes that can still be adopted by a workflow.
 */
async function listAdoptableOpenSpecChanges(projectPath) {
  if (!projectPath) {
    return [];
  }

  const workflows = await listProjectWorkflows(projectPath);
  const claimedChangeNames = new Set(
    workflows
      .map((workflow) => String(workflow.openspecChangeName || '').trim())
      .filter(Boolean),
  );

  return (await listOpenSpecCliChanges(projectPath))
    .filter((changeName) => !claimedChangeNames.has(changeName))
    .sort((left, right) => right.localeCompare(left));
}

/**
 * Ensure a workflow only adopts a real, currently-unclaimed OpenSpec change.
 */
async function validateWorkflowOpenSpecChange(projectPath, changeName) {
  const normalizedChangeName = String(changeName || '').trim();
  if (!normalizedChangeName) {
    return '';
  }

  const adoptableChanges = await listAdoptableOpenSpecChanges(projectPath);
  if (!adoptableChanges.includes(normalizedChangeName)) {
    throw new Error(`OpenSpec change is unavailable: ${normalizedChangeName}`);
  }

  return normalizedChangeName;
}

export async function listProjectWorkflows(projectPath) {
  if (!projectPath) {
    return [];
  }
  return listWorkflowReadModels(projectPath);
}

/**
 * Read workflow summaries for project overview cards.
 */
export async function listProjectWorkflowOverviews(projectPath) {
  /**
   * PURPOSE: Keep project home loading independent from workflow detail-only
   * oz CLI calls and artifact expansion.
   */
  if (!projectPath) {
    return [];
  }
  return listWorkflowOverviewReadModels(projectPath);
}

/**
 * Refresh the DB-backed workflow overview index for one project.
 */
export async function syncProjectWorkflowOverviewIndex(projectPath) {
  /**
   * PURPOSE: Move runner state parsing to background synchronization so the
   * project overview HTTP route can stay SQLite-only and fast.
   */
  if (!projectPath) {
    return [];
  }
  const [workflowOverviews, batches] = await Promise.all([
    listProjectWorkflowOverviews(projectPath),
    listProjectBatches(projectPath),
  ]);
  const workflows = workflowOverviews.map(summarizeWorkflowForProjectList);
  workflowOverviewIndexDb.replaceForProject(db, projectPath, workflows);
  workflowOverviewIndexDb.replaceBatchesForProject(db, projectPath, batches);
  return workflows;
}

/**
 * Refresh workflow overview indexes for a bounded visible project list.
 */
export async function syncWorkflowOverviewIndexesForProjects(projects: any[] = []) {
  /**
   * PURPOSE: Let startup and sidebar refreshes warm workflow overview rows in
   * the background without coupling HTTP reads to state-file traversal.
   */
  let projectCount = 0;
  let workflowCount = 0;
  for (const project of projects || []) {
    const projectPath = project?.fullPath || project?.path || '';
    if (!projectPath) {
      continue;
    }
    try {
      const workflows = await syncProjectWorkflowOverviewIndex(projectPath);
      projectCount += 1;
      workflowCount += workflows.length;
    } catch (error) {
      console.error(
        `Failed to sync workflow overview index for project ${project?.name || projectPath}:`,
        error,
      );
    }
  }
  return { projectCount, workflowCount };
}

/**
 * Build the workflow shape needed by project lists, route resolution, and sidebars.
 */
export function summarizeWorkflowForProjectList(workflow) {
  /**
   * PURPOSE: Keep the first-paint project payload bounded while preserving the
   * workflow detail fields that users see immediately after selecting a run.
   */
  const workflowOwnedSessionRefs = collectWorkflowOwnedSessionRefsForSummary(workflow);
  return {
    id: workflow.id,
    title: workflow.title,
    objective: workflow.objective,
    openspecChangeName: workflow.openspecChangeName,
    openspecChangeDetected: workflow.openspecChangeDetected,
    adoptsExistingOpenSpec: workflow.adoptsExistingOpenSpec,
    runner: workflow.runner,
    runnerProvider: workflow.runnerProvider,
    runId: workflow.runId,
    runnerError: workflow.runnerError,
    stage: workflow.stage,
    runState: workflow.runState,
    updatedAt: workflow.updatedAt,
    stageStatuses: workflow.stageStatuses || [],
    artifacts: workflow.artifacts || [],
    childSessions: workflow.childSessions || [],
    runnerProcesses: workflow.runnerProcesses || [],
    workflowRoleSummary: workflow.workflowRoleSummary,
    stageInspections: workflow.stageInspections || [],
    workflowDag: workflow.workflowDag
      ? { source: workflow.workflowDag.source }
      : undefined,
    workflowOwnedSessionRefs,
    hasUnreadActivity: workflow.hasUnreadActivity === true,
    batchId: workflow.batchId,
    batchDisplayId: workflow.batchDisplayId,
    batchIndex: workflow.batchIndex,
    batchTotal: workflow.batchTotal,
    batchStatus: workflow.batchStatus,
  };
}

function collectWorkflowOwnedSessionRefsForSummary(workflow) {
  /**
   * PURPOSE: Preserve workflow-owned provider session identity in lightweight
   * project lists so manual-session lists can hide internal child sessions.
   */
  const refsByKey = new Map();
  const addRef = (sessionId, provider = 'codex') => {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      return;
    }
    const normalizedProvider = provider === 'pi' ? 'pi' : 'codex';
    refsByKey.set(`${normalizedProvider}:${normalizedSessionId}`, {
      sessionId: normalizedSessionId,
      provider: normalizedProvider,
    });
  };

  for (const ref of workflow.workflowOwnedSessionRefs || []) {
    addRef(ref?.sessionId, ref?.provider);
  }
  for (const session of workflow.runnerDiagnostics?.workflowOwnedSessions || []) {
    addRef(session?.sessionId, session?.provider);
  }
  for (const session of workflow.diagnostics?.workflowOwnedSessions || []) {
    addRef(session?.sessionId, session?.provider);
  }

  return Array.from(refsByKey.values());
}

export async function listProjectBatches(projectPath) {
  if (!projectPath) {
    return [];
  }
  return listBatchReadModels(projectPath);
}

export async function attachWorkflowMetadata(projects) {
  /**
   * Add workflow read models without letting one corrupt project-local config
   * break the global project list used by the WebUI sidebar.
   */
  return Promise.all(
    projects.map(async (project) => {
      const projectPath = project.fullPath || project.path || '';
      let workflows = [];
      try {
        workflows = (await listProjectWorkflowOverviews(projectPath)).map(summarizeWorkflowForProjectList);
      } catch (error) {
        console.error(
          `Failed to load workflows for project ${project.name || projectPath}:`,
          error,
        );
      }
      let batches = [];
      try {
        batches = await listProjectBatches(projectPath);
      } catch (error) {
        console.error(
          `Failed to load batches for project ${project.name || projectPath}:`,
          error,
        );
      }
      return {
        ...project,
        workflows,
        batches,
        hasUnreadActivity: workflows.some((workflow) => workflow.hasUnreadActivity === true),
      };
    }),
  );
}

/**
 * Attach workflow metadata from the SQLite overview index only.
 */
export async function attachIndexedWorkflowMetadata(projects) {
  /**
   * PURPOSE: Serve project overview without parsing workflow state files or
   * batch directories on the request path.
   */
  return Promise.all(
    projects.map(async (project) => {
      const projectPath = project.fullPath || project.path || '';
      let workflows = [];
      try {
        workflows = workflowOverviewIndexDb.listForProject(db, projectPath).map(summarizeWorkflowForProjectList);
      } catch (error) {
        console.error(
          `Failed to load indexed workflows for project ${project.name || projectPath}:`,
          error,
        );
      }
      let batches = [];
      try {
        batches = workflowOverviewIndexDb.listBatchesForProject(db, projectPath);
      } catch (error) {
        console.error(
          `Failed to load indexed workflow batches for project ${project.name || projectPath}:`,
          error,
        );
      }
      return {
        ...project,
        workflows,
        batches,
        hasUnreadActivity: workflows.some((workflow) => workflow.hasUnreadActivity === true),
      };
    }),
  );
}

export function findProjectByName(projects, projectName) {
  return projects.find((project) => project.name === projectName) || null;
}

export async function createProjectWorkflow(project, payload = {}) {
  const projectPath = project?.fullPath || project?.path || '';
  if (!projectPath) {
    throw new Error('Project path is required to create a workflow');
  }

  const providedChangeName = await validateWorkflowOpenSpecChange(projectPath, payload.openspecChangeName);
  if (!providedChangeName) {
    throw new Error('Go-backed workflows require an active OpenSpec change. Create or select one from docs/changes first.');
  }
  const runResult = await startGoWorkflowRun(projectPath, providedChangeName);
  const runId = String(runResult?.run_id || '').trim();
  if (!runId) {
    throw new Error('Go runner did not return runId for the new workflow run.');
  }
  const workflow = await getProjectWorkflow(project, runId);
  if (!workflow) {
    throw new Error(`Go runner state not found for new workflow run ${runId}`);
  }
  void syncProjectWorkflowOverviewIndex(projectPath).catch((error) => {
    console.warn('[WorkflowIndex] Failed to sync after workflow creation:', error?.message || error);
  });
  return {
    ...workflow,
    runnerPid: Number.isInteger(runResult?.pid) ? runResult.pid : undefined,
  };
}

export async function listProjectAdoptableOpenSpecChanges(project) {
  const projectPath = project?.fullPath || project?.path || '';
  if (!projectPath) {
    return [];
  }

  return listAdoptableOpenSpecChanges(projectPath);
}

export async function getProjectWorkflow(project, workflowId) {
  const workflows = await listProjectWorkflows(project?.fullPath || project?.path || '');
  return workflows.find((workflow) => (
    workflow.id === workflowId
    || workflow.runId === workflowId
    || workflow.legacyId === workflowId
  )) || null;
}

export async function resumeWorkflowRun(project, workflowId) {
  /**
   * PURPOSE: Resume a Go-backed workflow through the runner contract while
   * keeping sealed state.json as the read-model source after the command exits.
   */
  const projectPath = project?.fullPath || project?.path || '';
  if (!projectPath) {
    return null;
  }

  const workflow = await getProjectWorkflow(project, workflowId);
  if (!workflow) {
    return null;
  }
  if (workflow.runner !== 'go' || !workflow.runId) {
    const error = new Error('Workflow is not bound to a Go runner run.');
    error.statusCode = 409;
    throw error;
  }

  await resumeGoWorkflowRun(projectPath, workflow.runId);
  const resumedWorkflow = await getProjectWorkflow(project, workflowId);
  void syncProjectWorkflowOverviewIndex(projectPath).catch((error) => {
    console.warn('[WorkflowIndex] Failed to sync after workflow resume:', error?.message || error);
  });
  return resumedWorkflow;
}

export async function abortWorkflowRun(project, workflowId) {
  /**
   * PURPOSE: Abort a Go-backed workflow through the runner contract so the
   * runner updates state.json and ozw only refreshes the read model.
   */
  const projectPath = project?.fullPath || project?.path || '';
  if (!projectPath) {
    return null;
  }

  const workflow = await getProjectWorkflow(project, workflowId);
  if (!workflow) {
    return null;
  }
  if (workflow.runner !== 'go' || !workflow.runId) {
    const error = new Error('Workflow is not bound to a Go runner run.');
    error.statusCode = 409;
    throw error;
  }

  await abortGoWorkflowRun(projectPath, workflow.runId);
  const abortedWorkflow = await getProjectWorkflow(project, workflowId);
  void syncProjectWorkflowOverviewIndex(projectPath).catch((error) => {
    console.warn('[WorkflowIndex] Failed to sync after workflow abort:', error?.message || error);
  });
  return abortedWorkflow;
}
