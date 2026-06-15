/**
 * Sources: 2026-06-16-16-聊天工具卡与消息转换类型收敛
 *
 * PURPOSE: 约束聊天工具卡配置和 provider payload parser 的类型边界，
 * 避免 live、persisted 和 merge 路径对同一 provider payload 解析漂移。
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const RESULT_DIR = path.join(REPO_ROOT, 'test-results/chat-tool-message-types');

/**
 * 读取仓库源码，确保规格测试审计真实生产文件。
 */
async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * 写入聊天工具卡源码审计，作为本地可复核 evidence。
 */
async function writeAudit(snapshot: unknown): Promise<void> {
  await mkdir(RESULT_DIR, { recursive: true });
  await writeFile(path.join(RESULT_DIR, 'source-audit.json'), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

test('provider payload parser 成为消息转换和 merge 的单一来源', async () => {
  const parserPath = 'frontend/components/chat/utils/providerPayloadParsers.ts';
  const transforms = await readRepoFile('frontend/components/chat/utils/messageTransforms.ts');
  const merge = await readRepoFile('frontend/components/chat/utils/sessionMessageMerge.ts');
  const snapshot = {
    parserExists: existsSync(path.join(REPO_ROOT, parserPath)),
    transformsImportsParser: transforms.includes('./providerPayloadParsers'),
    mergeImportsParser: merge.includes('./providerPayloadParsers'),
    privateParserCopies: [
      /function resolveProviderFileUpdatePayload/.test(transforms),
      /function resolveProviderFileUpdatePayload/.test(merge),
      /function resolveCodexToolUpdateJson/.test(transforms),
    ].filter(Boolean).length,
  };

  await writeAudit(snapshot);

  assert.equal(snapshot.parserExists, true, '必须存在 providerPayloadParsers.ts');
  assert.equal(snapshot.transformsImportsParser, true, 'messageTransforms.ts 必须复用统一 parser');
  assert.equal(snapshot.mergeImportsParser, true, 'sessionMessageMerge.ts 必须复用统一 parser');
  assert.equal(snapshot.privateParserCopies, 0, '不得在 messageTransforms/sessionMessageMerge 中保留重复私有 parser');
});

test('工具卡配置按业务 family 拆分', async () => {
  const toolConfigs = await readRepoFile('frontend/components/chat/tools/configs/toolConfigs.ts');
  const familyModules = [
    'frontend/components/chat/tools/configs/shellToolConfigs.ts',
    'frontend/components/chat/tools/configs/fileToolConfigs.ts',
    'frontend/components/chat/tools/configs/codexToolConfigs.ts',
    'frontend/components/chat/tools/configs/subagentToolConfigs.ts',
    'frontend/components/chat/tools/configs/toolConfigRegistry.ts',
  ];

  assert.ok(toolConfigs.split(/\r?\n/).length <= 650, 'toolConfigs.ts 应退化为注册表或兼容导出，不再承载巨型配置');
  assert.ok(!toolConfigs.includes('TODO TOOLS'), '工具配置中不得保留 TODO TOOLS 残留');

  for (const modulePath of familyModules) {
    assert.equal(existsSync(path.join(REPO_ROOT, modulePath)), true, `${modulePath} 必须存在`);
    const source = await readRepoFile(modulePath);
    assert.match(source, /PURPOSE|目的|tool|工具/i, `${modulePath} 必须说明工具配置业务目的`);
    assert.match(source, /export\s+(const|function)/, `${modulePath} 必须导出工具配置入口`);
  }
});
