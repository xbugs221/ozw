/**
 * 文件目的：规格级保护长会话加载、项目刷新和 UI 性能边界。
 * Sources: 2026-06-18-29-收敛核心架构债和性能边界
 */
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();

/**
 * 读取源码文本，静态验证性能合同。
 */
async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * 检查性能模块是否存在。
 */
async function pathExists(relativePath: string): Promise<boolean> {
  try {
    await stat(path.join(REPO_ROOT, relativePath));
    return true;
  } catch {
    return false;
  }
}

/**
 * 从源码中截取函数附近片段，避免用脆弱 AST 依赖。
 */
function extractFunctionBody(source: string, functionName: string): string {
  const start = source.indexOf(functionName);
  return start < 0 ? '' : source.slice(start, Math.min(source.length, start + 5000));
}

/**
 * 检测虚拟列表窗口上限常量。
 */
function detectWindowLimit(source: string): number | null {
  const match = source.match(
    /(?:MAX_RENDERED_TRANSCRIPT_MESSAGES|MAX_[A-Z_]*WINDOW[A-Z_]*|WINDOW_[A-Z_]*LIMIT|windowLimit)\s*[:=]\s*(\d+)/,
  );
  return match ? Number(match[1]) : null;
}

test('full message loading is chunked and has an explicit page budget', async () => {
  /** 加载全部历史只能扩大数据集，不能用无限 limit 一次拉取全部。 */
  const sessionRuntime = await readRepoFile('frontend/components/chat/session/useChatSessionStateRuntime.ts');
  const loadAllMessagesBlock = extractFunctionBody(sessionRuntime, 'loadAllMessages');
  const bulkLoaderExists = await pathExists('frontend/components/chat/session/sessionBulkMessageLoader.ts');
  const bulkLoader = bulkLoaderExists
    ? await readRepoFile('frontend/components/chat/session/sessionBulkMessageLoader.ts')
    : '';

  assert.notEqual(loadAllMessagesBlock.length, 0);
  assert.equal(bulkLoaderExists, true);
  assert.match(bulkLoader, /SESSION_BULK_MESSAGE_PAGE_SIZE|bulkMessagePageSize|pageSize/);
  assert.equal(/sessionMessages[\s\S]{0,300}\bnull\b/.test(loadAllMessagesBlock), false);
});

test('project refresh comparison uses stable signatures instead of deep JSON serialization', async () => {
  /** 项目刷新只比较业务可见签名，不深序列化大型 session/workflow 数组。 */
  const projectRefreshReducer = await readRepoFile('frontend/hooks/projects/projectRefreshReducer.ts');
  const projectsHaveChangesBlock = extractFunctionBody(projectRefreshReducer, 'projectsHaveChanges');

  assert.match(projectRefreshReducer, /buildProjectRefreshSignature|createProjectRefreshSignature/);
  assert.equal(/const\s+serialize\s*=\s*\([^)]*\)\s*=>\s*JSON\.stringify/.test(projectRefreshReducer), false);
  assert.equal(/\b(sessions|workflows|codexSessions|piSessions)\b/.test(projectsHaveChangesBlock), false);
});

test('file mention and message virtualization performance guards stay in place', async () => {
  /** 文件提及和消息列表保护不能因性能重构回退。 */
  const fileMentions = await readRepoFile('frontend/components/chat/hooks/useFileMentions.tsx');
  const chatMessagesPane = await readRepoFile('frontend/components/chat/view/subcomponents/ChatMessagesPane.tsx');
  const windowLimit = detectWindowLimit(chatMessagesPane);

  assert.match(fileMentions, /showFileDropdown|isDropdownOpen|enabled/);
  assert.match(fileMentions, /depth\s*:\s*2|depth\s*<=\s*2/);
  assert.match(fileMentions, /showHidden\s*:\s*false/);
  assert.match(chatMessagesPane, /virtual|visibleRange|overscan|useVirtual/);
  assert.ok(windowLimit === null || windowLimit <= 150);
});
