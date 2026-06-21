// 文件目的：用源码契约锁定核心架构重构目标，避免 shared 边界、巨型模块和类型边界回退。
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const EVIDENCE_PATH = path.join(REPO_ROOT, 'test-results/29-core-boundary/source-audit.json');

type FileAudit = {
  exists: boolean;
  lines: number | null;
  hasTsNoCheck: boolean | null;
};

type CoreAudit = {
  files: Record<string, FileAudit>;
  providerRuntimeImportsFrontendChat: string[];
  routeDepsAnyMatches: string[];
  toolRegistryPublicAnyMatches: string[];
  ozFlowValidationCommands: string[];
  ozFlowValidationHasAcceptanceBoundary: boolean;
  ozFlowValidationHasSystemHealthGate: boolean;
};

async function readRepoFile(relativePath: string): Promise<string> {
  /** Read a repository file as UTF-8 so contract checks stay independent from app imports. */
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

async function pathExists(relativePath: string): Promise<boolean> {
  /** Check whether a required split module exists without throwing on the first missing file. */
  try {
    await stat(path.join(REPO_ROOT, relativePath));
    return true;
  } catch {
    return false;
  }
}

function countLines(source: string): number {
  /** Count physical source lines to keep orchestration modules under an explicit maintenance budget. */
  if (source.length === 0) {
    return 0;
  }
  return source.split('\n').length;
}

async function auditFile(relativePath: string): Promise<FileAudit> {
  /** Collect basic source facts used by both evidence output and assertions. */
  if (!(await pathExists(relativePath))) {
    return { exists: false, lines: null, hasTsNoCheck: null };
  }
  const source = await readRepoFile(relativePath);
  return {
    exists: true,
    lines: countLines(source),
    hasTsNoCheck: source.includes('@ts-nocheck'),
  };
}

async function listFiles(relativeDir: string): Promise<string[]> {
  /** List direct child files for route-deps checks while tolerating directories that do not exist yet. */
  try {
    const entries = await readdir(path.join(REPO_ROOT, relativeDir), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map((entry) => path.join(relativeDir, entry.name));
  } catch {
    return [];
  }
}

async function listFilesRecursive(relativeDir: string): Promise<string[]> {
  /** Recursively list TypeScript sources so boundary checks cover real runtime files, not only wrappers. */
  try {
    const root = path.join(REPO_ROOT, relativeDir);
    const entries = await readdir(root, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const child = path.join(relativeDir, entry.name);
        if (entry.isDirectory()) {
          return listFilesRecursive(child);
        }
        return entry.isFile() && /\.(ts|tsx)$/.test(entry.name) ? [child] : [];
      }),
    );
    return files.flat();
  } catch {
    return [];
  }
}

async function collectAudit(): Promise<CoreAudit> {
  /** Build a source snapshot before assertions so failures leave reviewable evidence. */
  const importantFiles = [
    'oz-flow.yaml',
    'shared/provider-runtime-transcript.ts',
    'frontend/components/chat/utils/nativeRuntimeTranscript.ts',
    'backend/domains/provider-runtime/active-turn-store.ts',
    'backend/domains/provider-runtime/live-transcript-store.ts',
    'frontend/components/chat/session/useChatSessionStateRuntime.ts',
    'frontend/components/chat/session/sessionRuntimeController.ts',
    'frontend/components/chat/session/useChatSessionStateRuntime.impl.ts',
    'frontend/components/chat/hooks/useChatRealtimeHandlersRuntime.ts',
    'frontend/components/chat/hooks/useChatRealtimeHandlersRuntime.impl.ts',
    'frontend/components/chat/realtime/realtimeRuntimeController.ts',
    'frontend/components/chat/composer/useChatComposerStateRuntime.ts',
    'frontend/components/main-content/project-overview/ProjectOverviewPanelRuntime.tsx',
    'frontend/components/main-content/project-overview/ProjectOverviewPanelRuntime.impl.tsx',
    'frontend/components/main-content/view/subcomponents/ProjectOverviewPanelRuntime.tsx',
    'backend/routes/agent.ts',
    'backend/routes/agent.impl.ts',
    'backend/domains/agent/agent-route-runtime.ts',
    'backend/server/server-runtime.ts',
    'frontend/components/chat/toolConfigRegistry.ts',
    'frontend/components/chat/tool-config/toolConfigRegistryRuntime.ts',
    'frontend/components/chat/tools/configs/toolConfigRegistry.ts',
  ];

  const requiredSplitModules = [
    'frontend/components/chat/session/sessionHistoryLoader.ts',
    'frontend/components/chat/session/sessionBulkMessageLoader.ts',
    'frontend/components/chat/session/sessionHydrationController.ts',
    'frontend/components/chat/session/sessionScrollController.ts',
    'frontend/components/chat/realtime/realtimeSessionLifecycle.ts',
    'frontend/components/chat/realtime/realtimeProviderEventController.ts',
    'frontend/components/chat/composer/composerAttachmentController.ts',
    'frontend/components/chat/composer/composerDispatchController.ts',
    'frontend/components/main-content/project-overview/projectOverviewActionController.ts',
    'frontend/components/main-content/project-overview/ProjectOverviewManualSessions.tsx',
    'frontend/components/main-content/project-overview/ProjectOverviewWorkflowSection.tsx',
    'frontend/components/main-content/project-overview/projectOverviewSelectionState.ts',
    'backend/domains/agent/agent-auth.ts',
    'backend/domains/agent/agent-project-resolver.ts',
    'backend/domains/agent/github-operations.ts',
    'backend/domains/agent/agent-session-runner.ts',
    'backend/domains/agent/agent-response-writer.ts',
  ];

  const files: Record<string, FileAudit> = {};
  for (const relativePath of [...importantFiles, ...requiredSplitModules]) {
    files[relativePath] = await auditFile(relativePath);
  }

  const providerRuntimeFiles = await listFilesRecursive('backend/domains/provider-runtime');
  const providerRuntimeImportsFrontendChat: string[] = [];
  for (const relativePath of providerRuntimeFiles) {
    if (!(await pathExists(relativePath))) {
      continue;
    }
    const source = await readRepoFile(relativePath);
    if (/frontend\/components\/chat|from ['"].*components\/chat/.test(source)) {
      providerRuntimeImportsFrontendChat.push(relativePath);
    }
  }

  const routeDepsAnyMatches: string[] = [];
  for (const relativePath of await listFiles('backend/server/http')) {
    const source = await readRepoFile(relativePath);
    if (/\bdeps\s*:\s*any\b/.test(source)) {
      routeDepsAnyMatches.push(relativePath);
    }
    const routeDepsInterfaces = [...source.matchAll(/export interface \w*RouteDeps \{[\s\S]*?\n\}/g)];
    for (const match of routeDepsInterfaces) {
      if (/^\s+\w+\??:\s*any\b/m.test(match[0])) {
        routeDepsAnyMatches.push(relativePath);
        break;
      }
    }
  }

  const toolRegistryPublicAnyMatches: string[] = [];
  if (await pathExists('frontend/components/chat/tool-config/toolConfigRegistryRuntime.ts')) {
    const source = await readRepoFile('frontend/components/chat/tool-config/toolConfigRegistryRuntime.ts');
    const publicApi = [
      source.match(/export interface ToolDisplayConfig \{[\s\S]*?\n\}/)?.[0] ?? '',
      ...[...source.matchAll(/^export function .*$/gm)].map((match) => match[0]),
    ].join('\n');
    const matches = publicApi.match(/\b(?:payload|input|args|details|result|toolResult)[A-Za-z0-9_]*\??\s*:\s*any\b/g) ?? [];
    toolRegistryPublicAnyMatches.push(...matches);
  }

  const ozFlow = (await pathExists('oz-flow.yaml')) ? await readRepoFile('oz-flow.yaml') : '';
  const validationBlock = ozFlow.match(/validation:\n[\s\S]*?(?=\nprompts:|\nstages:|\n[a-zA-Z_]+:|$)/)?.[0] ?? '';
  const ozFlowValidationCommands = [...validationBlock.matchAll(/^\s*-\s+(.+)$/gm)].map((match) =>
    match[1].trim(),
  );
  const joinedValidationCommands = ozFlowValidationCommands.join('\n');
  const ozFlowValidationHasAcceptanceBoundary =
    joinedValidationCommands.includes('oz validate 29-收敛核心架构债和性能边界 --json') &&
    joinedValidationCommands.includes(
      'docs/changes/29-收敛核心架构债和性能边界/tests/core-boundary-contract.test.ts',
    ) &&
    joinedValidationCommands.includes(
      'docs/changes/29-收敛核心架构债和性能边界/tests/performance-boundary-contract.test.ts',
    ) &&
    joinedValidationCommands.includes('tests/e2e/project-overview-real-performance.spec.ts');
  const ozFlowValidationHasSystemHealthGate =
    joinedValidationCommands.includes('pnpm run typecheck') &&
    joinedValidationCommands.includes('pnpm run build');

  return {
    files,
    providerRuntimeImportsFrontendChat,
    routeDepsAnyMatches,
    toolRegistryPublicAnyMatches,
    ozFlowValidationCommands,
    ozFlowValidationHasAcceptanceBoundary,
    ozFlowValidationHasSystemHealthGate,
  };
}

async function writeEvidence(audit: CoreAudit): Promise<void> {
  /** Persist the source audit for proposal acceptance review. */
  await mkdir(path.dirname(EVIDENCE_PATH), { recursive: true });
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
}

test('provider transcript logic lives in shared code used by frontend and backend', async () => {
  const audit = await collectAudit();
  await writeEvidence(audit);

  assert.equal(audit.files['shared/provider-runtime-transcript.ts'].exists, true);
  assert.deepEqual(audit.providerRuntimeImportsFrontendChat, []);

  const frontendAdapter = await readRepoFile('frontend/components/chat/utils/nativeRuntimeTranscript.ts');
  const activeTurnStore = await readRepoFile('backend/domains/provider-runtime/active-turn-store.ts');
  const liveTranscriptStore = await readRepoFile('backend/domains/provider-runtime/live-transcript-store.ts');

  assert.match(frontendAdapter, /shared\/provider-runtime-transcript/);
  assert.match(activeTurnStore, /shared\/provider-runtime-transcript/);
  assert.match(liveTranscriptStore, /shared\/provider-runtime-transcript/);
  assert.equal(audit.files['backend/domains/provider-runtime/active-turn-store.ts'].hasTsNoCheck, false);
  assert.equal(audit.files['backend/domains/provider-runtime/live-transcript-store.ts'].hasTsNoCheck, false);
});

test('chat and project overview runtime files are reduced to orchestration layers', async () => {
  const audit = await collectAudit();
  await writeEvidence(audit);

  const lineBudgets: Record<string, number> = {
    'frontend/components/chat/session/useChatSessionStateRuntime.ts': 700,
    'frontend/components/chat/session/useChatSessionStateRuntime.impl.ts': 80,
    'frontend/components/chat/hooks/useChatRealtimeHandlersRuntime.ts': 700,
    'frontend/components/chat/hooks/useChatRealtimeHandlersRuntime.impl.ts': 80,
    'frontend/components/chat/composer/useChatComposerStateRuntime.ts': 700,
    'frontend/components/main-content/project-overview/ProjectOverviewPanelRuntime.tsx': 700,
    'frontend/components/main-content/view/subcomponents/ProjectOverviewPanelRuntime.tsx': 80,
  };

  for (const [relativePath, maxLines] of Object.entries(lineBudgets)) {
    assert.equal(audit.files[relativePath].exists, true, `${relativePath} must exist`);
    assert.ok(
      (audit.files[relativePath].lines ?? Number.POSITIVE_INFINITY) <= maxLines,
      `${relativePath} must stay under ${maxLines} lines`,
    );
  }

  const requiredSplitModules = [
    'frontend/components/chat/session/sessionHistoryLoader.ts',
    'frontend/components/chat/session/sessionBulkMessageLoader.ts',
    'frontend/components/chat/session/sessionHydrationController.ts',
    'frontend/components/chat/session/sessionScrollController.ts',
    'frontend/components/chat/realtime/realtimeSessionLifecycle.ts',
    'frontend/components/chat/realtime/realtimeProviderEventController.ts',
    'frontend/components/chat/composer/composerAttachmentController.ts',
    'frontend/components/chat/composer/composerDispatchController.ts',
    'frontend/components/main-content/project-overview/projectOverviewActionController.ts',
    'frontend/components/main-content/project-overview/ProjectOverviewManualSessions.tsx',
    'frontend/components/main-content/project-overview/ProjectOverviewWorkflowSection.tsx',
    'frontend/components/main-content/project-overview/projectOverviewSelectionState.ts',
  ];

  for (const relativePath of requiredSplitModules) {
    assert.equal(audit.files[relativePath].exists, true, `${relativePath} must be created`);
  }
});

test('backend agent route and server runtime have explicit security and lifecycle boundaries', async () => {
  const audit = await collectAudit();
  await writeEvidence(audit);

  assert.equal(audit.files['backend/routes/agent.ts'].exists, true);
  assert.ok((audit.files['backend/routes/agent.ts'].lines ?? Number.POSITIVE_INFINITY) <= 500);
  assert.equal(audit.files['backend/routes/agent.ts'].hasTsNoCheck, false);
  assert.equal(audit.files['backend/routes/agent.impl.ts'].exists, true);
  assert.ok((audit.files['backend/routes/agent.impl.ts'].lines ?? Number.POSITIVE_INFINITY) <= 80);
  assert.equal(audit.files['backend/routes/agent.impl.ts'].hasTsNoCheck, false);
  assert.equal(audit.files['backend/domains/agent/agent-route-runtime.ts'].exists, true);

  for (const relativePath of [
    'backend/domains/agent/agent-auth.ts',
    'backend/domains/agent/agent-project-resolver.ts',
    'backend/domains/agent/github-operations.ts',
    'backend/domains/agent/agent-session-runner.ts',
    'backend/domains/agent/agent-response-writer.ts',
  ]) {
    assert.equal(audit.files[relativePath].exists, true, `${relativePath} must be created`);
  }

  const githubOperations = await readRepoFile('backend/domains/agent/github-operations.ts');
  assert.doesNotMatch(githubOperations, /https:\/\/\$\{[^}]*token|githubToken[^;\n]*(?:spawn|execFile|args)/);
  assert.match(githubOperations, /credential|GIT_ASKPASS|GIT_TERMINAL_PROMPT|Authorization/i);

  assert.equal(audit.files['backend/server/server-runtime.ts'].exists, true);
  assert.ok((audit.files['backend/server/server-runtime.ts'].lines ?? Number.POSITIVE_INFINITY) <= 700);
  assert.deepEqual(audit.routeDepsAnyMatches, []);
});

test('tool config registry is split by tool family and avoids public any payload contracts', async () => {
  const audit = await collectAudit();
  await writeEvidence(audit);

  assert.equal(audit.files['frontend/components/chat/toolConfigRegistry.ts'].exists, true);
  assert.ok(
    (audit.files['frontend/components/chat/toolConfigRegistry.ts'].lines ?? Number.POSITIVE_INFINITY) <= 650,
  );
  assert.equal(audit.files['frontend/components/chat/tools/configs/toolConfigRegistry.ts'].exists, true);
  assert.ok(
    (audit.files['frontend/components/chat/tools/configs/toolConfigRegistry.ts'].lines ?? Number.POSITIVE_INFINITY) <=
      80,
  );
  assert.equal(audit.files['frontend/components/chat/tool-config/toolConfigRegistryRuntime.ts'].exists, true);

  const familyModules = [
    'frontend/components/chat/tool-config/readTools.ts',
    'frontend/components/chat/tool-config/editTools.ts',
    'frontend/components/chat/tool-config/execTools.ts',
    'frontend/components/chat/tool-config/providerTools.ts',
    'frontend/components/chat/tool-config/workflowTools.ts',
  ];
  for (const relativePath of familyModules) {
    assert.equal(await pathExists(relativePath), true, `${relativePath} must be created`);
  }

  assert.deepEqual(audit.toolRegistryPublicAnyMatches, []);
});

test('oz flow validation locks acceptance boundaries and system health checks', async () => {
  const audit = await collectAudit();
  await writeEvidence(audit);

  assert.equal(audit.files['oz-flow.yaml'].exists, true);
  assert.equal(audit.ozFlowValidationHasAcceptanceBoundary, true);
  assert.equal(audit.ozFlowValidationHasSystemHealthGate, true);
});
