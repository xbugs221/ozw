/**
 * PURPOSE: 契约测试，约束聊天工具卡配置和 provider payload parser 的类型边界。
 *
 * 业务意义：聊天 transcript 的工具卡、文件变更和 live 消息都依赖相同 provider payload，
 * 解析规则必须统一，否则同一条消息可能在不同路径显示不一致。
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const RESULT_DIR = path.join(REPO_ROOT, 'test-results/16-chat-tool-message-types');

/**
 * 读取仓库源码。
 */
async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * 写入聊天工具卡源码审计。
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
