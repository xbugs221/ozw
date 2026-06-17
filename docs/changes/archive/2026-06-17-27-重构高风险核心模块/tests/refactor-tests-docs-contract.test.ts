/**
 * 文件目的：要求高风险模块重构同步补默认测试和 durable docs。
 * 业务风险：只拆源码不补测试和文档，会让后续维护者无法判断哪些入口保护用户可见行为。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const REPO_ROOT = process.cwd();

const REQUIRED_TESTS = [
  {
    path: 'tests/unit/project-overview-view-model.test.ts',
    imports: ['projectOverviewViewModel'],
  },
  {
    path: 'tests/unit/chat-runtime-controllers.test.ts',
    imports: ['chatSessionLifecycleController', 'composerSubmitRuntime', 'chatRealtimeEventRouter', 'streamingMessageController'],
  },
  {
    path: 'tests/backend/server-boundary-refactor.test.ts',
    imports: ['chat-client-scope-store', 'chat-command-router', 'file-route-helpers'],
  },
  {
    path: 'tests/specs/high-risk-module-refactor.spec.ts',
    imports: ['ProjectOverviewPanel', 'useChatSessionStateImpl', 'server-bootstrap'],
  },
] as const;

async function readRepoFile(relativePath: string): Promise<string> {
  /**
   * 读取测试或文档文件，确认重构交付不是只有源码移动。
   */
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('P1 high-risk refactor adds default tests and durable documentation', async () => {
  for (const requiredTest of REQUIRED_TESTS) {
    assert.equal(existsSync(path.join(REPO_ROOT, requiredTest.path)), true, `${requiredTest.path} 必须存在`);
    const source = await readRepoFile(requiredTest.path);
    assert.match(source, /业务|risk|用户|workflow|session|server|file/i, `${requiredTest.path} 必须说明业务风险`);
    for (const importedName of requiredTest.imports) {
      assert.match(source, new RegExp(importedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${requiredTest.path} 必须覆盖 ${importedName}`);
    }
  }

  const specPath = 'docs/specs/high-risk-module-refactor.md';
  assert.equal(existsSync(path.join(REPO_ROOT, specPath)), true, `${specPath} 必须存在`);
  const spec = await readRepoFile(specPath);
  for (const phrase of [
    'ProjectOverviewPanel',
    'useChatSessionStateImpl',
    'useChatComposerStateImpl',
    'useChatRealtimeHandlersImpl',
    'server-bootstrap',
    'chat-command-dispatcher',
    'file-routes',
    'pnpm run test:vitest',
    'pnpm run test:server',
  ]) {
    assert.match(spec, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${specPath} 必须说明 ${phrase}`);
  }
});
