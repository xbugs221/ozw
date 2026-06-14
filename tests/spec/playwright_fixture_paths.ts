import { describe, it } from 'node:test';
import { ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

describe('playwright-fixture-runtime-paths', () => {
  it('flow-runtime-paths 模块可导入且 resolveFlowRunsRoot 返回 XDG 路径', async () => {
    const {
      resolveFlowRunsRoot,
      resolveFlowRunStatePath,
    } = await import('../../backend/domains/workflows/flow-runtime-paths.ts');

    const projectPath = '/tmp/test-project';
    const fakedEnv = { XDG_STATE_HOME: '/tmp/xdg-state' };

    const runsRoot = resolveFlowRunsRoot(projectPath, fakedEnv);
    ok(runsRoot.startsWith('/tmp/xdg-state/oz/flow/'), 'runs root 应在 XDG_STATE_HOME/oz/flow 下');

    const statePath = resolveFlowRunStatePath(projectPath, 'run-42', fakedEnv);
    ok(
      statePath.endsWith('/runs/run-42/state.json'),
      `statePath 应以 /runs/run-42/state.json 结尾，实际为 ${statePath}`,
    );
  });

  it('resolveFlowRepoKey 对同一路径返回一致结果', async () => {
    const { resolveFlowRepoKey } = await import(
      '../../backend/domains/workflows/flow-runtime-paths.ts'
    );

    const key1 = resolveFlowRepoKey('/home/user/my-project');
    const key2 = resolveFlowRepoKey('/home/user/my-project');
    ok(key1 === key2);
  });

  it('playwright fixture 使用 resolveFlowRunStatePath 而非项目内 .wo 路径', () => {
    const content = readFileSync(
      resolve(REPO_ROOT, 'tests/e2e/helpers/playwright-fixture.ts'),
      'utf8',
    );

    ok(
      content.includes('resolveFlowRunStatePath'),
      'playwright-fixture.ts 应导入并使用 resolveFlowRunStatePath',
    );

    ok(
      !content.includes("'.wo/runs'"),
      'playwright-fixture.ts 不应硬编码 .wo/runs 路径',
    );
    ok(
      !content.includes("'.ozw/runs'"),
      'playwright-fixture.ts 不应硬编码 .ozw/runs 路径',
    );
  });

  it('workflow kickoff e2e 测试使用 XDG runsRoot', () => {
    const content = readFileSync(
      resolve(REPO_ROOT, 'tests/e2e/workflow-kickoff-with-openspec.spec.ts'),
      'utf8',
    );

    ok(
      content.includes('resolveFlowRunsRoot'),
      'workflow kickoff e2e 测试应导入 resolveFlowRunsRoot',
    );
    ok(
      !content.includes("'.wo', 'runs'"),
      'workflow kickoff e2e 测试不应拼接 .wo/runs 路径',
    );
  });
});
