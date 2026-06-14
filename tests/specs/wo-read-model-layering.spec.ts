// Sources: 112-wo工作流读模型分层
/**
 * PURPOSE: Verify the wo workflow read model stays split across typed
 * business-concept modules instead of regressing into one giant untyped file.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const READ_MODEL_BOUNDARY_MODULES = [
  {
    path: 'backend/domains/workflows/read-model/stage-taxonomy.ts',
    exports: ['mapStageStatus', 'inferRole', 'stageLabel'],
  },
  {
    path: 'backend/domains/workflows/read-model/session-refs.ts',
    exports: ['inferSubagentRoleStage', 'acceptedProviderFromSessionKey', 'isKnownProvider', 'buildChildSessions'],
  },
  {
    path: 'backend/domains/workflows/read-model/artifact-reader.ts',
    exports: ['scanRunDirFixedArtifacts', 'buildPathReadModel', 'collectPlanningTestFileEntries', 'buildPlanningArtifacts'],
  },
  {
    path: 'backend/domains/workflows/read-model/dag-read-model.ts',
    exports: ['collectDagTargetsByStage', 'mergeStageSessions', 'mergeStageArtifacts', 'runWoGraph', 'runWoStatus', 'buildWorkflowDag'],
  },
  {
    path: 'backend/domains/workflows/read-model/status-summary.ts',
    exports: [
      'markerForStageStatus',
      'isCompletedStatus',
      'isActiveStatus',
      'buildStageStatuses',
      'buildWorkflowDisplayLines',
      'buildWorkflowRoleSummary',
      'buildWorkflowStatusSummary',
      'buildStageInspections',
    ],
  },
];

/**
 * Read a repository source file for workflow read-model boundary checks.
 */
async function readRepoSource(relativePath: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relativePath), 'utf8');
}

test('wo read model is split by stage session artifact DAG and summary concepts', async () => {
  const mainSource = await readRepoSource('backend/domains/workflows/workflow-read-model.ts');
  assert.equal(/@ts-nocheck|@ts-ignore|@ts-expect-error/.test(mainSource), false, 'workflow-read-model.ts must stay typed');
  assert.ok(mainSource.split(/\r?\n/).length < 1800, 'workflow-read-model.ts must remain a thin read-model entry');

  for (const moduleSpec of READ_MODEL_BOUNDARY_MODULES) {
    const source = await readRepoSource(moduleSpec.path);
    assert.equal(/@ts-nocheck|@ts-ignore|@ts-expect-error/.test(source), false, `${moduleSpec.path} must stay typed`);
    assert.equal(/:\s*never\s*\{|throw new Error\(/.test(source), false, `${moduleSpec.path} must not use throwing boundary stubs`);
    assert.equal(/from\s+['"]\.\/legacy-core\.js['"]/.test(source), false, `${moduleSpec.path} must not import legacy-core.js`);
    assert.equal(/from\s+['"]\.\/builder-internals\.js['"]/.test(source), false, `${moduleSpec.path} must not delegate migrated logic to builder-internals.js`);
    assert.ok(source.split(/\r?\n/).length > 20, `${moduleSpec.path} must contain real business logic`);

    for (const exportName of moduleSpec.exports) {
      assert.match(
        source,
        new RegExp(`export\\s+(?:async\\s+)?function\\s+${exportName}\\b|export\\s+const\\s+${exportName}\\b`),
        `${moduleSpec.path} must export ${exportName}`,
      );
    }
  }

  const legacyCoreSource = await readRepoSource('backend/domains/workflows/read-model/legacy-core.ts');
  const retainedLegacyRules = [
    'const STAGE_LABELS',
    'const FIXED_ARTIFACT_PATTERNS',
    'function mapStageStatus',
    'function inferSubagentRoleStage',
    'function buildChildSessions',
    'function buildPathReadModel',
    'function buildStageStatuses',
    'function buildWorkflowDisplayLines',
    'function buildWorkflowRoleSummary',
    'function buildWorkflowStatusSummary',
    'function buildStageInspections',
    'function collectPlanningTestFileEntries',
    'function buildPlanningArtifacts',
    'async function runWoGraph',
    'async function runWoStatus',
    'async function buildWorkflowDag',
    'function scanRunDirFixedArtifacts',
    'function collectDagTargetsByStage',
    'function mergeStageSessions',
    'function mergeStageArtifacts',
  ].filter((needle) => legacyCoreSource.includes(needle));
  assert.deepEqual(retainedLegacyRules, [], 'legacy-core.ts must not retain migrated read-model rules');

  const builderInternalsBoundarySource = await readRepoSource('backend/domains/workflows/read-model/builder-internals.ts');
  const retainedBuilderInternalsRules = [
    'function internalBuildPathReadModel',
    'function internalBuildChildSessions',
    'function internalCollectPlanningTestFileEntries',
    'function internalBuildPlanningArtifacts',
    'function internalBuildStageStatuses',
    'function internalBuildWorkflowDisplayLines',
    'function internalBuildWorkflowRoleSummary',
    'function internalBuildWorkflowStatusSummary',
    'function internalBuildStageInspections',
    'async function internalRunWoGraph',
    'async function internalRunWoStatus',
    'async function internalBuildWorkflowDag',
  ].filter((needle) => builderInternalsBoundarySource.includes(needle));
  assert.deepEqual(
    retainedBuilderInternalsRules,
    [],
    'builder-internals.ts must not retain migrated session artifact DAG or summary implementations',
  );
});
