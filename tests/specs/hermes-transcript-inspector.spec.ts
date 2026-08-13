/**
 * 文件目的：长期保护 OZW 服务端使用的 Hermes transcript 归一化语义。
 * 业务边界：仅验证纯转换，不访问数据库、网络、Dashboard 插件或 Hermes 运行时。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hermesLineageIds,
  normalizeHermesTranscript,
} from '../../shared/hermes-transcript-inspector.ts';

test('compression lineage 去重 user echo，并配对 reasoning 与工具结果', () => {
  /** 场景：父会话 compression 后由子会话接续同一用户 turn。 */
  const sessions = [
    { id: 'parent', end_reason: 'compression' },
    { id: 'child', parent_session_id: 'parent', source: 'tui' },
  ];
  const lineage = hermesLineageIds(sessions, 'child');
  assert.deepEqual(lineage, ['parent', 'child']);

  const turns = normalizeHermesTranscript([
    { id: 1, session_id: 'parent', role: 'user', content: '检查目录' },
    { id: 2, session_id: 'parent', role: 'assistant', reasoning_content: '先看目录' },
    { id: 3, session_id: 'parent', role: 'assistant', tool_calls: JSON.stringify([{ id: 'call-1', function: { name: 'terminal', arguments: '{"command":"pwd"}' } }]) },
    { id: 4, session_id: 'parent', role: 'tool', tool_call_id: 'call-1', tool_name: 'terminal', content: '/srv/app' },
    { id: 5, session_id: 'parent', role: 'user', content: '继续' },
    { id: 6, session_id: 'child', role: 'user', content: '继续' },
    { id: 7, session_id: 'child', role: 'assistant', content: '完成' },
  ], lineage);

  assert.deepEqual(turns.map(turn => turn.user), ['检查目录', '继续']);
  assert.deepEqual(turns[0].events.map(event => event.kind), ['reasoning', 'tool']);
  assert.equal(turns[0].events[0].kind, 'reasoning');
  assert.equal(turns[0].events[0].content, '先看目录');
  const tool = turns[0].events.find(event => event.kind === 'tool');
  assert.ok(tool);
  assert.equal(tool.callId, 'call-1');
  assert.equal(tool.name, 'terminal');
  assert.deepEqual(tool.input, { command: 'pwd' });
  assert.equal(tool.result, '/srv/app');
  assert.equal(tool.error, false);
  assert.equal(tool.unmatched, false);
  assert.deepEqual(tool.raw.map(row => row.id), [3, 4]);
  assert.deepEqual(turns[1].events.map(event => event.kind === 'assistant' ? event.content : ''), ['完成']);
});

test('普通 branch 不并入 parent，未配对工具结果保留边界提示状态', () => {
  /** 场景：分支是独立对话，孤立 tool result 不得伪装为正文。 */
  const lineage = hermesLineageIds([
    { id: 'parent', end_reason: 'compression' },
    { id: 'branch', parent_session_id: 'parent', model_config: '{"_branched_from":true}' },
  ], 'branch');
  assert.deepEqual(lineage, ['branch']);

  const [turn] = normalizeHermesTranscript([
    { id: 1, session_id: 'branch', role: 'tool', tool_call_id: 'missing', tool_name: 'terminal', content: 'orphan output' },
  ], lineage);
  const [tool] = turn.events;
  assert.equal(tool.kind, 'tool');
  assert.equal(tool.unmatched, true);
  assert.equal(tool.result, 'orphan output');
});

test('结构化 reasoning 去重，工具输入有界且错误结果保留状态', () => {
  /** 场景：真实 provider 的 reasoning_details 与失败工具不得重复或撑爆页面。 */
  const oversized = 'x'.repeat(50 * 1024);
  const [turn] = normalizeHermesTranscript([
    { id: 1, session_id: 'session', role: 'user', content: '执行检查' },
    {
      id: 2,
      session_id: 'session',
      role: 'assistant',
      reasoning_content: '先检查权限',
      reasoning_details: JSON.stringify([
        { type: 'reasoning.summary', summary: '先检查权限' },
        { type: 'reasoning.text', text: '再执行命令' },
      ]),
      tool_calls: [{ id: 'failed-call', function: { name: 'terminal', arguments: JSON.stringify({ command: oversized }) } }],
    },
    {
      id: 3,
      session_id: 'session',
      role: 'tool',
      tool_call_id: 'failed-call',
      tool_name: 'terminal',
      content: JSON.stringify({ success: false, error: 'permission denied' }),
    },
  ], ['session']);

  assert.deepEqual(turn.events.filter(event => event.kind === 'reasoning').map(event => event.content), [
    '先检查权限',
    '再执行命令',
  ]);
  const tool = turn.events.find(event => event.kind === 'tool');
  assert.ok(tool);
  assert.match(JSON.stringify(tool.input), /tool input truncated/);
  assert.equal(tool.error, true);
});

test('多个无 call id 的孤立工具结果仍生成唯一稳定键', () => {
  /** 场景：损坏或旧版记录不应让 React 以重复空 key 合并工具卡片。 */
  const [turn] = normalizeHermesTranscript([
    { id: 1, session_id: 'session', role: 'tool', tool_name: 'first', content: 'one' },
    { id: 2, session_id: 'session', role: 'tool', tool_name: 'second', content: 'two' },
  ], ['session']);

  const tools = turn.events.filter(event => event.kind === 'tool');
  assert.equal(new Set(tools.map(tool => tool.callId)).size, 2);
  assert.ok(tools.every(tool => tool.callId));
});

test('有序事件按 OZW fallback 保留 reasoning、工具、commentary、后续 reasoning 与 final', () => {
  /** 场景：同一 assistant 行稳定按 reasoning → tool → content，结果只能回填而不能移动工具事件。 */
  const [turn] = normalizeHermesTranscript([
    { id: 1, session_id: 'ordered', role: 'user', content: '检查并修复', timestamp: 10 },
    {
      id: 2,
      session_id: 'ordered',
      role: 'assistant',
      content: '先检查配置。',
      reasoning_content: '先定位问题',
      tool_calls: [{ id: 'read-1', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }],
      timestamp: 20,
    },
    { id: 3, session_id: 'ordered', role: 'tool', tool_call_id: 'read-1', content: 'bad config', timestamp: 30 },
    {
      id: 4,
      session_id: 'ordered',
      role: 'assistant',
      content: '现在修复配置。',
      reasoning_content: '确认问题后修复',
      tool_calls: [{ id: 'write-1', function: { name: 'write_file', arguments: '{"path":"a.ts"}' } }],
      timestamp: 40,
    },
    { id: 5, session_id: 'ordered', role: 'tool', tool_call_id: 'write-1', content: 'written', timestamp: 50 },
    { id: 6, session_id: 'ordered', role: 'assistant', content: '修复完成。', timestamp: 60 },
  ], ['ordered']);

  assert.deepEqual(turn.events.map(event => (
    event.kind === 'assistant'
      ? `${event.kind}:${event.phase}:${event.content}`
      : event.kind === 'reasoning'
        ? `${event.kind}:${event.content}`
        : `${event.kind}:${event.name}:${event.result}`
  )), [
    'reasoning:先定位问题',
    'tool:read_file:bad config',
    'assistant:commentary:先检查配置。',
    'reasoning:确认问题后修复',
    'tool:write_file:written',
    'assistant:commentary:现在修复配置。',
    'assistant:final:修复完成。',
  ]);
  assert.deepEqual(turn.events.slice(0, 3).map(event => event.kind), ['reasoning', 'tool', 'assistant']);
  assert.deepEqual(turn.events.slice(0, 3).map(event => event.rowId), [2, 2, 2]);
  assert.equal(turn.events[2].kind, 'assistant');
  assert.equal(turn.events[2].phase, 'commentary');
  assert.equal(turn.timestamp, 10);
  assert.equal(turn.events[0].timestamp, 20);
  assert.equal(turn.events.at(-1)?.timestamp, 60);
  assert.equal(new Set(turn.events.map(event => event.key)).size, turn.events.length);
});

test('reasoning 只在同一行别名间去重，不跨工具边界吞掉重复文本', () => {
  /** 场景：模型在工具前后重复同一句思考，两次都是独立过程事件。 */
  const [turn] = normalizeHermesTranscript([
    { id: 1, session_id: 'repeat', role: 'user', content: '继续' },
    {
      id: 2,
      session_id: 'repeat',
      role: 'assistant',
      reasoning: '再检查一次',
      reasoning_content: '再检查一次',
      reasoning_details: [{ type: 'reasoning.summary', summary: '再检查一次' }],
      tool_calls: [{ id: 'check', function: { name: 'terminal', arguments: '{}' } }],
    },
    { id: 3, session_id: 'repeat', role: 'tool', tool_call_id: 'check', content: 'ok' },
    { id: 4, session_id: 'repeat', role: 'assistant', reasoning_content: '再检查一次', content: '完成' },
  ], ['repeat']);

  assert.deepEqual(turn.events.filter(event => event.kind === 'reasoning').map(event => event.content), [
    '再检查一次',
    '再检查一次',
  ]);
  assert.deepEqual(turn.events.map(event => event.kind), ['reasoning', 'tool', 'reasoning', 'assistant']);
});

test('重复 call id 仅在当前 turn 和 session 的 open call 中配对', () => {
  /** 场景：provider 在两个用户 turn 复用 call id，第二个结果不得覆盖第一个工具卡。 */
  const turns = normalizeHermesTranscript([
    { id: 1, session_id: 'duplicate', role: 'user', content: '第一次' },
    { id: 2, session_id: 'duplicate', role: 'assistant', tool_calls: [{ id: 'same', function: { name: 'first', arguments: '{}' } }] },
    { id: 3, session_id: 'duplicate', role: 'tool', tool_call_id: 'same', content: 'first result' },
    { id: 4, session_id: 'duplicate', role: 'user', content: '第二次' },
    { id: 5, session_id: 'duplicate', role: 'assistant', tool_calls: [{ id: 'same', function: { name: 'second', arguments: '{}' } }] },
    { id: 6, session_id: 'duplicate', role: 'tool', tool_call_id: 'same', content: 'second result' },
  ], ['duplicate']);

  const tools = turns.map(turn => turn.events.find(event => event.kind === 'tool'));
  assert.equal(tools[0]?.kind, 'tool');
  assert.equal(tools[1]?.kind, 'tool');
  assert.equal(tools[0]?.result, 'first result');
  assert.equal(tools[1]?.result, 'second result');
  assert.notEqual(tools[0]?.key, tools[1]?.key);
});

test('Claude thinking 字段可见，redacted thinking 不泄漏，孤立结果保持原位置', () => {
  /** 场景：Anthropic 持久化 thinking blocks，且损坏历史包含无调用的工具结果。 */
  const [turn] = normalizeHermesTranscript([
    { id: 1, session_id: 'claude', role: 'user', content: '分析' },
    {
      id: 2,
      session_id: 'claude',
      role: 'assistant',
      reasoning_details: [
        { type: 'thinking', thinking: '检查依赖关系', signature: 'secret-signature' },
        { type: 'redacted_thinking', data: 'opaque-secret' },
      ],
    },
    { id: 3, session_id: 'claude', role: 'tool', tool_call_id: 'missing', tool_name: 'terminal', content: 'orphan' },
    { id: 4, session_id: 'claude', role: 'assistant', content: '分析完成' },
  ], ['claude']);

  assert.deepEqual(turn.events.map(event => event.kind), ['reasoning', 'tool', 'assistant']);
  assert.equal(turn.events[0].kind, 'reasoning');
  assert.equal(turn.events[0].content, '检查依赖关系');
  const orphan = turn.events[1];
  assert.equal(orphan.kind, 'tool');
  assert.equal(orphan.unmatched, true);
  assert.equal(orphan.result, 'orphan');
  const visibleEvents = turn.events.map(({ raw: _raw, ...event }) => event);
  assert.doesNotMatch(JSON.stringify(visibleEvents), /secret-signature|opaque-secret/);
});

test('lineage rank 优先于跨 session row id，并在边界去重 user echo', () => {
  /** 场景：导入历史的父行 ID 大于子行 ID，逻辑顺序仍必须由 lineage 决定。 */
  const [turn] = normalizeHermesTranscript([
    { id: 2, session_id: 'child', role: 'assistant', content: '继续完成', timestamp: 300 },
    { id: 1, session_id: 'child', role: 'user', content: '继续', timestamp: 200 },
    { id: 100, session_id: 'parent', role: 'user', content: '继续', timestamp: 100 },
  ], ['parent', 'child']);

  assert.equal(turn.user, '继续');
  assert.deepEqual(turn.raw.map(row => `${row.session_id}:${row.id}`), ['parent:100', 'child:1', 'child:2']);
  assert.deepEqual(turn.events.map(event => event.kind === 'assistant' ? event.content : ''), ['继续完成']);
  assert.equal(turn.key, 'hermes-turn-parent-100');
});
