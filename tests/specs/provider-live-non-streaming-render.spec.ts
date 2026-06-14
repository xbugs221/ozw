// @ts-nocheck -- Spec fixture exercises native runtime event shapes that vary by provider SDK version.
/**
 * Sources: 2026-06-09-92-修复Codex和Pi前端非流式块渲染
 *
 * PURPOSE: Verify Codex/Pi WebSocket live deltas accumulate as visible batched
 * output, then converge to one final block after provider completion. Covers
 * assistant text, tool cards, empty output, thinking blocks, stable message
 * identity, and user-bubble stability across pending and completed events.
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

type ProviderName = 'codex' | 'pi';

type ChatMessageLike = {
  type?: string;
  content?: unknown;
  provider?: string;
  source?: string;
  messageKey?: string;
  isThinking?: boolean;
  isToolUse?: boolean;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  toolId?: unknown;
  toolCallId?: unknown;
  deliveryStatus?: string;
  renderVisibility?: string;
  hiddenUntilComplete?: boolean;
  pending?: boolean;
};

type NativeTranscriptModule = {
  reduceNativeRuntimeEvent: (
    messages: ChatMessageLike[],
    event: Record<string, unknown>,
  ) => ChatMessageLike[];
  filterRenderableMessages: (messages: ChatMessageLike[]) => ChatMessageLike[];
};

const REPO_ROOT = process.cwd();
const EVIDENCE_DIR = path.join(REPO_ROOT, 'test-results/proposal-92-provider-non-streaming-render');
const PROVIDERS: ProviderName[] = ['codex', 'pi'];

async function loadNativeTranscriptModule(): Promise<NativeTranscriptModule> {
  /**
   * docstring：导入生产 live reducer 和可见层过滤函数，确保测试与真实 UI 共用同一过滤规则。
   */
  const modulePath = path.join(REPO_ROOT, 'frontend/components/chat/utils/nativeRuntimeTranscript.ts');
  const mod = await import(pathToFileURL(modulePath).href) as Partial<NativeTranscriptModule>;
  assert.equal(typeof mod.reduceNativeRuntimeEvent, 'function');
  assert.equal(typeof mod.filterRenderableMessages, 'function');
  return mod as NativeTranscriptModule;
}

function eventTypeFor(provider: ProviderName): string {
  /**
   * docstring：返回生产 reducer 用来区分 Codex/Pi provider 的真实 envelope type。
   */
  return provider === 'pi' ? 'pi-response' : 'codex-response';
}

function visibleText(value: unknown): string {
  /**
   * docstring：把 ChatMessage 里可能出现的字符串、数组和对象归一成用户实际可见文本。
   */
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(visibleText).join('');
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return visibleText(record.text ?? record.content ?? record.output ?? record.result ?? JSON.stringify(value));
  }
  return String(value);
}

function assertUniqueVisibleKeys(visibleMessages: ChatMessageLike[], context: string): void {
  /**
   * docstring：可见 transcript 中相同 key 会导致 React 复用错行或覆盖内容，必须作为契约失败处理。
   */
  const keys = visibleMessages.map((message) => String(message.messageKey || '')).filter(Boolean);
  assert.deepEqual(keys, [...new Set(keys)], `${context} 可见消息 messageKey 不得重复`);
}

function userMessage(provider: ProviderName, turnAnchorKey: string, content: string): ChatMessageLike {
  /**
   * docstring：构造用户刚发送的新请求气泡，作为本轮 provider 响应的可见锚点。
   */
  return {
    type: 'user',
    content,
    provider,
    source: 'local-user',
    messageKey: `${provider}:user:${turnAnchorKey}`,
    deliveryStatus: 'sent',
    turnAnchorKey,
  };
}

function assertUserBubbleStable(
  message: ChatMessageLike | undefined,
  expected: ChatMessageLike,
  context: string,
): void {
  /**
   * docstring：锁定用户气泡字段，防止 provider pending 事件把用户消息改成 assistant/tool/thinking。
   */
  assert.ok(message, `${context} 必须保留用户气泡`);
  assert.equal(message.type, 'user', `${context} 用户气泡 type 必须保持 user`);
  assert.equal(message.content, expected.content, `${context} 用户气泡内容不得改变`);
  assert.equal(message.deliveryStatus, expected.deliveryStatus, `${context} 用户气泡发送状态不得被 provider 事件改写`);
  assert.equal(message.turnAnchorKey, expected.turnAnchorKey, `${context} 用户气泡 turnAnchorKey 不得改变`);
  assert.equal(message.isThinking, undefined, `${context} 用户气泡不得变成 thinking`);
  assert.equal(message.isToolUse, undefined, `${context} 用户气泡不得变成工具卡`);
}

function streamingAssistantDeltaEvent(provider: ProviderName, itemId: string, text: string): Record<string, unknown> {
  /**
   * docstring：构造未完成正文分片，当前页面不得把它当作可见正文渲染。
   */
  return {
    type: eventTypeFor(provider),
    sessionId: `proposal-92-${provider}-session`,
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId,
      status: 'in_progress',
      delta: { text },
      message: { role: 'assistant' },
    },
  };
}

function completedAssistantTextEvent(provider: ProviderName, itemId: string, text: string): Record<string, unknown> {
  /**
   * docstring：构造 completed assistant 正文事件，代表 SDK 已给出最终完整内容。
   */
  return {
    type: eventTypeFor(provider),
    sessionId: `proposal-92-${provider}-session`,
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId,
      status: 'completed',
      message: { role: 'assistant', content: text },
    },
  };
}

function toolCallEvent(provider: ProviderName, callId: string, command: string): Record<string, unknown> {
  /**
   * docstring：构造尚未完成的命令工具输入事件，执行阶段需要暂存但不能显示半成品卡片。
   */
  if (provider === 'pi') {
    return {
      type: eventTypeFor(provider),
      sessionId: `proposal-92-${provider}-session`,
      data: {
        type: 'item',
        itemType: 'tool_call',
        itemId: callId,
        status: 'in_progress',
        tool: 'functions.exec_command',
        arguments: { cmd: command, yield_time_ms: 5000 },
      },
    };
  }

  return {
    type: eventTypeFor(provider),
    sessionId: `proposal-92-${provider}-session`,
    data: {
      type: 'item',
      itemType: 'function_call',
      itemId: callId,
      status: 'in_progress',
      item: {
        type: 'function_call',
        call_id: callId,
        name: 'functions.exec_command',
        arguments: JSON.stringify({ cmd: command, yield_time_ms: 5000 }),
      },
    },
  };
}

function toolOutputEvent(provider: ProviderName, callId: string, output: string): Record<string, unknown> {
  /**
   * docstring：构造命令工具完成 output，完成后页面应一次性显示完整工具卡。
   */
  if (provider === 'pi') {
    return {
      type: eventTypeFor(provider),
      sessionId: `proposal-92-${provider}-session`,
      data: {
        type: 'item',
        itemType: 'tool_result',
        itemId: callId,
        status: 'completed',
        tool: 'functions.exec_command',
        output,
      },
    };
  }

  return {
    type: eventTypeFor(provider),
    sessionId: `proposal-92-${provider}-session`,
    data: {
      type: 'item',
      itemType: 'function_call_output',
      itemId: callId,
      status: 'completed',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output,
      },
    },
  };
}

function streamingThinkingDeltaEvent(provider: ProviderName, itemId: string, text: string): Record<string, unknown> {
  /**
   * docstring：构造未完成 thinking/reasoning 分片，不能先按普通正文进入可见 transcript。
   */
  return {
    type: eventTypeFor(provider),
    sessionId: `proposal-92-${provider}-session`,
    data: {
      type: 'item',
      itemType: provider === 'pi' ? 'thinking' : 'reasoning',
      itemId,
      status: 'in_progress',
      delta: { text },
    },
  };
}

function completedThinkingEvent(provider: ProviderName, itemId: string, text: string): Record<string, unknown> {
  /**
   * docstring：构造 completed thinking/reasoning 事件，最终可见消息必须直接是思考块。
   */
  return {
    type: eventTypeFor(provider),
    sessionId: `proposal-92-${provider}-session`,
    data: {
      type: 'item',
      itemType: provider === 'pi' ? 'thinking' : 'reasoning',
      itemId,
      status: 'completed',
      message: { role: 'assistant', content: text },
    },
  };
}

for (const provider of PROVIDERS) {
  test(`${provider} assistant delta accumulates visibly until completed content is available`, async () => {
    const { reduceNativeRuntimeEvent, filterRenderableMessages } = await loadNativeTranscriptModule();
    let messages: ChatMessageLike[] = [];

    messages = reduceNativeRuntimeEvent(
      messages,
      streamingAssistantDeltaEvent(provider, `proposal-92-${provider}-assistant-text`, `proposal 92 ${provider} partial answer`),
    );
    let visible = filterRenderableMessages(messages);
    assert.equal(visible.length, 1, `${provider} 未完成 assistant delta 应进入可见 transcript`);
    assert.equal(visible[0].type, 'assistant');
    assert.match(visibleText(visible[0].content), /partial answer/);

    messages = reduceNativeRuntimeEvent(
      messages,
      completedAssistantTextEvent(provider, `proposal-92-${provider}-assistant-text`, `proposal 92 ${provider} final answer is rendered once.`),
    );

    visible = filterRenderableMessages(messages);
    assert.equal(visible.length, 1, `${provider} completed 正文只能显示一条最终消息`);
    assertUniqueVisibleKeys(filterRenderableMessages(messages), `${provider} completed 正文`);
    assert.equal(visible[0].type, 'assistant');
    assert.equal(visible[0].isThinking, undefined);
    assert.equal(visible[0].isToolUse, undefined);
    assert.match(visibleText(visible[0].content), /final answer is rendered once/);
    assert.doesNotMatch(visibleText(visible[0].content), /partial answer/, 'completed final 应替换流式草稿');
  });

  test(`${provider} command tool card appears once after output completion`, async () => {
    const { reduceNativeRuntimeEvent, filterRenderableMessages } = await loadNativeTranscriptModule();
    const command = `printf proposal-92-${provider}-tool-output`;
    let messages: ChatMessageLike[] = [];

    messages = reduceNativeRuntimeEvent(messages, toolCallEvent(provider, `proposal-92-${provider}-tool-call`, command));
    assert.equal(
      filterRenderableMessages(messages).filter((message) => message.isToolUse).length,
      0,
      `${provider} 未完成工具调用应暂存但不显示发起卡`,
    );

    messages = reduceNativeRuntimeEvent(
      messages,
      toolOutputEvent(provider, `proposal-92-${provider}-tool-call`, `proposal-92-${provider}-tool-output\n`),
    );

    const visibleTools = filterRenderableMessages(messages).filter((message) => message.isToolUse);
    assert.equal(visibleTools.length, 1, `${provider} 工具输入和 output 完成后只能合成一张工具卡`);
    assertUniqueVisibleKeys(filterRenderableMessages(messages), `${provider} completed 工具卡`);
    assert.equal(
      String(visibleTools[0].toolCallId || visibleTools[0].toolId),
      `proposal-92-${provider}-tool-call`,
      `${provider} 工具卡必须保留 toolCallId 作为稳定业务 identity`,
    );
    assert.match(visibleText(visibleTools[0].toolInput), new RegExp(`proposal-92-${provider}-tool-output`));
    assert.match(visibleText(visibleTools[0].toolResult), new RegExp(`proposal-92-${provider}-tool-output`));
  });

  test(`${provider} command tool with empty output does not create a visible result area`, async () => {
    const { reduceNativeRuntimeEvent, filterRenderableMessages } = await loadNativeTranscriptModule();
    let messages: ChatMessageLike[] = [];

    messages = reduceNativeRuntimeEvent(messages, toolCallEvent(provider, `proposal-92-${provider}-empty-output`, 'true'));
    messages = reduceNativeRuntimeEvent(messages, toolOutputEvent(provider, `proposal-92-${provider}-empty-output`, '   \n'));

    const visibleTools = filterRenderableMessages(messages).filter((message) => message.isToolUse);
    assert.equal(visibleTools.length, 1, `${provider} 空 output 命令完成后仍应保留命令工具卡`);
    assertUniqueVisibleKeys(filterRenderableMessages(messages), `${provider} 空 output 工具卡`);
    assert.match(visibleText(visibleTools[0].toolInput), /true/);
    assert.equal(
      visibleTools[0].toolResult ?? null,
      null,
      `${provider} 空 output 不得生成 toolResult，否则渲染层会留下空白结果区`,
    );
  });

  test(`${provider} thinking delta renders as thinking and completed thinking stays thinking`, async () => {
    const { reduceNativeRuntimeEvent, filterRenderableMessages } = await loadNativeTranscriptModule();
    let messages: ChatMessageLike[] = [];

    messages = reduceNativeRuntimeEvent(
      messages,
      streamingThinkingDeltaEvent(provider, `proposal-92-${provider}-thinking`, `proposal 92 ${provider} partial thinking`),
    );
    let visible = filterRenderableMessages(messages);
    assert.equal(visible.length, 1, `${provider} 未完成 thinking delta 应生成 thinking 行`);
    assert.equal(visible[0].isThinking, true, `${provider} 未完成 thinking delta 不得显示成普通正文`);
    assert.match(visibleText(visible[0].content), /partial thinking/);

    messages = reduceNativeRuntimeEvent(
      messages,
      completedThinkingEvent(provider, `proposal-92-${provider}-thinking`, `proposal 92 ${provider} completed thinking block.`),
    );

    visible = filterRenderableMessages(messages);
    const thinkingRows = visible.filter((message) => message.isThinking);
    const plainAssistantRows = visible.filter((message) => message.type === 'assistant' && !message.isThinking && !message.isToolUse);

    assert.equal(thinkingRows.length, 1, `${provider} completed thinking 必须生成一条 thinking 消息`);
    assertUniqueVisibleKeys(filterRenderableMessages(messages), `${provider} completed thinking`);
    assert.equal(plainAssistantRows.length, 0, `${provider} 思考内容不得同时保留普通正文副本`);
    assert.match(visibleText(thinkingRows[0].content), /completed thinking block/);
    assert.doesNotMatch(visibleText(thinkingRows[0].content), /partial thinking/, 'completed thinking 应替换流式草稿');
  });

  test(`${provider} visible message identity stays stable across pending and completed items`, async () => {
    const { reduceNativeRuntimeEvent, filterRenderableMessages } = await loadNativeTranscriptModule();
    let messages: ChatMessageLike[] = [];

    messages = reduceNativeRuntimeEvent(
      messages,
      streamingAssistantDeltaEvent(provider, `proposal-92-${provider}-identity-text`, `proposal 92 ${provider} identity partial 1`),
    );
    messages = reduceNativeRuntimeEvent(
      messages,
      streamingAssistantDeltaEvent(provider, `proposal-92-${provider}-identity-text`, `proposal 92 ${provider} identity partial 2`),
    );
    let pendingTextRows = filterRenderableMessages(messages)
      .filter((message) => message.type === 'assistant' && !message.isThinking && !message.isToolUse);
    assert.equal(pendingTextRows.length, 1, `${provider} 多次 pending 正文 delta 应复用一条可见消息`);
    assert.match(visibleText(pendingTextRows[0].content), /partial 1.*partial 2/);

    messages = reduceNativeRuntimeEvent(
      messages,
      completedAssistantTextEvent(provider, `proposal-92-${provider}-identity-text`, `proposal 92 ${provider} identity final text.`),
    );

    const afterText = filterRenderableMessages(messages);
    assert.equal(afterText.length, 1, `${provider} 同一正文 item completed 后只能出现一条可见消息`);
    assertUniqueVisibleKeys(filterRenderableMessages(messages), `${provider} identity 正文 completed`);
    assert.match(String(afterText[0].messageKey || ''), new RegExp(`proposal-92-${provider}-identity-text`));

    messages = reduceNativeRuntimeEvent(
      messages,
      completedThinkingEvent(provider, `proposal-92-${provider}-identity-thinking`, `proposal 92 ${provider} identity thinking.`),
    );

    const afterThinking = filterRenderableMessages(messages);
    const plainTextRows = afterThinking.filter((message) => message.type === 'assistant' && !message.isThinking && !message.isToolUse);
    const thinkingRows = afterThinking.filter((message) => message.isThinking);
    assert.equal(plainTextRows.length, 1, `${provider} thinking completed 不得覆盖同轮普通正文`);
    assert.equal(thinkingRows.length, 1, `${provider} thinking completed 必须形成独立稳定行`);
    assertUniqueVisibleKeys(filterRenderableMessages(messages), `${provider} identity 正文和 thinking 并存`);

    messages = reduceNativeRuntimeEvent(messages, toolCallEvent(provider, `proposal-92-${provider}-identity-tool`, 'printf identity-output'));
    assert.equal(
      filterRenderableMessages(messages).filter((message) => message.isToolUse).length,
      0,
      `${provider} pending 工具输入应暂存但不进入可见 transcript`,
    );
    messages = reduceNativeRuntimeEvent(messages, toolOutputEvent(provider, `proposal-92-${provider}-identity-tool`, 'identity-output\n'));

    const visibleTools = filterRenderableMessages(messages).filter((message) => message.isToolUse);
    assert.equal(visibleTools.length, 1, `${provider} 工具 input/output 必须共用一张稳定卡片`);
    assert.equal(
      String(visibleTools[0].toolCallId || visibleTools[0].toolId),
      `proposal-92-${provider}-identity-tool`,
      `${provider} 工具 input/output 必须保留同一个 toolCallId identity`,
    );
    assertUniqueVisibleKeys(filterRenderableMessages(messages), `${provider} identity 工具 completed`);
  });

  test(`${provider} user bubble stays stable while new response is pending and completing`, async () => {
    const { reduceNativeRuntimeEvent, filterRenderableMessages } = await loadNativeTranscriptModule();
    const user = userMessage(
      provider,
      `proposal-92-${provider}-user-turn`,
      `proposal 92 ${provider} user request should stay stable.`,
    );
    let messages: ChatMessageLike[] = [user];

    messages = reduceNativeRuntimeEvent(
      messages,
      streamingAssistantDeltaEvent(provider, `proposal-92-${provider}-user-followup-text`, `proposal 92 ${provider} pending text`),
    );
    messages = reduceNativeRuntimeEvent(
      messages,
      toolCallEvent(provider, `proposal-92-${provider}-user-followup-tool`, 'printf pending-tool'),
    );
    messages = reduceNativeRuntimeEvent(
      messages,
      streamingThinkingDeltaEvent(provider, `proposal-92-${provider}-user-followup-thinking`, `proposal 92 ${provider} pending thinking`),
    );

    const pendingVisible = filterRenderableMessages(messages);
    assert.equal(
      pendingVisible.length,
      3,
      `${provider} 响应 pending 过程中应显示用户气泡、正文和 thinking，但不显示工具发起卡`,
    );
    assertUserBubbleStable(pendingVisible[0], user, `${provider} pending 响应期间`);
    assert.equal(
      pendingVisible.some((message) => message.type === 'assistant' && !message.isThinking && !message.isToolUse),
      true,
      `${provider} pending 响应期间应显示流式正文`,
    );
    assert.equal(
      pendingVisible.some((message) => message.isToolUse),
      false,
      `${provider} pending 响应期间不得显示工具发起卡`,
    );
    assert.equal(
      pendingVisible.some((message) => message.isThinking),
      true,
      `${provider} pending 响应期间应显示 thinking`,
    );
    assertUniqueVisibleKeys(filterRenderableMessages(messages), `${provider} pending 用户气泡`);

    messages = reduceNativeRuntimeEvent(
      messages,
      completedAssistantTextEvent(provider, `proposal-92-${provider}-user-followup-text`, `proposal 92 ${provider} completed answer.`),
    );

    const completedVisible = filterRenderableMessages(messages);
    assert.equal(completedVisible.length, 3, `${provider} completed 响应必须保留可见行并确认正文`);
    assertUserBubbleStable(completedVisible[0], user, `${provider} completed 响应后`);
    assert.equal(completedVisible[1].type, 'assistant', `${provider} completed 响应第二行必须是 assistant`);
    assert.equal(completedVisible[1].isThinking, undefined, `${provider} completed 普通响应不得变成 thinking`);
    assert.equal(completedVisible[1].isToolUse, undefined, `${provider} completed 普通响应不得变成工具卡`);
    assert.match(visibleText(completedVisible[1].content), /completed answer/);
    assertUniqueVisibleKeys(filterRenderableMessages(messages), `${provider} completed 用户气泡和响应`);
  });
}

test('writes proposal 92 provider non-streaming render state snapshot from reducer output', async () => {
  const { reduceNativeRuntimeEvent, filterRenderableMessages } = await loadNativeTranscriptModule();
  const snapshots: Record<string, unknown> = {};

  for (const provider of PROVIDERS) {
    let messages: ChatMessageLike[] = [];
    const steps: Array<Record<string, unknown>> = [];
    const events = [
      streamingAssistantDeltaEvent(provider, `state-${provider}-assistant`, `state ${provider} partial answer`),
      completedAssistantTextEvent(provider, `state-${provider}-assistant`, `state ${provider} completed answer`),
      streamingAssistantDeltaEvent(provider, `state-${provider}-user-bubble-pending`, `state ${provider} user bubble pending answer`),
      toolCallEvent(provider, `state-${provider}-tool`, `printf state-${provider}-output`),
      toolOutputEvent(provider, `state-${provider}-tool`, `state-${provider}-output\n`),
      toolCallEvent(provider, `state-${provider}-empty-tool`, 'true'),
      toolOutputEvent(provider, `state-${provider}-empty-tool`, ''),
      streamingThinkingDeltaEvent(provider, `state-${provider}-thinking`, `state ${provider} partial thinking`),
      completedThinkingEvent(provider, `state-${provider}-thinking`, `state ${provider} completed thinking`),
    ];

    for (const event of events) {
      messages = reduceNativeRuntimeEvent(messages, event);
      steps.push({
        event,
        allMessageCount: messages.length,
        visibleMessageCount: filterRenderableMessages(messages).length,
        visibleMessages: filterRenderableMessages(messages),
      });
    }

    const finalVisible = filterRenderableMessages(messages);
    const finalTools = finalVisible.filter((message) => message.isToolUse);
    const finalThinking = finalVisible.filter((message) => message.isThinking);

    assert.equal(finalTools.length, 2, `${provider} 状态快照必须包含非空 output 和空 output 两张完成工具卡`);
    assert.equal(finalThinking.length, 1, `${provider} 状态快照必须包含 completed thinking 块`);
    assert.equal(finalTools.filter((message) => visibleText(message.toolResult).trim()).length, 1);
    assert.equal(finalTools.filter((message) => !visibleText(message.toolResult).trim()).length, 1);

    snapshots[provider] = { steps, finalVisible };
  }

  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'state.json'),
    `${JSON.stringify({
      capturedAt: new Date().toISOString(),
      snapshots,
    }, null, 2)}\n`,
    'utf8',
  );
});
