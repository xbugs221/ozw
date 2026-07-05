/**
 * Sources: 2026-07-06-36-双Provider聊天TUI优先与终端保活渲染快照
 *
 * PURPOSE: Verify user-triggered JSONL render snapshots stay frozen until the
 * user explicitly renders again.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

type SnapshotMessage = {
  messageKey: string;
  content: string;
};

type RenderSnapshotState = {
  mode: 'tui' | 'renderedSnapshot';
  tuiSessionKey: string;
  snapshotVersion: number;
  snapshotMessages: SnapshotMessage[];
  loadedAt: string | null;
};

const REPO_ROOT = process.cwd();
const SNAPSHOT_CONTROLLER_PATH = path.join(
  REPO_ROOT,
  'frontend',
  'components',
  'chat',
  'session',
  'renderSnapshotController.ts',
);

/**
 * Load the production snapshot controller and verify its public contract.
 */
async function loadSnapshotController(): Promise<{
  createInitialRenderSnapshotState: (input: { tuiSessionKey: string }) => RenderSnapshotState;
  applyUserRenderSnapshot: (
    state: RenderSnapshotState,
    input: { messages: SnapshotMessage[]; loadedAt: string },
  ) => RenderSnapshotState;
  shouldIgnoreSnapshotAutoRefresh: (
    state: RenderSnapshotState,
    event: { type: string },
  ) => boolean;
  returnToTuiMode: (state: RenderSnapshotState) => RenderSnapshotState;
}> {
  assert.equal(
    fs.existsSync(SNAPSHOT_CONTROLLER_PATH),
    true,
    '缺少 frontend/components/chat/session/renderSnapshotController.ts，尚未实现 JSONL 渲染快照控制器',
  );
  const moduleExports = await import(pathToFileURL(SNAPSHOT_CONTROLLER_PATH).href);
  for (const symbol of [
    'createInitialRenderSnapshotState',
    'applyUserRenderSnapshot',
    'shouldIgnoreSnapshotAutoRefresh',
    'returnToTuiMode',
  ]) {
    assert.equal(typeof moduleExports[symbol], 'function', `renderSnapshotController.ts 必须导出 ${symbol}`);
  }
  return moduleExports as any;
}

test('默认状态是 TUI 模式，且保留 TUI 会话键', async () => {
  const { createInitialRenderSnapshotState } = await loadSnapshotController();

  const state = createInitialRenderSnapshotState({ tuiSessionKey: 'project:codex:c1' });

  assert.equal(state.mode, 'tui');
  assert.equal(state.tuiSessionKey, 'project:codex:c1');
  assert.equal(state.snapshotVersion, 0);
  assert.deepEqual(state.snapshotMessages, []);
  assert.equal(state.loadedAt, null);
});

test('用户点击渲染后保存冻结 JSONL snapshot', async () => {
  const {
    createInitialRenderSnapshotState,
    applyUserRenderSnapshot,
  } = await loadSnapshotController();

  const initial = createInitialRenderSnapshotState({ tuiSessionKey: 'project:pi:c2' });
  const rendered = applyUserRenderSnapshot(initial, {
    loadedAt: '2026-07-05T12:00:00.000Z',
    messages: [
      { messageKey: 'user-1', content: '用户请求' },
      { messageKey: 'assistant-1', content: '已落盘回复' },
    ],
  });

  assert.equal(rendered.mode, 'renderedSnapshot');
  assert.equal(rendered.tuiSessionKey, 'project:pi:c2', '渲染快照不能改变 TUI 会话键');
  assert.equal(rendered.snapshotVersion, 1);
  assert.equal(rendered.loadedAt, '2026-07-05T12:00:00.000Z');
  assert.deepEqual(rendered.snapshotMessages.map((message) => message.messageKey), ['user-1', 'assistant-1']);
});

test('complete、projects_updated 和 externalMessageUpdate 不自动刷新已渲染快照', async () => {
  const {
    createInitialRenderSnapshotState,
    applyUserRenderSnapshot,
    shouldIgnoreSnapshotAutoRefresh,
  } = await loadSnapshotController();

  const state = applyUserRenderSnapshot(
    createInitialRenderSnapshotState({ tuiSessionKey: 'project:codex:c3' }),
    {
      loadedAt: '2026-07-05T12:00:00.000Z',
      messages: [{ messageKey: 'assistant-old', content: '旧快照' }],
    },
  );

  for (const eventType of ['projects_updated', 'codex-complete', 'pi-complete', 'externalMessageUpdate']) {
    assert.equal(
      shouldIgnoreSnapshotAutoRefresh(state, { type: eventType }),
      true,
      `${eventType} 不得自动刷新 renderedSnapshot`,
    );
  }
});

test('点击重新渲染才增加版本并替换 snapshot messages', async () => {
  const {
    createInitialRenderSnapshotState,
    applyUserRenderSnapshot,
  } = await loadSnapshotController();

  const first = applyUserRenderSnapshot(
    createInitialRenderSnapshotState({ tuiSessionKey: 'project:codex:c4' }),
    {
      loadedAt: '2026-07-05T12:00:00.000Z',
      messages: [{ messageKey: 'assistant-old', content: '旧快照' }],
    },
  );
  const second = applyUserRenderSnapshot(first, {
    loadedAt: '2026-07-05T12:05:00.000Z',
    messages: [{ messageKey: 'assistant-new', content: '用户重新渲染后的新快照' }],
  });

  assert.equal(second.snapshotVersion, 2);
  assert.deepEqual(second.snapshotMessages.map((message) => message.messageKey), ['assistant-new']);
  assert.equal(second.loadedAt, '2026-07-05T12:05:00.000Z');
});

test('返回 TUI 不清空已有快照，也不改变终端会话键', async () => {
  const {
    createInitialRenderSnapshotState,
    applyUserRenderSnapshot,
    returnToTuiMode,
  } = await loadSnapshotController();

  const rendered = applyUserRenderSnapshot(
    createInitialRenderSnapshotState({ tuiSessionKey: 'project:pi:c5' }),
    {
      loadedAt: '2026-07-05T12:00:00.000Z',
      messages: [{ messageKey: 'assistant-1', content: 'Pi 快照' }],
    },
  );
  const backToTui = returnToTuiMode(rendered);

  assert.equal(backToTui.mode, 'tui');
  assert.equal(backToTui.tuiSessionKey, 'project:pi:c5');
  assert.equal(backToTui.snapshotVersion, 1, '返回 TUI 不代表重新渲染');
  assert.deepEqual(backToTui.snapshotMessages, rendered.snapshotMessages, '快照可保留用于再次查看，但不能自动更新');
});
