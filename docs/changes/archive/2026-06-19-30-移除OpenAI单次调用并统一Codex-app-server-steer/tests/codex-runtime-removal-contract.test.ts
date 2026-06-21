// 文件目的：用真实源码审计锁定 Codex 单次 exec 和 OpenAI 直连依赖的移除合同。
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const EVIDENCE_PATH = path.join(
  REPO_ROOT,
  'test-results/30-remove-openai-single-runtime/source-audit.json',
);

type SourceAudit = {
  oldCodexRuntimeExists: boolean;
  agentRouteImportsOldCodexRuntime: boolean;
  agentRouteCallsQueryCodex: boolean;
  agentRouteUsesAppServerRuntime: boolean;
  productionCodexExecJsonMatches: string[];
  productionOpenAiSdkImportMatches: string[];
  productionOpenAiHttpMatches: string[];
  frontendTranscribeRouteMatches: string[];
  packageHasOpenAiDependency: boolean;
  activeSpecMentionsOldRuntimeAsRequired: string[];
};

const SOURCE_DIRS = ['backend', 'frontend', 'shared'];
const ACTIVE_DOC_DIRS = ['docs/specs', 'tests/specs'];

/**
 * 读取仓库文件；契约测试只审计真实项目源码，不构造 mock 数据。
 */
async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * 判断路径是否存在，用来确认旧运行时文件已经被真正删除。
 */
async function exists(relativePath: string): Promise<boolean> {
  try {
    await stat(path.join(REPO_ROOT, relativePath));
    return true;
  } catch {
    return false;
  }
}

/**
 * 递归收集源码文件，避免只检查单个文件导致旧 OpenAI 调用迁移到别处后漏检。
 */
async function listSourceFiles(relativeDir: string): Promise<string[]> {
  const root = path.join(REPO_ROOT, relativeDir);
  const result: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(REPO_ROOT, absolute);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'test-results') {
          continue;
        }
        await walk(absolute);
        continue;
      }
      if (entry.isFile() && /\.(ts|tsx|js|jsx|json|md)$/.test(entry.name)) {
        result.push(relative);
      }
    }
  }

  if (await exists(relativeDir)) {
    await walk(root);
  }
  return result.sort();
}

/**
 * 找出匹配某个正则的文件；返回文件名而不是只给布尔值，方便执行者定位残留。
 */
async function collectMatches(files: string[], pattern: RegExp): Promise<string[]> {
  const matches: string[] = [];
  for (const relativePath of files) {
    const source = await readRepoFile(relativePath);
    if (pattern.test(source)) {
      matches.push(relativePath);
    }
  }
  return matches;
}

/**
 * 生成源码审计快照，作为提案验收时可复核的 state snapshot。
 */
async function buildAudit(): Promise<SourceAudit> {
  const sourceFiles = (
    await Promise.all(SOURCE_DIRS.map((dir) => listSourceFiles(dir)))
  ).flat();
  const activeDocFiles = (
    await Promise.all(ACTIVE_DOC_DIRS.map((dir) => listSourceFiles(dir)))
  ).flat();

  const agentRoute = (await exists('backend/routes/agent.impl.ts'))
    ? await readRepoFile('backend/routes/agent.impl.ts')
    : '';
  const packageJson = JSON.parse(await readRepoFile('package.json')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return {
    oldCodexRuntimeExists: await exists('backend/openai-codex.ts'),
    agentRouteImportsOldCodexRuntime: /from\s+['"]\.\.\/openai-codex\.js['"]/.test(agentRoute),
    agentRouteCallsQueryCodex: /\bqueryCodex\s*\(/.test(agentRoute),
    agentRouteUsesAppServerRuntime:
      /codex-app-server|sendCodexAppServerMessage|createCodexAppServerRuntime|agent-session-runner/.test(agentRoute),
    productionCodexExecJsonMatches: await collectMatches(
      sourceFiles,
      /\[\s*['"]exec['"]\s*,\s*['"]--json['"]|codex\s+exec\s+--json/,
    ),
    productionOpenAiSdkImportMatches: await collectMatches(
      sourceFiles,
      /import\s*\(\s*['"]openai['"]\s*\)|from\s+['"]openai['"]|require\s*\(\s*['"]openai['"]\s*\)/,
    ),
    productionOpenAiHttpMatches: await collectMatches(
      sourceFiles,
      /api\.openai\.com\/v1\/audio\/transcriptions|OpenAI API key|Whisper API/i,
    ),
    frontendTranscribeRouteMatches: await collectMatches(
      sourceFiles.filter((file) => file.startsWith('frontend/')),
      /\/api\/transcribe-audio|transcribeAudio/i,
    ),
    packageHasOpenAiDependency: Boolean(
      packageJson.dependencies?.openai || packageJson.devDependencies?.openai,
    ),
    activeSpecMentionsOldRuntimeAsRequired: await collectMatches(
      activeDocFiles,
      /backend\/openai-codex\.ts|queryCodex|codex\s+exec\s+--json/,
    ),
  };
}

/**
 * 写出审计证据，失败时也能看到哪些文件仍然违反合同。
 */
async function writeEvidence(audit: SourceAudit): Promise<void> {
  await mkdir(path.dirname(EVIDENCE_PATH), { recursive: true });
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
}

test('生产 Codex 执行路径只允许接入 app-server runtime', async () => {
  const audit = await buildAudit();
  await writeEvidence(audit);

  assert.equal(
    audit.oldCodexRuntimeExists,
    false,
    'backend/openai-codex.ts 必须删除，不能继续保留单次 Codex exec 入口',
  );
  assert.equal(
    audit.agentRouteImportsOldCodexRuntime,
    false,
    '/api/agent route 不得 import ../openai-codex.js',
  );
  assert.equal(
    audit.agentRouteCallsQueryCodex,
    false,
    '/api/agent route 不得调用 queryCodex 单次执行入口',
  );
  assert.equal(
    audit.agentRouteUsesAppServerRuntime,
    true,
    '/api/agent route 必须接入 Codex app-server runtime 或专用 app-server runner',
  );
  assert.deepEqual(
    audit.productionCodexExecJsonMatches,
    [],
    `生产源码不得构造 codex exec --json 单次运行路径，残留文件：${audit.productionCodexExecJsonMatches.join(', ')}`,
  );
});

test('OpenAI 语音转写和 GPT 增强依赖被彻底移除', async () => {
  const audit = await buildAudit();
  await writeEvidence(audit);

  assert.deepEqual(
    audit.productionOpenAiSdkImportMatches,
    [],
    `生产源码不得静态或动态导入 openai npm SDK，残留文件：${audit.productionOpenAiSdkImportMatches.join(', ')}`,
  );
  assert.deepEqual(
    audit.productionOpenAiHttpMatches,
    [],
    `生产源码不得再调用 OpenAI Whisper/GPT HTTP API，残留文件：${audit.productionOpenAiHttpMatches.join(', ')}`,
  );
  assert.deepEqual(
    audit.frontendTranscribeRouteMatches,
    [],
    `前端不得继续调用 /api/transcribe-audio，残留文件：${audit.frontendTranscribeRouteMatches.join(', ')}`,
  );
  assert.equal(audit.packageHasOpenAiDependency, false, 'package.json 不得声明 openai 依赖');
});

test('活跃规格不再把旧 OpenAI 单次路径当成当前要求', async () => {
  const audit = await buildAudit();
  await writeEvidence(audit);

  assert.deepEqual(
    audit.activeSpecMentionsOldRuntimeAsRequired,
    [],
    `活跃 specs/tests 不得继续要求 backend/openai-codex.ts、queryCodex 或 codex exec --json：${audit.activeSpecMentionsOldRuntimeAsRequired.join(', ')}`,
  );
});
