/**
 * PURPOSE: Verify long chat history rendering keeps loaded data separate from
 * the bounded DOM window and defers heavy collapsed tool content.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTranscriptVirtualLayout,
  calculateTranscriptVirtualRange,
} from '../../../frontend/components/chat/utils/transcriptVirtualization.ts';

const repoRoot = process.cwd();

/**
 * Read a repository source file as UTF-8 text for architecture contract checks.
 */
function readSource(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

test('chat transcript renders a bounded virtual DOM window while retaining loaded messages', () => {
  /** Scenario: 1000+ 混合消息滚动到中段时只挂载连续小窗口 */
  const messageKeys = Array.from({ length: 1200 }, (_, index) => `mixed-message-${index}`);
  const measuredHeights = new Map(
    messageKeys.map((key, index) => {
      const height = index % 5 === 0 ? 260 : index % 7 === 0 ? 180 : 72;
      return [key, height] as const;
    }),
  );
  const layout = buildTranscriptVirtualLayout(messageKeys, measuredHeights, 96);
  const targetOffset = layout.offsets[650];
  const range = calculateTranscriptVirtualRange({
    messageCount: messageKeys.length,
    offsets: layout.offsets,
    totalHeight: layout.totalHeight,
    scrollTop: targetOffset,
    viewportHeight: 720,
    estimatedMessageHeight: 96,
    maxRenderedMessages: 150,
    overscan: 32,
  });

  assert.equal(messageKeys.length, 1200);
  assert.ok(range.start < 650);
  assert.ok(range.end > 650);
  assert.ok(range.end - range.start <= 150);
  assert.ok(range.paddingTop > 0);
  assert.ok(range.paddingBottom > 0);
});

test('chat transcript implementation uses measured continuous virtual ranges', () => {
  /** Scenario: 渲染层使用滚动范围，不回退到只取最新或最旧 150 条 */
  const source = readSource('frontend/components/chat/view/subcomponents/ChatMessagesPane.tsx');

  assert.match(source, /data-virtualized="true"/);
  assert.match(source, /data-render-window-size=\{MAX_RENDERED_TRANSCRIPT_MESSAGES\}/);
  assert.match(source, /calculateTranscriptVirtualRange/);
  assert.doesNotMatch(source, /visibleMessages\.slice\(-MAX_RENDERED_TRANSCRIPT_MESSAGES\)/);
  assert.doesNotMatch(source, /visibleMessages\.slice\(0,\s*MAX_RENDERED_TRANSCRIPT_MESSAGES\)/);
  assert.doesNotMatch(source, /\{visibleMessages\.map\(/);
});

test('search navigation pages toward unloaded targets without using load-all', () => {
  /** Scenario: 搜索命中未加载旧消息时按页查找，不发起无 limit 全量请求 */
  const sessionState = readSource('frontend/components/chat/hooks/useChatSessionState.ts');
  const chatInterface = readSource('frontend/components/chat/view/ChatInterface.tsx');

  assert.match(sessionState, /loadMessagesUntilTarget/);
  assert.match(sessionState, /MESSAGES_PER_PAGE/);
  assert.match(sessionState, /fetchSessionMessages\(\s*sessionProjectName,\s*requestSessionId,\s*MESSAGES_PER_PAGE,\s*currentOffset,/);
  assert.doesNotMatch(sessionState, /setVisibleMessageCount\(Infinity\)/);
  assert.match(chatInterface, /loadMessagesUntilTarget\(\{ messageKey: activeSearchTarget\.messageKey \}\)/);
  assert.doesNotMatch(chatInterface, /loadAllMessages\(\{ reveal: true \}\)/);
});

test('search reveals targets that are loaded but outside the visible data window', () => {
  /** Scenario: 已加载但未进入 visibleMessages 的命中会先扩展数据窗口 */
  const sessionState = readSource('frontend/components/chat/hooks/useChatSessionState.ts');
  const chatInterface = readSource('frontend/components/chat/view/ChatInterface.tsx');

  assert.match(sessionState, /const revealLoadedMessage = useCallback/);
  assert.match(sessionState, /endIndex - targetIndex/);
  assert.match(sessionState, /setVisibleMessageCount/);
  assert.match(chatInterface, /if \(hasTargetMessage\) \{\s*revealLoadedMessage\(activeSearchTarget\.messageKey\);/);
  assert.match(chatInterface, /searchHighlightRetry/);
  assert.match(chatInterface, /visibleMessages\]/);
});

test('external appends merge data while preserving an up-scroll frozen viewport', () => {
  /** Scenario: 用户上滑时新消息进入数据，但不扩大当前可见窗口到最新尾部 */
  const sessionState = readSource('frontend/components/chat/hooks/useChatSessionState.ts');

  assert.doesNotMatch(sessionState, /if \(frozenTailMessageKeyRef\.current \|\| isUserScrolledUpRef\.current\) \{\s*return;\s*\}/);
  assert.match(sessionState, /const shouldKeepCurrentViewport = frozenTailMessageKeyRef\.current \|\| isUserScrolledUpRef\.current/);
  assert.match(sessionState, /setSessionMessages\(\(previous\) => dedupeSessionMessagesByIdentity\(\[/);
  assert.match(sessionState, /if \(!shouldKeepCurrentViewport\) \{/);
});

test('follow-latest appends expand the visible tail to keep live Codex output visible', () => {
  /** Scenario: 跟随模式下读模型刷新不能把尚未落盘的 Codex live 文本裁出尾窗 */
  const sessionState = readSource('frontend/components/chat/hooks/useChatSessionState.ts');

  assert.match(sessionState, /const isFollowingLatestRef = useRef\(isFollowingLatest\)/);
  assert.match(sessionState, /isFollowingLatestRef\.current = isFollowingLatest/);
  assert.match(
    sessionState,
    /isFollowingLatestRef\.current[\s\S]{0,160}Math\.max\(nextCount,\s*chatMessagesRef\.current\.length \+ newKeyCount\)/,
    'co cursor refresh should expand the visible tail to include current live rows while following latest',
  );
  assert.match(
    sessionState,
    /isFollowingLatestRef\.current[\s\S]{0,180}Math\.max\(nextCount,\s*chatMessagesRef\.current\.length \+ uniqueNewMessages\.length\)/,
    'ordinary append refresh should expand the visible tail to include current live rows while following latest',
  );
});

test('collapsed tool sections do not mount heavy children until expanded', () => {
  /** Scenario: 折叠工具卡默认只渲染摘要，展开后才挂载完整内容 */
  const source = readSource('frontend/components/chat/tools/components/CollapsibleSection.tsx');

  assert.match(source, /useState\(open\)/);
  assert.match(source, /onToggle=\{\(event\) => (?:flushSync\(\(\) => )?setIsOpen\(event\.currentTarget\.open\)\)?\}/);
  assert.match(source, /\{isOpen && \(/);
  assert.match(source, /data-testid="collapsible-lazy-content"/);
});

test('heavy markdown, diff, tool output, and subagent timelines have lazy summaries', () => {
  /** Scenario: 重内容默认摘要化，用户展开后才渲染完整内容 */
  const markdown = readSource('frontend/components/chat/view/subcomponents/Markdown.tsx');
  const diffViewer = readSource('frontend/components/chat/tools/components/DiffViewer.tsx');
  const textContent = readSource('frontend/components/chat/tools/components/ContentRenderers/TextContent.tsx');
  const subagent = readSource('frontend/components/chat/tools/components/SubagentContainer.tsx');

  assert.match(markdown, /LARGE_CODE_BLOCK_LINE_THRESHOLD/);
  assert.match(markdown, /data-testid="large-code-block-summary"/);
  assert.match(diffViewer, /LARGE_DIFF_LINE_THRESHOLD/);
  assert.match(diffViewer, /if \(isLargeDiff && !expanded\)/);
  assert.match(diffViewer, /data-testid="large-diff-summary"/);
  assert.match(textContent, /LARGE_TEXT_LINE_THRESHOLD/);
  assert.match(textContent, /data-testid="large-tool-output-summary"/);
  assert.match(subagent, /isLiveTool && childTools\.length <= 20/);
});
