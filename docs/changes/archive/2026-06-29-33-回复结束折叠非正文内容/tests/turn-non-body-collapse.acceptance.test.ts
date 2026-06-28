/**
 * PURPOSE: Contract-test turn-level non-body grouping so completed responses
 * show assistant body first while thinking and tool details remain inspectable.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

type MessageLike = {
  type: string;
  content?: string;
  timestamp: string;
  messageKey?: string;
  isThinking?: boolean;
  isToolUse?: boolean;
  isSubagentContainer?: boolean;
  toolName?: string;
  toolCallId?: string;
  toolInput?: unknown;
  toolResult?: unknown;
};

type DisplayBlock = {
  kind: string;
  turnKey?: string;
  defaultOpen?: boolean;
  message?: MessageLike;
  items?: Array<{
    kind: string;
    groupKey?: string;
    defaultOpen?: boolean;
    commandCount?: number;
    messages?: MessageLike[];
  }>;
};

const REPO_ROOT = process.cwd();
const TURN_COLLAPSE_MODULE_PATH = path.join(
  REPO_ROOT,
  'frontend',
  'components',
  'chat',
  'utils',
  'turnNonBodyCollapse.ts',
);
const STATE_EVIDENCE_PATH = path.join(
  REPO_ROOT,
  'test-results',
  'turn-non-body-collapse',
  'state.json',
);

/**
 * Load the production turn grouping module and fail clearly until the feature
 * exists.
 */
async function loadTurnCollapseModule(): Promise<{
  buildTurnDisplayBlocks: (messages: MessageLike[]) => DisplayBlock[];
}> {
  assert.equal(
    fs.existsSync(TURN_COLLAPSE_MODULE_PATH),
    true,
    '缺少 frontend/components/chat/utils/turnNonBodyCollapse.ts，尚未实现 turn 级非正文折叠分组',
  );

  const moduleExports = await import(pathToFileURL(TURN_COLLAPSE_MODULE_PATH).href);
  assert.equal(
    typeof moduleExports.buildTurnDisplayBlocks,
    'function',
    'turnNonBodyCollapse.ts 必须导出 buildTurnDisplayBlocks(messages)',
  );

  return moduleExports as {
    buildTurnDisplayBlocks: (messages: MessageLike[]) => DisplayBlock[];
  };
}

function buildCompletedTurnMessages(): MessageLike[] {
  /** 构造一个真实业务回合：用户、思考、批量工具、单工具、最终正文。 */
  return [
    {
      type: 'user',
      content: '请检查项目并运行必要测试',
      timestamp: '2026-06-28T12:00:00.000Z',
      messageKey: 'turn-user-1',
    },
    {
      type: 'assistant',
      content: '我先阅读项目结构，再运行测试。',
      timestamp: '2026-06-28T12:00:01.000Z',
      messageKey: 'thinking-1',
      isThinking: true,
    },
    {
      type: 'assistant',
      timestamp: '2026-06-28T12:00:02.000Z',
      messageKey: 'batch-tools-1',
      isToolUse: true,
      toolName: 'batch_execute',
      toolCallId: 'batch-1',
      toolInput: {
        commands: [
          { command: 'pnpm exec tsc --noEmit' },
          { command: 'pnpm exec vitest run' },
        ],
      },
      toolResult: { content: 'typecheck ok\nvitest ok' },
    },
    {
      type: 'assistant',
      timestamp: '2026-06-28T12:00:03.000Z',
      messageKey: 'single-tool-1',
      isToolUse: true,
      toolName: 'Bash',
      toolCallId: 'bash-1',
      toolInput: { command: 'pnpm exec playwright test smoke.spec.ts' },
      toolResult: { content: 'playwright smoke ok' },
    },
    {
      type: 'assistant',
      content: '检查完成：类型检查、单元测试和冒烟测试都通过，主要风险是长会话渲染仍需截图复核。',
      timestamp: '2026-06-28T12:00:04.000Z',
      messageKey: 'assistant-body-1',
    },
  ];
}

/**
 * Write the required `turn-collapse-state` evidence snapshot after the
 * production grouping function exists.
 */
function writeTurnCollapseStateEvidence(blocks: DisplayBlock[]): void {
  fs.mkdirSync(path.dirname(STATE_EVIDENCE_PATH), { recursive: true });
  const nonBodyGroups = blocks.filter((block) => block.kind === 'turn-non-body-group');
  fs.writeFileSync(
    STATE_EVIDENCE_PATH,
    `${JSON.stringify({
      evidenceId: 'turn-collapse-state',
      nonBodyGroupCount: nonBodyGroups.length,
      defaultOpenValues: nonBodyGroups.map((block) => block.defaultOpen),
      toolGroupCommandCounts: nonBodyGroups.flatMap((block) =>
        (block.items || [])
          .filter((item) => item.kind === 'tool-group')
          .map((item) => item.commandCount ?? 0),
      ),
    }, null, 2)}\n`,
    'utf8',
  );
}

test('正文开始后，正文前思考和工具调用进入默认折叠的外层非正文组', async () => {
  const { buildTurnDisplayBlocks } = await loadTurnCollapseModule();

  const blocks = buildTurnDisplayBlocks(buildCompletedTurnMessages());
  writeTurnCollapseStateEvidence(blocks);
  const nonBodyGroup = blocks.find((block) => block.kind === 'turn-non-body-group');
  const assistantBody = blocks.find((block) => block.kind === 'assistant-body');

  assert.ok(nonBodyGroup, '存在最终正文时，正文前的思考和工具调用必须进入 turn-non-body-group');
  assert.equal(nonBodyGroup?.turnKey, 'turn-user-1');
  assert.equal(nonBodyGroup?.defaultOpen, false, '最终正文已经出现后，非正文组默认必须折叠');
  assert.equal(assistantBody?.message?.messageKey, 'assistant-body-1', '最终回复正文必须作为独立正文块直接展示');
  assert.equal(
    blocks.findIndex((block) => block.kind === 'turn-non-body-group') <
      blocks.findIndex((block) => block.kind === 'assistant-body'),
    true,
    '非正文折叠组应位于最终正文之前，保留阅读顺序',
  );

  const itemKinds = nonBodyGroup?.items?.map((item) => item.kind) || [];
  assert.deepEqual(itemKinds, ['thinking-group', 'tool-group', 'tool-group']);
});

test('正文尚未开始时，live 思考和工具调用保持展开可见', async () => {
  const { buildTurnDisplayBlocks } = await loadTurnCollapseModule();
  const liveMessages = buildCompletedTurnMessages().filter((message) => message.messageKey !== 'assistant-body-1');

  const blocks = buildTurnDisplayBlocks(liveMessages);
  const nonBodyGroup = blocks.find((block) => block.kind === 'turn-non-body-group');

  assert.ok(nonBodyGroup, 'live 阶段仍应有非正文组承载思考和工具调用');
  assert.equal(nonBodyGroup?.defaultOpen, true, '正文尚未开始时不能默认折叠 live 执行过程');
  assert.equal(blocks.some((block) => block.kind === 'assistant-body'), false, '尚无普通助手正文时不应伪造正文块');
});

test('批量工具调用按组折叠，并记录组内命令数量', async () => {
  const { buildTurnDisplayBlocks } = await loadTurnCollapseModule();

  const blocks = buildTurnDisplayBlocks(buildCompletedTurnMessages());
  const nonBodyGroup = blocks.find((block) => block.kind === 'turn-non-body-group');
  const batchGroup = nonBodyGroup?.items?.find((item) => item.groupKey === 'batch-1');

  assert.ok(batchGroup, '批量工具调用必须形成独立工具组');
  assert.equal(batchGroup?.kind, 'tool-group');
  assert.equal(batchGroup?.defaultOpen, false, '正文开始后批量工具组默认折叠');
  assert.equal(batchGroup?.commandCount, 2, '批量工具组摘要必须知道包含两个命令');
  assert.equal(batchGroup?.messages?.length, 1, '同一个 batch_execute 工具卡不得拆散成多个外层消息块');
});

test('历史回放字符串 toolInput 仍能统计批量命令数量', async () => {
  const { buildTurnDisplayBlocks } = await loadTurnCollapseModule();

  const messages = buildCompletedTurnMessages().map((message) => {
    if (message.messageKey !== 'batch-tools-1') {
      return message;
    }
    return {
      ...message,
      toolInput: JSON.stringify({ command: 'pnpm exec tsc --noEmit\npnpm exec vitest run' }, null, 2),
    };
  });
  const blocks = buildTurnDisplayBlocks(messages);
  const nonBodyGroup = blocks.find((block) => block.kind === 'turn-non-body-group');
  const batchGroup = nonBodyGroup?.items?.find((item) => item.groupKey === 'batch-1');

  assert.equal(batchGroup?.commandCount, 2, '历史消息中的 JSON 字符串 toolInput 也必须展示两个命令');
});

test('历史回放拆分 tool_use 和 tool_result 时不把结果额外计为命令', async () => {
  const { buildTurnDisplayBlocks } = await loadTurnCollapseModule();

  const blocks = buildTurnDisplayBlocks([
    {
      type: 'user',
      content: '运行两条命令',
      timestamp: '2026-06-28T12:00:00.000Z',
      messageKey: 'split-user-1',
    },
    {
      type: 'tool_use',
      timestamp: '2026-06-28T12:00:01.000Z',
      messageKey: 'split-tool-use-1',
      toolCallId: 'split-batch-1',
      toolName: 'Bash',
      toolInput: { command: 'cmd1\ncmd2' },
    },
    {
      type: 'tool_result',
      timestamp: '2026-06-28T12:00:02.000Z',
      messageKey: 'split-tool-result-1',
      toolCallId: 'split-batch-1',
      toolName: 'Bash',
      toolResult: { content: 'ok' },
    },
    {
      type: 'assistant',
      content: '完成',
      timestamp: '2026-06-28T12:00:03.000Z',
      messageKey: 'split-assistant-body-1',
    },
  ]);
  const nonBodyGroup = blocks.find((block) => block.kind === 'turn-non-body-group');
  const batchGroup = nonBodyGroup?.items?.find((item) => item.groupKey === 'split-batch-1');

  assert.equal(batchGroup?.messages?.length, 2, '同一 toolCallId 的 tool_use 和 tool_result 应归入同一工具组');
  assert.equal(batchGroup?.commandCount, 2, 'tool_result 只是结果载体，不应额外增加批量命令数量');
});
