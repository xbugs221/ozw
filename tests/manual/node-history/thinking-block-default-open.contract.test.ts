/**
 * 62-修复Pi会话思考块默认展开与工具卡片折叠输出
 *
 * 契约测试：思考块默认展开
 * - MessageComponent 中 isThinking 分支直接以正文同款样式展示
 * - showThinking prop 不应影响思考块独立渲染
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function extractThinkingBlock(source: string): string {
  const start = source.indexOf('message.isThinking ?');
  const end = source.indexOf('\n            ) : (', start > 0 ? start : 0);
  return source.slice(Math.max(0, start), end > 0 ? end : source.length);
}

test('思考块内容直接可见，并使用正文同款样式', () => {
  const source = readRepoFile('frontend/components/chat/view/subcomponents/MessageComponent.tsx');

  const thinkingBlock = extractThinkingBlock(source);
  assert.ok(thinkingBlock, 'isThinking 渲染分支必须存在');
  assert.doesNotMatch(
    thinkingBlock,
    /<details/,
    'isThinking 块不应再使用 <details> 包裹思考内容（64 号提案精简后内容直接展示）',
  );
  assert.doesNotMatch(
    thinkingBlock,
    /<summary/,
    'isThinking 块不应包含 <summary> 标题',
  );
  assert.match(
    thinkingBlock,
    /className="text-sm text-gray-700 dark:text-gray-300"/,
    '思考内容应使用与助手正文一致的文字尺寸和颜色',
  );
  assert.match(
    thinkingBlock,
    /<Markdown/,
    '思考内容应继续通过 Markdown 渲染',
  );
  assert.doesNotMatch(
    thinkingBlock,
    /border-l-2|pl-4|italic|text-gray-600 dark:text-gray-400/,
    '思考内容不应再使用左边框、额外缩进或灰色斜体弱化',
  );
});

test('思考块渲染不依赖 showThinking，showThinking 只控制 reasoning 内联区', () => {
  const source = readRepoFile('frontend/components/chat/view/subcomponents/MessageComponent.tsx');

  // showThinking 只能用于控制 message.reasoning 的内联展示，不能影响 isThinking 消息的渲染。
  // 验证：isThinking 渲染路径没有 shouldHideThinkingMessage。
  const hasShouldHideCheck = /shouldHideThinkingMessage/.test(source);
  assert.ok(!hasShouldHideCheck, '不应存在 shouldHideThinkingMessage；showThinking=false 时 isThinking 消息仍渲染为独立卡片');

  // showThinking 出现在 reasoning 内联区条件的次数应至少为 1 次
  const reasoningShowChecks = (source.match(/showThinking\s*&&\s*message\.reasoning/g) || []);
  assert.ok(reasoningShowChecks.length >= 1, 'showThinking 必须用于控制 message.reasoning 的内联展示');

  const thinkingBlock = extractThinkingBlock(source);
  assert.ok(thinkingBlock, 'isThinking 渲染分支必须存在');
  assert.doesNotMatch(
    thinkingBlock,
    /<details/,
    'isThinking 块不应再使用 <details>',
  );

  // isThinking 渲染路径不应依赖 showThinking 变量
  const thinkingDependsOnShowThinking = source.match(
    /message\.isThinking\s*\?[\s\S]{0,300}[^a-zA-Z]showThinking[^a-zA-Z]/,
  );
  assert.ok(!thinkingDependsOnShowThinking, '思考块的可见性不应动态依赖 showThinking');
});

test('showThinking=false 不影响 isThinking 消息渲染与默认可见', () => {
  const source = readRepoFile('frontend/components/chat/view/subcomponents/MessageComponent.tsx');

  // showThinking 只能影响 message.reasoning 内联区，不能影响 isThinking 消息的渲染。
  // 验证：showThinking 只出现在 reasoning 条件中，不应出现在 isThinking 渲染路径的早期 return 中。
  const reasoningShowCheck = source.match(
    /\{showThinking\s*&&\s*message\.reasoning/,
  );
  assert.ok(reasoningShowCheck, 'showThinking 必须控制 message.reasoning 的内联展示');

  // isThinking 消息渲染路径不应有 shouldHideThinkingMessage 之类的提前 return
  const hasShouldHideCheck = /shouldHideThinkingMessage/.test(source);
  assert.ok(!hasShouldHideCheck, '不应再存在 shouldHideThinkingMessage 变量；showThinking=false 时 isThinking 消息仍需渲染为独立卡片');

  const thinkingBlock = extractThinkingBlock(source);
  assert.ok(thinkingBlock, 'isThinking 渲染分支必须存在');
  assert.doesNotMatch(
    thinkingBlock,
    /<details/,
    'isThinking 块内容应直接展示，不再使用 <details> 包裹',
  );
});
