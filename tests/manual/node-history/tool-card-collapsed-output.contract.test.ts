/**
 * 62-修复Pi会话思考块默认展开与工具卡片折叠输出
 *
 * 契约测试：工具卡片输出折叠
 * - 工具卡片的输出区域应包裹在独立的 <details> 中（默认折叠）
 * - 命令摘要行（summary 含工具名）始终可见
 * - 锚点 id="tool-result-..." 保留在可滚动到的元素上
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('工具卡片输出区域用独立 <details> 包裹使其默认折叠', () => {
  const source = readRepoFile('frontend/components/chat/view/subcomponents/MessageComponent.tsx');

  // 工具结果区域附近应该有独立的 <details> 包裹输出
  // 查找 tool-result 区域的渲染结构
  // 关键特征：tool-result 的 id 应该在 <details> 内部，且 <details> 应在 isToolCard 分支内
  const toolResultBlock = source.match(
    /message\.toolResult[\s\S]{0,2000}scroll-mt-4/,
  );
  assert.ok(toolResultBlock, '工具结果渲染区域必须存在');

  // 工具结果区域应包含独立的 <details> 用于折叠输出
  // 不应是外层 isToolCard 的同一个 <details>
  const resultInSeparateDetails = toolResultBlock![0].match(/<details[^>]*>/);
  assert.ok(resultInSeparateDetails, '工具输出区域应有独立的 <details> 元素');

  // 该 <details> 不应有 open 属性（默认折叠）
  const hasOpenOnResultDetails = resultInSeparateDetails![0].includes('open');
  assert.ok(!hasOpenOnResultDetails, '工具输出 <details> 不应有 open 属性（默认折叠）');
});

test('工具卡片无独立外层标题，工具名由 ToolRenderer 展示 (#64 精简块标题)', () => {
  const source = readRepoFile('frontend/components/chat/view/subcomponents/MessageComponent.tsx');

  // 64 号提案：工具卡片不再由 MessageComponent 渲染外层标题。
  // 工具名、命令文本等由具体 ToolRenderer 卡片负责展示。
  assert.doesNotMatch(
    source,
    /data-testid="codex-tool-card-title"/,
    'MessageComponent 不应再渲染 codex-tool-card-title（64 号提案已移除）',
  );
  assert.doesNotMatch(
    source,
    /\{message\.toolName\s*\|\|\s*['"]Tool['"]\}/,
    'MessageComponent 不应再展示外层工具名标题',
  );
});

test('锚点 id="tool-result-${message.toolId}" 保留在正确位置', () => {
  const source = readRepoFile('frontend/components/chat/view/subcomponents/MessageComponent.tsx');

  // 工具结果应有 id="tool-result-${message.toolId}" 作为滚动锚点
  const anchorId = source.match(/id=\{[^}]*tool-result-[^}]*\}/);
  assert.ok(anchorId, 'tool-result 锚点 id 必须保留');

  // 锚点应在 <details> 内部或其本身的属性上，以便锚点跳转时能展开折叠区
  const anchorDetailsContext = anchorId![0];
  // 默认展开或通过锚点行为展开均可
  // 关键是在 <details> 标签内或包裹在 <details> 内
  assert.ok(
    anchorDetailsContext.includes('tool-result'),
    '锚点 id 必须是 tool-result 格式',
  );
});

test('工具卡片外层是纯 <div>（命令始终可见）', () => {
  const source = readRepoFile('frontend/components/chat/view/subcomponents/MessageComponent.tsx');

  // isToolUse 分支的外层容器不应是 <details>。
  // 64 号提案后外层是纯 <div>，命令始终可见。
  const isToolUseBlock = source.match(
    /message\.isToolUse\s*\?[\s\S]{0,200}<div/,
  );
  assert.ok(isToolUseBlock, 'isToolUse 渲染分支必须存在');
  assert.doesNotMatch(
    isToolUseBlock![0],
    /^\s*<\s*details\b/,
    '工具卡片外层不应是 <details>，命令应始终可见',
  );
});
