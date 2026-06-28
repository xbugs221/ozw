/**
 * 文件目的：规格级保护长会话加载、项目刷新和 UI 性能边界。
 * Sources: 2026-06-18-29-收敛核心架构债和性能边界, 2026-06-29-35-提前预取更早会话历史
 */
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  buildVisibleMessageWindow,
  getVisibleWindowMessageKey,
} from '../../frontend/components/chat/session/chatSessionLifecycleController.ts';

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

test('history prefetch starts before the hard top threshold', async () => {
  /** 长会话向上翻阅时必须在到顶前按分页预加载更早历史。 */
  const sessionRuntime = await readRepoFile('frontend/components/chat/session/sessionRuntimeController.ts');
  const prefetchZoneBlock = extractFunctionBody(sessionRuntime, 'function isInsideHistoryPrefetchZone');
  const handleScrollBlock = extractFunctionBody(sessionRuntime, 'handleScroll');

  assert.match(sessionRuntime, /isInsideHistoryPrefetchZone/);
  assert.match(sessionRuntime, /MIN_HISTORY_PREFETCH_DISTANCE_PX\s*=\s*240/);
  assert.match(prefetchZoneBlock, /Math\.max\(MIN_HISTORY_PREFETCH_DISTANCE_PX,\s*Math\.floor\(container\.clientHeight\)\)/);
  assert.match(prefetchZoneBlock, /container\.scrollTop\s*<=\s*prefetchDistance/);
  assert.match(handleScrollBlock, /if\s*\(\s*hardBottom\s*\)/);
  assert.match(handleScrollBlock, /isInsideHistoryPrefetchZone\(container\)/);
  assert.equal(/scrollTop\s*[<]=?\s*100/.test(handleScrollBlock), false);
  assert.equal(/container\.scrollTop\s*===\s*0/.test(handleScrollBlock), false);
  assert.equal(/container\.scrollTop\s*<=\s*0/.test(handleScrollBlock), false);
  assert.match(handleScrollBlock, /loadOlderMessages\(container\)/);
});

test('history prefetch preserves paging locks and read anchor restoration', async () => {
  /** 预加载旧历史只能拉取更早一页，且插入后必须恢复用户正在阅读的位置。 */
  const sessionRuntime = await readRepoFile('frontend/components/chat/session/sessionRuntimeController.ts');
  const loadOlderMessagesBlock = extractFunctionBody(sessionRuntime, 'loadOlderMessages');
  const restoreLayoutBlock = extractFunctionBody(
    sessionRuntime,
    'if (!pendingScrollRestoreRef.current',
  );

  assert.match(loadOlderMessagesBlock, /isLoadingMoreRef\.current\s*\|\|\s*isLoadingMoreMessages/);
  assert.match(loadOlderMessagesBlock, /allMessagesLoadedRef\.current/);
  assert.match(loadOlderMessagesBlock, /!hasMoreMessages/);
  assert.match(loadOlderMessagesBlock, /isLoadingMoreRef\.current\s*=\s*true/);
  assert.match(loadOlderMessagesBlock, /finally\s*\{[\s\S]*isLoadingMoreRef\.current\s*=\s*false/);
  assert.match(loadOlderMessagesBlock, /loadSessionMessages\([\s\S]*true/);
  assert.match(loadOlderMessagesBlock, /setHasMoreMessages\(totalMessagesRef\.current > messagesOffsetRef\.current\)/);
  assert.equal(/loadAllMessages/.test(loadOlderMessagesBlock), false);
  assert.match(loadOlderMessagesBlock, /captureSessionScrollSnapshot\(container\)/);
  assert.match(loadOlderMessagesBlock, /pendingScrollRestoreRef\.current\s*=\s*scrollSnapshot/);
  assert.match(loadOlderMessagesBlock, /frozenTailMessageKeyRef\.current/);
  assert.match(loadOlderMessagesBlock, /setVisibleMessageCount\(\(previousCount\) => previousCount \+ uniqueMoreMessages\.length\)/);
  assert.match(restoreLayoutBlock, /restoreSessionScrollTop\(\{ height, top \}, container\.scrollHeight\)/);
});

test('frozen transcript tail survives prepending fallback-key messages', () => {
  /** 部分转换消息没有 messageKey，冻结尾部不能依赖数组位置。 */
  const tailMessage = { type: 'assistant', timestamp: '2026-04-19T00:00:02.000Z', content: 'tail before append' };
  const frozenTailKey = getVisibleWindowMessageKey(tailMessage, 1);
  const messages = [
    { type: 'assistant', timestamp: '2026-04-19T00:00:00.000Z', content: 'older prepended' },
    { type: 'assistant', timestamp: '2026-04-19T00:00:01.000Z', content: 'visible before tail' },
    tailMessage,
    { type: 'assistant', timestamp: '2026-04-19T00:00:03.000Z', content: 'new appended tail' },
  ];

  assert.deepEqual(buildVisibleMessageWindow(messages, 3, frozenTailKey), messages.slice(0, 3));
});
