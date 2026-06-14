// @ts-nocheck -- Proposal contract test uses browser-injected WebSocket helpers.
// Sources: 2026-06-06-80-修复文件操作JSON渲染为卡片
/**
 * 文件目的：验证 Codex add/edit/write/update 文件操作 JSON 不再直接显示为聊天正文。
 *
 * 业务场景：Codex live 或 JSONL replay 把文件操作包在 agent_message 文本里时，
 * ozw 必须把它归一成文件操作卡片，避免用户看到 provider 协议 JSON。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { PLAYWRIGHT_FIXTURE_HOME } from '../e2e/helpers/playwright-fixture.ts';
import {
  PRIMARY_FIXTURE_PROJECT_PATH,
  authenticatePage,
  resetWorkspaceProject,
} from './helpers/spec-test-helpers.ts';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results/proposal-80-file-operation-json-cards');
const PROPOSAL_88_EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results/proposal-88-ws-live-rendering');
const SESSION_DAY = ['2026', '06', '06'];
const FILE_OPERATIONS = [
  {
    type: 'add',
    path: 'src/proposal80-add.ts',
    content: 'export const proposal80Add = true;',
  },
  {
    type: 'edit',
    path: 'src/proposal80-edit.ts',
    old_string: 'export const proposal80Edit = "before";',
    new_string: 'export const proposal80Edit = "after";',
  },
  {
    type: 'write',
    path: 'docs/proposal80-write.md',
    content: '# proposal 80 write body',
  },
  {
    type: 'update',
    path: 'src/proposal80-update.ts',
    content: 'export const proposal80Update = "next";',
  },
  {
    type: 'update',
    path: path.join(PRIMARY_FIXTURE_PROJECT_PATH, 'src/proposal80-absolute.ts'),
    displayPath: 'src/proposal80-absolute.ts',
    content: 'export const proposal80Absolute = "next";',
  },
];

/**
 * Resolve the real Codex JSONL fixture path used by ozw session loading.
 */
function codexSessionPath(sessionId: string): string {
  /** docstring：把测试数据放入真实 read model 会扫描的隔离 HOME。 */
  return path.join(PLAYWRIGHT_FIXTURE_HOME, '.codex', 'sessions', ...SESSION_DAY, `${sessionId}.jsonl`);
}

/**
 * Persist one Codex JSONL session with provider-shaped assistant rows.
 */
async function writeCodexSession(sessionId: string, assistantRows: Array<Record<string, unknown>>): Promise<void> {
  /** docstring：通过 JSONL 文件触发真实后端解析，而不是直接塞前端状态。 */
  const sessionPath = codexSessionPath(sessionId);
  await fs.mkdir(path.dirname(sessionPath), { recursive: true });
  const entries = [
    {
      type: 'session_meta',
      timestamp: '2026-06-06T08:00:00.000Z',
      payload: {
        id: sessionId,
        cwd: PRIMARY_FIXTURE_PROJECT_PATH,
        model: 'gpt-5-codex',
      },
    },
    ...assistantRows,
  ];
  await fs.writeFile(sessionPath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
}

/**
 * Convert a provider file operation into the raw JSON string that previously leaked.
 */
function fileOperationJson(operation: Record<string, unknown>): string {
  /** docstring：保留紧凑 JSON，方便断言 raw 字段没有进入 transcript。 */
  return JSON.stringify(operation);
}

/**
 * Build Codex JSONL assistant message rows whose output_text is file-operation JSON.
 */
function buildJsonlFileOperationRows(): Array<Record<string, unknown>> {
  /** docstring：模拟 provider 已把文件操作写入 JSONL message 文本的刷新场景。 */
  return [
    {
      type: 'response_item',
      timestamp: '2026-06-06T08:00:01.000Z',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: '80 提案 Codex 真实正文必须保留。' }],
      },
    },
    ...FILE_OPERATIONS.map((operation, index) => ({
      type: 'response_item',
      timestamp: `2026-06-06T08:00:0${index + 2}.000Z`,
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: fileOperationJson(operation) }],
      },
    })),
  ];
}

/**
 * Install a fake WebSocket so the test can emit Codex live events through the browser path.
 */
async function installCodexRuntimeSocket(page): Promise<void> {
  /** docstring：只替换传输层，保留真实 React reducer 和 DOM 渲染。 */
  await page.addInitScript(() => {
    class FakeWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      constructor(url) {
        super();
        this.url = url;
        this.readyState = FakeWebSocket.OPEN;
        window.__proposal80Socket = this;
        setTimeout(() => {
          this.__opened = true;
          this.onopen?.({ type: 'open' });
          this.dispatchEvent(new Event('open'));
        }, 0);
      }

      send(payload) {
        window.__proposal80SentMessages = window.__proposal80SentMessages || [];
        try {
          window.__proposal80SentMessages.push(JSON.parse(payload));
        } catch {
          window.__proposal80SentMessages.push(payload);
        }
        this.__ozwCodexBridge = true;
      }

      close() {
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.({ type: 'close' });
        this.dispatchEvent(new Event('close'));
      }
    }

    window.WebSocket = FakeWebSocket;
    window.__proposal80EmitWs = (message) => {
      const socket = window.__proposal80Socket;
      const sessionId = window.location.pathname.split('/').filter(Boolean).pop();
      const event = new MessageEvent('message', {
        data: JSON.stringify({ sessionId, provider: 'codex', ...message }),
      });
      socket?.onmessage?.(event);
      socket?.dispatchEvent?.(event);
    };
  });
}

/**
 * Open a Codex session route with explicit project context.
 */
async function openCodexSession(page, sessionId: string): Promise<void> {
  /** docstring：通过真实会话 URL 触发 ozw 的 session messages 加载和 chat 渲染。 */
  const query = new URLSearchParams({
    provider: 'codex',
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
  });
  await page.goto(`/session/${sessionId}?${query.toString()}`, { waitUntil: 'networkidle' });
}

/**
 * Emit one live Codex agent message whose content is raw file-operation JSON.
 */
async function emitLiveFileOperation(page, operation: Record<string, unknown>): Promise<void> {
  /** docstring：复现用户看到的 add/edit/write/update JSON 从 live agent_message 进入前端。 */
  await page.evaluate((content) => {
    const parsed = JSON.parse(content);
    const itemKey = `${parsed.type}-${parsed.path}`.replace(/[^A-Za-z0-9_-]/g, '-');
    window.__proposal80EmitWs({
      type: 'codex-response',
      data: {
        type: 'item',
        itemType: 'agent_message',
        itemId: `proposal80-${itemKey}`,
        message: {
          role: 'assistant',
          content,
        },
      },
    });
  }, fileOperationJson(operation));
}

/**
 * Emit one first-class Codex file_change item whose changes array is already
 * structured by the native runtime.
 */
async function emitLiveFileChangeItem(page, changes: Array<Record<string, unknown>>): Promise<void> {
  /** docstring：直接覆盖 proposal 88 的 file_change.changes[] WS payload，而不是 agent_message JSON 兼容路径。 */
  await page.evaluate((fileChanges) => {
    window.__proposal80EmitWs({
      type: 'codex-response',
      data: {
        type: 'item',
        itemType: 'file_change',
        itemId: 'proposal88-file-change-item',
        changes: fileChanges,
        status: 'completed',
      },
    });
  }, changes);
}

/**
 * Emit a live Codex assistant message containing business JSON, not file bookkeeping.
 */
async function emitLiveBusinessJson(page): Promise<void> {
  /** docstring：验证带 path 的普通业务 JSON 不被文件操作过滤逻辑误删。 */
  await page.evaluate((content) => {
    window.__proposal80EmitWs({
      type: 'codex-response',
      data: {
        type: 'item',
        itemType: 'agent_message',
        itemId: 'proposal80-business-json-live',
        message: {
          role: 'assistant',
          content,
        },
      },
    });
  }, JSON.stringify({
    type: 'report',
    path: 'roadmap.json',
    content: '业务 JSON 输出必须保留',
  }));
}

async function emitLiveThinkingWithSameItemId(page): Promise<void> {
  /** docstring：复现同 itemId 下正文和 reasoning 共存时，reasoning 必须首帧就是 thinking 行。 */
  await page.evaluate(() => {
    window.__proposal80EmitWs({
      type: 'codex-response',
      data: {
        type: 'item',
        itemType: 'agent_message',
        itemId: 'proposal88-thinking-same-item',
        message: {
          role: 'assistant',
          content: 'proposal 88 普通正文必须保持正文。',
        },
      },
    });
    window.__proposal80EmitWs({
      type: 'codex-response',
      data: {
        type: 'item',
        itemType: 'reasoning',
        itemId: 'proposal88-thinking-same-item',
        message: {
          role: 'assistant',
          content: 'proposal 88 thinking 首次显示即为思考块。',
        },
      },
    });
  });
}

/**
 * Assert all file operations are rendered as cards and raw JSON does not leak.
 */
async function assertFileOperationCards(page, scenario: string): Promise<Record<string, unknown>> {
  /** docstring：断言用户看到的是卡片和路径，而不是 provider 协议字段。 */
  const transcript = page.locator('[data-testid="chat-scroll-container"]').last();
  const cards = page.getByTestId('codex-tool-card');

  for (const operation of FILE_OPERATIONS) {
    const expectedPath = operation.displayPath || operation.path;
    await expect(cards.filter({ hasText: expectedPath }).first(), `${scenario}: ${operation.type} must render as a card`).toBeVisible({ timeout: 20_000 });
    if (operation.displayPath) {
      await expect(cards.filter({ hasText: operation.path })).toHaveCount(0);
    }
  }

  await expect(transcript.getByText('JSON Response')).toHaveCount(0);
  await expect(transcript.getByText(/"type"\s*:/)).toHaveCount(0);
  await expect(transcript.getByText(/"content"\s*:/)).toHaveCount(0);

  return transcript.evaluate((node) => {
    const toolCards = [...node.querySelectorAll('[data-testid="codex-tool-card"]')];
    return {
      transcriptText: node.textContent || '',
      cardTexts: toolCards.map((card) => card.textContent || ''),
      leakedTypeField: /"type"\s*:/.test(node.textContent || ''),
      leakedContentField: /"content"\s*:/.test(node.textContent || ''),
    };
  });
}

/**
 * Store screenshots and JSON evidence for execution-stage review.
 */
async function writeEvidence(page, name: string, evidence: Record<string, unknown>): Promise<void> {
  /** docstring：把可复查证据落盘，避免只依赖测试失败文本。 */
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `${name}.png`), fullPage: true });
  await fs.writeFile(
    path.join(EVIDENCE_DIR, `${name}.json`),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), ...evidence }, null, 2)}\n`,
    'utf8',
  );
}

async function writeProposal88Evidence(page, name: string, evidence: Record<string, unknown>): Promise<void> {
  /** docstring：为 proposal 88 复用同一真实浏览器路径保存验收证据。 */
  await fs.mkdir(PROPOSAL_88_EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(PROPOSAL_88_EVIDENCE_DIR, `${name}.png`), fullPage: true });
  await fs.writeFile(
    path.join(PROPOSAL_88_EVIDENCE_DIR, `${name}.json`),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), ...evidence }, null, 2)}\n`,
    'utf8',
  );
}

test.beforeEach(async ({ page }) => {
  await resetWorkspaceProject();
  await authenticatePage(page);
  await page.addInitScript(() => {
    window.localStorage.setItem('selected-provider', 'codex');
  });
});

test('Codex live add/edit/write/update 文件操作 JSON 渲染为工具卡片', async ({ page }) => {
  /**
   * 业务场景：运行中的 Codex 把文件操作作为 agent_message JSON 推给前端。
   * 失败含义：文件操作仍被显示成 raw JSON，或被静默吞掉没有卡片。
   */
  const sessionId = 'proposal80-live-file-operation-json';
  await installCodexRuntimeSocket(page);
  await writeCodexSession(sessionId, buildJsonlFileOperationRows().slice(0, 1));
  await openCodexSession(page, sessionId);
  await expect(page.getByText('80 提案 Codex 真实正文必须保留。')).toBeVisible({ timeout: 20_000 });

  for (const operation of FILE_OPERATIONS) {
    await emitLiveFileOperation(page, operation);
  }

  const snapshot = await assertFileOperationCards(page, 'live');
  await writeEvidence(page, 'live-file-operation-cards', snapshot);
});

test('Codex live file_change changes 数组渲染为工具卡片', async ({ page }) => {
  /**
   * 业务场景：Codex WS native runtime 直接推送 file_change.changes[]。
   * 失败含义：验收截图没有覆盖真实 live file_change payload，或页面仍显示 raw protocol。
   */
  const sessionId = 'proposal88-live-file-change-array';
  await installCodexRuntimeSocket(page);
  await writeCodexSession(sessionId, buildJsonlFileOperationRows().slice(0, 1));
  await openCodexSession(page, sessionId);
  await expect(page.getByText('80 提案 Codex 真实正文必须保留。')).toBeVisible({ timeout: 20_000 });

  await emitLiveFileChangeItem(page, [
    { kind: 'update', path: 'src/proposal88-live-file-change.ts' },
  ]);

  const transcript = page.locator('[data-testid="chat-scroll-container"]').last();
  const cards = page.getByTestId('codex-tool-card');
  await expect(cards.filter({ hasText: 'src/proposal88-live-file-change.ts' }).first()).toBeVisible({ timeout: 20_000 });
  await expect(transcript.getByText('JSON Response')).toHaveCount(0);
  await expect(transcript.getByText(/"itemType"\s*:/)).toHaveCount(0);
  const snapshot = await transcript.evaluate((node) => {
    const toolCards = [...node.querySelectorAll('[data-testid="codex-tool-card"]')];
    return {
      transcriptText: node.textContent || '',
      cardTexts: toolCards.map((card) => card.textContent || ''),
      livePayload: {
        type: 'item',
        itemType: 'file_change',
        changes: [{ kind: 'update', path: 'src/proposal88-live-file-change.ts' }],
      },
    };
  });
  await writeProposal88Evidence(page, 'live-file-change-card', snapshot);
});

test('Codex live 普通业务 JSON 即使包含 path 也必须保留', async ({ page }) => {
  /**
   * 业务场景：Codex 正常回答可能输出带 type/path/content 的业务 JSON。
   * 失败含义：如果这里失败，文件操作过滤把用户需要阅读的普通 JSON 静默误删。
   */
  const sessionId = 'proposal80-live-business-json';
  await installCodexRuntimeSocket(page);
  await writeCodexSession(sessionId, buildJsonlFileOperationRows().slice(0, 1));
  await openCodexSession(page, sessionId);
  await expect(page.getByText('80 提案 Codex 真实正文必须保留。')).toBeVisible({ timeout: 20_000 });

  await emitLiveBusinessJson(page);

  const transcript = page.locator('[data-testid="chat-scroll-container"]').last();
  await expect(transcript).toContainText('业务 JSON 输出必须保留', { timeout: 20_000 });
  await expect(page.getByTestId('codex-tool-card').filter({ hasText: 'roadmap.json' })).toHaveCount(0);
  const snapshot = await transcript.evaluate((node) => ({
    transcriptText: node.textContent || '',
    roadmapCardCount: node.querySelectorAll('[data-testid="codex-tool-card"]').length,
  }));
  await writeProposal88Evidence(page, 'live-business-json', snapshot);
});

test('Codex live reasoning 首次显示为独立 thinking 样式', async ({ page }) => {
  /**
   * 业务场景：Codex 同 itemId 先后推送正文与 reasoning。
   * 失败含义：reasoning 复用正文 row，会造成普通正文到 thinking 的样式跳变。
   */
  const consoleEntries: Array<Record<string, unknown>> = [];
  page.on('console', (message) => {
    consoleEntries.push({ type: message.type(), text: message.text() });
  });
  page.on('pageerror', (error) => {
    consoleEntries.push({ type: 'pageerror', text: error.message });
  });

  const sessionId = 'proposal88-live-thinking-stable';
  await installCodexRuntimeSocket(page);
  await writeCodexSession(sessionId, buildJsonlFileOperationRows().slice(0, 1));
  await openCodexSession(page, sessionId);
  await expect(page.getByText('80 提案 Codex 真实正文必须保留。')).toBeVisible({ timeout: 20_000 });

  await emitLiveThinkingWithSameItemId(page);

  const transcript = page.locator('[data-testid="chat-scroll-container"]').last();
  await expect(transcript).toContainText('proposal 88 普通正文必须保持正文。', { timeout: 20_000 });
  await expect(transcript).toContainText('proposal 88 thinking 首次显示即为思考块。', { timeout: 20_000 });
  await writeProposal88Evidence(page, 'thinking-stable', {
    transcriptText: await transcript.textContent(),
  });
  await fs.mkdir(PROPOSAL_88_EVIDENCE_DIR, { recursive: true });
  await fs.writeFile(
    path.join(PROPOSAL_88_EVIDENCE_DIR, 'console.json'),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), entries: consoleEntries }, null, 2)}\n`,
    'utf8',
  );
});

test('Codex JSONL replay add/edit/write/update 文件操作 JSON 刷新后仍渲染为工具卡片', async ({ page }) => {
  /**
   * 业务场景：用户刷新已有 Codex 会话，前端从 JSONL 历史恢复文件操作。
   * 失败含义：live 修复没有覆盖持久历史，刷新后又显示 raw JSON。
   */
  const sessionId = 'proposal80-jsonl-file-operation-json';
  await writeCodexSession(sessionId, buildJsonlFileOperationRows());
  await openCodexSession(page, sessionId);

  const beforeReload = await assertFileOperationCards(page, 'jsonl-before-reload');
  await page.reload({ waitUntil: 'networkidle' });
  const afterReload = await assertFileOperationCards(page, 'jsonl-after-reload');
  await writeEvidence(page, 'jsonl-file-operation-cards', { beforeReload, afterReload });
});
