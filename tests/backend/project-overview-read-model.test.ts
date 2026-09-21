// @ts-nocheck -- Lightweight dependency doubles keep overview read-model intent clear.
/**
 * PURPOSE: Verify project overview passes every workflow-owned session source
 * to provider manual-session list filtering.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProjectOverviewReadModel,
  summarizeProjectForList,
} from '../../backend/domains/projects/project-overview-read-model.ts';

test('project list summary keeps the newest activity from nested project rows', () => {
  /**
   * PURPOSE: Keep the sidebar activity cutoff usable when a legacy project
   * object carries timestamps only on provider sessions or workflows.
   */
  const summary = summarizeProjectForList({
    name: 'activity-project',
    displayName: 'Activity Project',
    fullPath: '/tmp/activity-project',
    lastActivity: '2026-06-17T10:00:00.000Z',
    codexSessions: [
      { id: 'old-session', lastActivity: '2026-06-17T11:00:00.000Z' },
      { id: 'new-session', updated_at: '2026-06-17T13:00:00.000Z' },
    ],
    workflows: [{ id: 'run-1', updatedAt: '2026-06-17T12:00:00.000Z' }],
  });

  assert.equal(summary.lastActivity, '2026-06-17T13:00:00.000Z');
  assert.equal('codexSessions' in summary, false);
  assert.equal('workflows' in summary, false);
});

test('project overview filters workflow-owned sessions from diagnostics sources', async () => {
  /**
   * PURPOSE: Lock the recent regression where workflow-internal provider
   * sessions were present only in diagnostics and leaked into manual sessions.
   */
  const requestedOptions = [];
  await buildProjectOverviewReadModel(
    {
      name: 'diagnostics-project',
      fullPath: '/tmp/ozw-diagnostics-project',
    },
    {
      summarizeProjectForList: (project) => project,
      attachWorkflowMetadata: async (projects) => [{
        ...projects[0],
        workflows: [
          {
            id: 'run-diagnostics-only',
            runnerDiagnostics: {
              workflowOwnedSessions: [
                { sessionId: 'codex-diagnostics-child', provider: 'codex' },
              ],
            },
            diagnostics: {
              workflowOwnedSessions: [
                { sessionId: 'pi-diagnostics-child', provider: 'pi' },
              ],
            },
          },
        ],
      }],
      getCodexSessions: async (_projectPath, options) => {
        requestedOptions.push({ provider: 'codex', options });
        return [];
      },
      getPiSessions: async (_projectPath, options) => {
        requestedOptions.push({ provider: 'pi', options });
        return [];
      },
    },
  );

  const codexOptions = requestedOptions.find((entry) => entry.provider === 'codex')?.options;
  const piOptions = requestedOptions.find((entry) => entry.provider === 'pi')?.options;

  assert.equal(codexOptions.workflowOwnedSessionIds.has('codex-diagnostics-child'), true);
  assert.equal(piOptions.workflowOwnedSessionIds.has('pi-diagnostics-child'), true);
  assert.equal(codexOptions.excludeWorkflowChildSessions, true);
  assert.equal(piOptions.excludeWorkflowChildSessions, true);
});
