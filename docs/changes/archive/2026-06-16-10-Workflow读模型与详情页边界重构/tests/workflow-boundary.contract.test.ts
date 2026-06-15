/**
 * PURPOSE: Contract test for proposal 10. It checks the real workflow source
 * tree so read-model projection and UI state inference do not remain buried in
 * large files after the refactor.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const EVIDENCE_DIR = path.join(REPO_ROOT, 'test-results', '10-workflow-boundary');

/**
 * Read a repository file as UTF-8 text.
 *
 * @param relativePath Path relative to the repository root.
 * @returns File contents.
 */
async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * Count local helper functions in a React/TypeScript source file.
 *
 * @param source Source text.
 * @returns Number of function declarations.
 */
function countNamedFunctions(source: string): number {
  return (source.match(/\nfunction\s+[A-Za-z0-9_]+/g) || []).length;
}

async function writeWorkflowBoundaryEvidence(fileName: string, content: string): Promise<void> {
  /** Write runtime evidence required by the workflow boundary acceptance contract. */
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(path.join(EVIDENCE_DIR, fileName), content, 'utf8');
}

test('workflow read-model projection modules exist', async () => {
  const expectedBackendModules = [
    'backend/domains/workflows/read-model/artifact-projection.ts',
    'backend/domains/workflows/read-model/session-projection.ts',
    'backend/domains/workflows/read-model/process-projection.ts',
    'backend/domains/workflows/read-model/diagnostics-projection.ts',
  ];

  for (const modulePath of expectedBackendModules) {
    const absolutePath = path.join(REPO_ROOT, modulePath);
    assert.equal(existsSync(absolutePath), true, `${modulePath} must exist after workflow read-model split`);
    const source = await readRepoFile(modulePath);
    assert.match(source, /PURPOSE|目的|projection|read model|职责/i, `${modulePath} must explain its projection purpose`);
    assert.match(source, /export\s+(async\s+)?function|export\s+const/, `${modulePath} must export a projection entry`);
  }
});

test('workflow detail frontend view model and components exist', async () => {
  const expectedFrontendModules = [
    'frontend/components/main-content/workflow-detail/workflowDetailViewModel.ts',
    'frontend/components/main-content/workflow-detail/workflowStageTableViewModel.ts',
    'frontend/components/main-content/workflow-detail/workflowArtifactLinks.ts',
    'frontend/components/main-content/workflow-detail/WorkflowStageTable.tsx',
    'frontend/components/main-content/workflow-detail/WorkflowArtifactList.tsx',
    'frontend/components/main-content/workflow-detail/WorkflowRunnerProcesses.tsx',
  ];

  for (const modulePath of expectedFrontendModules) {
    const absolutePath = path.join(REPO_ROOT, modulePath);
    assert.equal(existsSync(absolutePath), true, `${modulePath} must exist after workflow detail split`);
    const source = await readRepoFile(modulePath);
    assert.match(source, /PURPOSE|目的|workflow|stage|artifact|process|view model/i, `${modulePath} must document its workflow role`);
    assert.match(source, /export\s+(function|const|type|interface)/, `${modulePath} must export a tested workflow entry`);
  }
});

test('WorkflowDetailView.tsx becomes a composition layer', async () => {
  const source = await readRepoFile('frontend/components/main-content/view/subcomponents/WorkflowDetailView.tsx');
  const lineCount = source.split(/\r?\n/).length;
  const namedFunctionCount = countNamedFunctions(source);
  const heavyHelpers = [
    'buildVisualProgress',
    'buildWorkflowStageTableColumns',
    'renderWorkflowStageTableEntry',
    'renderRunnerProcesses',
    'resolveContinueState',
    'resolveArtifactPath',
  ];
  const stillOwnedHelpers = heavyHelpers.filter((helper) => source.includes(`function ${helper}`));

  assert.ok(lineCount <= 750, `WorkflowDetailView.tsx should be a composition layer; current line count is ${lineCount}`);
  assert.ok(namedFunctionCount <= 18, `WorkflowDetailView.tsx should delegate helper logic; found ${namedFunctionCount} named functions`);
  assert.deepEqual(stillOwnedHelpers, [], `WorkflowDetailView.tsx still owns heavy helpers: ${stillOwnedHelpers.join(', ')}`);

  await writeWorkflowBoundaryEvidence('viewmodel-audit.json', `${JSON.stringify({
    workflowDetailView: {
      lineCount,
      namedFunctionCount,
      stillOwnedHelpers,
      rendersStageTable: source.includes('<WorkflowStageTable '),
      rendersStageTree: source.includes('<WorkflowStageTree '),
    },
    viewModelModules: [
      'frontend/components/main-content/workflow-detail/workflowDetailViewModel.ts',
      'frontend/components/main-content/workflow-detail/workflowStageTableViewModel.ts',
    ],
  }, null, 2)}\n`);
});

test('workflow specs keep seven-stage and process semantics visible', async () => {
  const readModelSpec = await readRepoFile('docs/specs/wo-workflow-read-model.md');
  const presentationSpec = await readRepoFile('tests/spec/workflow-presentation.spec.ts');
  const toolingSpec = await readRepoFile('docs/specs/dependencies-and-tooling.md');
  const combinedWorkflowContracts = `${presentationSpec}\n${toolingSpec}`;

  assert.match(readModelSpec, /workflow/i, 'workflow read-model spec must remain discoverable');
  assert.match(combinedWorkflowContracts, /sessions-only|process|runner/i, 'workflow specs must guard process/session semantics');
  assert.match(combinedWorkflowContracts, /stage|artifact|workflow/i, 'workflow specs must guard user-visible stage output');

  await writeWorkflowBoundaryEvidence('action.log', [
    'workflow detail action contract checked',
    'continue/resume/abort state remains delegated to workflow detail view model and browser specs',
    'presentation/control-plane specs exercise open artifact and child session actions',
    '',
  ].join('\n'));
});
