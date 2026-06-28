/**
 * Sources: 2026-06-14-116-统一Pi与Codex聊天渲染反馈,
 * 2026-06-16-6-聊天Live渲染与工具卡片体系化,
 * 2026-06-28-33-回复结束折叠非正文内容
 *
 * PURPOSE: Verify Codex/Pi chat rendering parity with the real frontend
 * message component and merge utilities used by manual sessions.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test, { after } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { createServer, type ViteDevServer } from 'vite';
import type { ChatMessage, Provider } from '../../frontend/components/chat/types/types.ts';
import type { Project } from '../../frontend/types/app.ts';
import { mergePersistedAndOptimisticMessages } from '../../frontend/components/chat/utils/sessionMessageMerge.ts';
import {
  filterRenderableMessages,
  reduceNativeRuntimeEvent,
} from '../../frontend/components/chat/utils/nativeRuntimeTranscript.ts';
import { buildTurnDisplayBlocks } from '../../frontend/components/chat/utils/turnNonBodyCollapse.ts';
import { convertSessionMessages } from '../../frontend/components/chat/utils/messageTransforms.ts';

const REPO_ROOT = process.cwd();
const EVIDENCE_DIR = path.join(REPO_ROOT, 'test-results/chat-rendering-parity');
const FIXED_TIMESTAMP = '2026-06-10T12:00:05.000Z';
const CODEX_RESPONSE = 'proposal 116 codex websocket response body';
const USER_PROMPT = 'proposal 116 align codex live feedback';
const COMMAND = 'printf proposal-116-tool-card';
const COMMAND_OUTPUT = 'proposal-116-tool-card';
let viteServer: ViteDevServer | null = null;
let loadedMessageComponent: React.ComponentType<any> | null = null;
let loadedThemeProvider: React.ComponentType<any> | null = null;

after(async () => {
  /**
   * Close the Vite SSR server created for loading frontend components.
   */
  if (viteServer) {
    await viteServer.close();
    viteServer = null;
  }
});

/**
 * Build a minimal ChatMessage row while keeping tests close to production data.
 */
function row(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    type: 'assistant',
    content: '',
    timestamp: FIXED_TIMESTAMP,
    ...overrides,
  } as ChatMessage;
}

/**
 * Initialize the translation keys read by MessageComponent during server render.
 */
async function ensureI18n(): Promise<void> {
  if (i18next.isInitialized) {
    return;
  }

  await i18next.init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['chat'],
    defaultNS: 'chat',
    interpolation: { escapeValue: false },
    resources: {
      en: {
        chat: {
          messageTypes: {
            codex: 'Codex',
            pi: 'Pi',
            assistant: 'Assistant',
            error: 'Error',
          },
          json: {
            response: 'JSON response',
          },
          thinking: {
            collapse: 'Collapse',
            expand: 'Expand',
          },
          interactive: {
            title: 'Question',
            waiting: 'Waiting',
            instruction: 'Reply in the terminal',
          },
        },
      },
    },
  });
}

/**
 * Load MessageComponent through Vite so import.meta.env matches frontend runtime.
 */
async function loadMessageComponent(): Promise<React.ComponentType<any>> {
  if (loadedMessageComponent) {
    return loadedMessageComponent;
  }

  viteServer = await createServer({
    root: REPO_ROOT,
    logLevel: 'silent',
    server: {
      middlewareMode: true,
    },
  });
  const mod = await viteServer.ssrLoadModule('/frontend/components/chat/view/subcomponents/MessageComponent.tsx');
  loadedMessageComponent = mod.default;
  assert.ok(loadedMessageComponent, 'MessageComponent must load through Vite SSR');
  return loadedMessageComponent;
}

/**
 * Load the production ThemeProvider required by command-card content renderers.
 */
async function loadThemeProvider(): Promise<React.ComponentType<any>> {
  if (loadedThemeProvider) {
    return loadedThemeProvider;
  }

  if (!viteServer) {
    await loadMessageComponent();
  }
  assert.ok(viteServer, 'Vite SSR server must exist before loading ThemeProvider');
  const mod = await viteServer.ssrLoadModule('/frontend/contexts/ThemeContext.tsx');
  loadedThemeProvider = mod.ThemeProvider;
  assert.ok(loadedThemeProvider, 'ThemeProvider must load through Vite SSR');
  return loadedThemeProvider;
}

/**
 * Provide the browser globals read by ThemeProvider during server render.
 */
function ensureBrowserGlobals(): void {
  const globalRecord = globalThis as Record<string, any>;
  if (!globalRecord.localStorage) {
    const store = new Map<string, string>();
    globalRecord.localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    };
  }
  if (!globalRecord.window) {
    globalRecord.window = {
      matchMedia: () => ({
        matches: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    };
  }
}

/**
 * Render the same React component used by the chat transcript.
 */
async function renderMessage(
  message: ChatMessage,
  provider: Provider | string,
  selectedProject: Project | null = null,
  onFileOpen?: (filePath: string) => void,
): Promise<string> {
  await ensureI18n();
  const MessageComponent = await loadMessageComponent();
  const ThemeProvider = await loadThemeProvider();
  ensureBrowserGlobals();

  return renderToStaticMarkup(
    <I18nextProvider i18n={i18next}>
      <ThemeProvider>
        <MessageComponent
          message={message}
          index={0}
          prevMessage={null}
          createDiff={() => []}
          provider={provider}
          autoExpandTools={false}
          showRawParameters={false}
          showThinking={false}
          selectedProject={selectedProject}
          onFileOpen={onFileOpen}
        />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

/**
 * Persist an evidence artifact under test-results without requiring git tracking.
 */
async function writeEvidence(relativeName: string, content: string): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(path.join(EVIDENCE_DIR, relativeName), `${content}\n`, 'utf8');
}

/**
 * Read production source for static rendering contract checks.
 */
async function readSource(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * Remove volatile React attribute noise before comparing tool-card structures.
 */
function normalizeHtmlFingerprint(html: string): string {
  return html
    .replace(/data-message-key="[^"]*"/g, 'data-message-key=""')
    .replace(/data-delivery-status="[^"]*"/g, 'data-delivery-status=""')
    .replace(/\b(?:Codex|Pi)\b/g, 'Provider')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Approximate visible text from server-rendered HTML for business assertions.
 */
function visibleTextFromHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Summarize transcript rows in the fields users can observe.
 */
function transcriptState(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((message) => ({
    type: message.type,
    content: message.content,
    deliveryStatus: message.deliveryStatus,
    source: message.source,
    provider: message.provider,
    clientRequestId: message.clientRequestId,
    turnAnchorKey: message.turnAnchorKey,
    messageKey: message.messageKey,
  }));
}

/**
 * Build a completed turn containing thinking, batch tools and final body.
 */
function completedTurnRows(): ChatMessage[] {
  return [
    row({
      type: 'user',
      content: '请检查项目并运行必要测试',
      messageKey: 'turn-collapse-user',
    }),
    row({
      type: 'assistant',
      content: '我先阅读项目结构，再运行测试。',
      isThinking: true,
      messageKey: 'turn-collapse-thinking',
    }),
    row({
      type: 'assistant',
      isToolUse: true,
      toolName: 'batch_execute',
      toolCallId: 'turn-collapse-batch',
      toolInput: {
        commands: [
          { command: 'pnpm exec tsc --noEmit' },
          { command: 'pnpm exec vitest run' },
        ],
      },
      toolResult: { content: 'typecheck ok\nvitest ok' },
      messageKey: 'turn-collapse-batch-tool',
    }),
    row({
      type: 'assistant',
      isToolUse: true,
      toolName: 'Bash',
      toolCallId: 'turn-collapse-bash',
      toolInput: { command: 'pnpm exec playwright test smoke.spec.ts' },
      toolResult: { content: 'playwright smoke ok' },
      messageKey: 'turn-collapse-single-tool',
    }),
    row({
      type: 'assistant',
      content: '检查完成：类型检查、单元测试和冒烟测试都通过。',
      messageKey: 'turn-collapse-body',
    }),
  ];
}

test('Codex live assistant renders response text without Codex label or timestamp', async () => {
  /**
   * A WebSocket response is already inside an active Codex session; repeating
   * the provider name and row time adds no business information to the turn.
   */
  const html = await renderMessage(
    row({
      type: 'assistant',
      content: CODEX_RESPONSE,
      provider: 'codex',
      source: 'codex-live',
      messageKey: 'codex:proposal-116-live-response',
    }),
    'codex',
  );
  await writeEvidence('codex-live-render.html', html);

  assert.match(html, new RegExp(CODEX_RESPONSE), 'Codex live response body must stay visible');
  assert.doesNotMatch(html, />\s*Codex\s*</, 'Codex live response must not show the provider header');
  assert.doesNotMatch(html, /\b\d{1,2}:\d{2}(?::\d{2})?\b/, 'Codex live response must not show a row timestamp');
});

test('Codex live response waits until the matching user bubble is persisted', async () => {
  /**
   * The response should not appear while the user bubble is still blue/sent;
   * once the persisted echo arrives, the green user bubble becomes the anchor.
   */
  const sentUser = row({
    type: 'user',
    content: USER_PROMPT,
    submittedContent: USER_PROMPT,
    clientRequestId: 'proposal-116-turn',
    deliveryStatus: 'sent',
    messageKey: 'optimistic:proposal-116-turn',
    turnAnchorKey: 'proposal-116-turn',
  });
  const persistedUser = row({
    type: 'user',
    content: USER_PROMPT,
    clientRequestId: 'proposal-116-turn',
    messageKey: 'codex:proposal-116:line:1',
    turnAnchorKey: 'proposal-116-turn',
  });
  const liveAssistant = row({
    type: 'assistant',
    content: CODEX_RESPONSE,
    provider: 'codex',
    source: 'codex-live',
    messageKey: 'codex:proposal-116-live-response',
    turnAnchorKey: 'proposal-116-turn',
  });

  const beforePersisted = mergePersistedAndOptimisticMessages(
    [],
    [sentUser, liveAssistant],
    { sessionId: 'proposal-116-before-persisted' },
  );
  const afterPersisted = mergePersistedAndOptimisticMessages(
    [persistedUser],
    [sentUser, liveAssistant],
    { sessionId: 'proposal-116-after-persisted' },
  );
  await writeEvidence('codex-live-merge-state.json', JSON.stringify({
    beforePersisted: transcriptState(beforePersisted),
    afterPersisted: transcriptState(afterPersisted),
  }, null, 2));

  assert.equal(
    beforePersisted.some((message) => message.type === 'assistant' && message.content === CODEX_RESPONSE),
    false,
    'Codex live assistant must not be visible before the user bubble is persisted/green',
  );

  const userIndex = afterPersisted.findIndex((message) => message.type === 'user' && message.content === USER_PROMPT);
  const assistantIndex = afterPersisted.findIndex((message) => message.type === 'assistant' && message.content === CODEX_RESPONSE);
  assert.notEqual(userIndex, -1, 'persisted user row must stay visible');
  assert.equal(afterPersisted[userIndex].deliveryStatus, 'persisted', 'matched user row must be green/persisted');
  assert.ok(assistantIndex > userIndex, 'Codex live assistant must appear after the green user bubble');
});

test('Codex first-turn live response waits when only clientRequestId exists', async () => {
  /**
   * A first turn has no durable anchor yet. The runtime must still attach the
   * client request identity so the merge layer can keep the response hidden
   * until the persisted green user bubble arrives.
   */
  const sentUser = row({
    type: 'user',
    content: USER_PROMPT,
    submittedContent: USER_PROMPT,
    clientRequestId: 'proposal-116-first-client',
    deliveryStatus: 'sent',
    messageKey: 'optimistic:proposal-116-first-client',
  });
  const runtimeRows = filterRenderableMessages(reduceNativeRuntimeEvent([sentUser], {
    type: 'codex-response',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'proposal-116-first-live',
      message: { role: 'assistant', content: CODEX_RESPONSE },
      status: 'completed',
    },
  })) as ChatMessage[];
  const runtimeAssistant = runtimeRows.find((message) => (
    message.type === 'assistant' && message.source === 'codex-live'
  ));
  assert.equal(
    runtimeAssistant?.clientRequestId,
    'proposal-116-first-client',
    'Codex live row must inherit clientRequestId when no durable anchor exists',
  );

  const beforePersisted = mergePersistedAndOptimisticMessages(
    [],
    runtimeRows,
    { sessionId: 'proposal-116-client-request-before-persisted' },
  );
  const persistedUser = row({
    type: 'user',
    content: USER_PROMPT,
    clientRequestId: 'proposal-116-first-client',
    messageKey: 'codex:proposal-116:first:line:1',
  });
  const afterPersisted = mergePersistedAndOptimisticMessages(
    [persistedUser],
    runtimeRows,
    { sessionId: 'proposal-116-client-request-after-persisted' },
  );
  await writeEvidence('codex-live-client-request-merge-state.json', JSON.stringify({
    runtimeRows: transcriptState(runtimeRows),
    beforePersisted: transcriptState(beforePersisted),
    afterPersisted: transcriptState(afterPersisted),
  }, null, 2));

  assert.equal(
    beforePersisted.some((message) => message.type === 'assistant' && message.content === CODEX_RESPONSE),
    false,
    'clientRequestId-only Codex live assistant must wait for persisted user echo',
  );
  const userIndex = afterPersisted.findIndex((message) => message.type === 'user' && message.content === USER_PROMPT);
  const assistantIndex = afterPersisted.findIndex((message) => message.type === 'assistant' && message.content === CODEX_RESPONSE);
  assert.notEqual(userIndex, -1, 'clientRequestId persisted user row must stay visible');
  assert.equal(afterPersisted[userIndex].deliveryStatus, 'persisted', 'clientRequestId matched user row must be green/persisted');
  assert.ok(assistantIndex > userIndex, 'clientRequestId-only live assistant must appear after persisted user');
});

test('Pi command tool card uses the same visible structure as Codex command tool card', async () => {
  /**
   * Provider identity must not choose a different command-card chrome; Pi and
   * Codex should only differ by the underlying message provider metadata.
   */
  const codexTool = row({
    type: 'assistant',
    provider: 'codex',
    source: 'codex-live',
    isToolUse: true,
    toolName: 'Bash',
    toolInput: { command: COMMAND },
    toolResult: { content: COMMAND_OUTPUT, isError: false },
    toolCallId: 'proposal-116-tool',
    toolId: 'proposal-116-tool',
    messageKey: 'codex:proposal-116-tool',
    status: 'completed',
    exitCode: 0,
  });
  const piTool = row({
    ...codexTool,
    provider: 'pi',
    source: 'pi-live',
    toolName: 'bash',
    messageKey: 'pi:proposal-116-tool',
  });

  const codexHtml = await renderMessage(codexTool, 'codex');
  const piHtml = await renderMessage(piTool, 'pi');
  await writeEvidence('pi-codex-tool-card.html', JSON.stringify({
    codexHtml,
    piHtml,
    codexFingerprint: normalizeHtmlFingerprint(codexHtml),
    piFingerprint: normalizeHtmlFingerprint(piHtml),
  }, null, 2));

  assert.match(codexHtml, /data-testid="codex-tool-card"/, 'Codex command must render through the shared tool card');
  assert.match(piHtml, /data-testid="codex-tool-card"/, 'Pi command must render through the shared tool card');
  assert.match(visibleTextFromHtml(piHtml), new RegExp(COMMAND), 'Pi card must show the same command text');
  assert.match(piHtml, /tool-result-proposal-116-tool/, 'Pi card must keep the shared tool-result anchor');
  assert.equal(
    normalizeHtmlFingerprint(piHtml),
    normalizeHtmlFingerprint(codexHtml),
    'Pi and Codex command tool cards must share the same visible HTML structure',
  );
});

test('Codex view_image tool card opens the image path like a compact Read card', async () => {
  /**
   * The Codex view_image tool is a file-open affordance, not a generic JSON
   * function card; users need the image path as a direct workspace link.
   */
  const selectedProject: Project = {
    name: 'matx',
    displayName: 'matx',
    fullPath: '/home/zzl/projects/matx',
    path: '/home/zzl/projects/matx',
  };
  const imagePath = '/home/zzl/projects/matx/test-results/final-view.png';
  const html = await renderMessage(row({
    type: 'assistant',
    provider: 'codex',
    source: 'codex-history',
    isToolUse: true,
    toolName: 'functions.view_image',
    toolInput: { path: imagePath },
    toolResult: null,
    toolCallId: 'proposal-view-image-tool',
    toolId: 'proposal-view-image-tool',
    messageKey: 'codex:proposal-view-image-tool',
    status: 'completed',
  }), 'codex', selectedProject, () => undefined);
  await writeEvidence('codex-view-image-tool-card.html', html);

  assert.match(html, /data-testid="codex-tool-card"/, 'view_image must render through the shared tool card');
  assert.match(visibleTextFromHtml(html), /View/, 'view_image card must use the compact View label');
  assert.match(visibleTextFromHtml(html), /test-results\/final-view\.png/, 'view_image card must show the project-relative image path');
  assert.match(html, /<button[^>]*title="test-results\/final-view\.png"[^>]*>/, 'view_image path must be rendered as a direct clickable file-open control');
  assert.doesNotMatch(visibleTextFromHtml(html), /functions\.view_image/, 'view_image must not fall back to a generic function title');
});

test('file-backed tool cards expose accessible open-file controls', async () => {
  /**
   * Read, Edit and FileChanges are file-backed cards; each visible file path
   * must be an actual button/link target rather than inert transcript text.
   */
  const selectedProject: Project = {
    name: 'matx',
    displayName: 'matx',
    fullPath: '/home/zzl/projects/matx',
    path: '/home/zzl/projects/matx',
  };

  const readHtml = await renderMessage(row({
    type: 'assistant',
    provider: 'codex',
    source: 'codex-history',
    isToolUse: true,
    toolName: 'Read',
    toolInput: { file_path: '/home/zzl/projects/matx/src/read-target.ts' },
    toolResult: { content: 'read file body' },
    toolId: 'read-open-file-tool',
    messageKey: 'codex:read-open-file-tool',
  }), 'codex', selectedProject, () => undefined);

  const editHtml = await renderMessage(row({
    type: 'assistant',
    provider: 'codex',
    source: 'codex-history',
    isToolUse: true,
    toolName: 'Edit',
    toolInput: {
      file_path: '/home/zzl/projects/matx/src/edit-target.ts',
      old_string: 'before',
      new_string: 'after',
    },
    toolResult: { content: 'ok' },
    toolId: 'edit-open-file-tool',
    messageKey: 'codex:edit-open-file-tool',
  }), 'codex', selectedProject, () => undefined);

  const fileChangesHtml = await renderMessage(row({
    type: 'assistant',
    provider: 'codex',
    source: 'codex-history',
    isToolUse: true,
    toolName: 'FileChanges',
    toolInput: {
      status: 'changed',
      changes: [{ kind: 'modified', path: '/home/zzl/projects/matx/src/changed.ts' }],
    },
    toolResult: null,
    toolId: 'file-changes-open-file-tool',
    messageKey: 'codex:file-changes-open-file-tool',
  }), 'codex', selectedProject, () => undefined);

  await writeEvidence('file-backed-open-controls.html', `${readHtml}\n${editHtml}\n${fileChangesHtml}`);

  assert.match(readHtml, /aria-label="Open src\/read-target\.ts"/, 'Read title open control must have an accessible name');
  assert.match(editHtml, /aria-label="Open src\/edit-target\.ts"/, 'Edit title open control must have an accessible name');
  assert.match(fileChangesHtml, /<button[^>]*title="src\/changed\.ts"[^>]*>/, 'FileChanges rows must render clickable file buttons');
  assert.match(fileChangesHtml, /src\/changed\.ts/, 'FileChanges must keep project-relative display paths');
});

test('unverified final assistant image file links render as plain text', async () => {
  /**
   * Final replies can point at mistyped generated screenshots; until the
   * selected project file tree confirms the target exists, the UI must avoid
   * browser navigation affordances for filesystem-looking hrefs.
   */
  const selectedProject: Project = {
    name: 'matx',
    displayName: 'matx',
    fullPath: '/home/zzl/projects/matx',
    path: '/home/zzl/projects/matx',
  };
  const html = await renderMessage(row({
    type: 'assistant',
    provider: 'codex',
    source: 'codex-history',
    content: 'Final image: [test-results/final-view.png](/home/zzl/projects/matx/test-results/final-view.png)',
    messageKey: 'codex:final-image-link',
  }), 'codex', selectedProject, () => undefined);
  await writeEvidence('codex-final-image-link.html', html);

  assert.doesNotMatch(html, /href="\/home\/zzl\/projects\/matx\/test-results\/final-view\.png"/, 'unverified image path must not render as a link');
  assert.doesNotMatch(html, /target="_blank"/, 'unverified image path must not open a blank browser tab');
  assert.match(visibleTextFromHtml(html), /test-results\/final-view\.png/, 'final answer must keep the image path visible');
});

test('Codex goal completion notifications render as a milestone banner', async () => {
  /**
   * A task_complete row marks a finished agent goal, so the transcript should
   * make it visually distinct from ordinary commentary progress lines.
   */
  const html = await renderMessage(row({
    type: 'assistant',
    provider: 'codex',
    source: 'codex-history',
    content: '已创建一个覆盖四类需求的 oz 提案。',
    isTaskNotification: true,
    taskStatus: 'completed',
    taskKind: 'goal_complete',
    durationMs: 498014,
    messageKey: 'codex:goal-complete-banner',
  }), 'codex');
  await writeEvidence('codex-goal-completion-banner.html', html);

  assert.match(html, /data-testid="goal-completion-banner"/, 'goal completion must render through the milestone banner');
  assert.match(visibleTextFromHtml(html), /Goal completed/, 'banner must name the completed goal state');
  assert.match(visibleTextFromHtml(html), /8m 18s/, 'banner must show the task duration');
  assert.match(visibleTextFromHtml(html), /已创建一个覆盖四类需求的 oz 提案。/, 'banner must keep the completion summary visible');
});

test('completed turns collapse thinking and tool calls while keeping final body visible', async () => {
  /**
   * After the assistant body starts, intermediate thinking and tools are
   * reviewable details rather than the primary reading path.
   */
  const blocks = buildTurnDisplayBlocks(completedTurnRows());
  const nonBodyGroup = blocks.find((block) => block.kind === 'turn-non-body-group');
  const assistantBody = blocks.find((block) => block.kind === 'assistant-body');

  assert.ok(nonBodyGroup, 'thinking and tools before final body must enter a turn non-body group');
  assert.equal(nonBodyGroup?.defaultOpen, false, 'completed turn details must default to collapsed');
  assert.equal(assistantBody?.message?.messageKey, 'turn-collapse-body', 'final assistant body must stay directly visible');
  assert.equal(
    blocks.findIndex((block) => block.kind === 'turn-non-body-group') <
      blocks.findIndex((block) => block.kind === 'assistant-body'),
    true,
    'non-body group must preserve transcript order before the final body',
  );
  assert.deepEqual(nonBodyGroup?.items?.map((item) => item.kind), ['thinking-group', 'tool-group', 'tool-group']);
});

test('assistant progress text between tool calls collapses with turn activity', async () => {
  /**
   * Commentary around tool calls is process narration, not final answer body;
   * only the last assistant body in the turn should stay on the reading path.
   */
  const blocks = buildTurnDisplayBlocks([
    row({
      type: 'user',
      content: '继续修工具调用折叠',
      messageKey: 'turn-progress-user',
    }),
    row({
      type: 'assistant',
      content: '我先确认工具组结构。',
      messageKey: 'turn-progress-note-one',
    }),
    row({
      type: 'assistant',
      isToolUse: true,
      toolName: 'Read',
      toolInput: { file_path: 'frontend/components/chat/view/subcomponents/TurnNonBodyGroup.tsx' },
      toolResult: { content: 'source' },
      toolCallId: 'turn-progress-read',
      messageKey: 'turn-progress-tool-one',
    }),
    row({
      type: 'assistant',
      content: '现在补测试覆盖这个过程。',
      messageKey: 'turn-progress-note-two',
    }),
    row({
      type: 'assistant',
      isToolUse: true,
      toolName: 'Bash',
      toolInput: { command: 'pnpm exec tsx --test tests/specs/chat-rendering-parity.spec.tsx' },
      toolResult: { content: 'ok' },
      toolCallId: 'turn-progress-test',
      messageKey: 'turn-progress-tool-two',
    }),
    row({
      type: 'assistant',
      content: '完成：默认只展示这段最终正文。',
      messageKey: 'turn-progress-final-body',
    }),
  ]);
  const nonBodyGroup = blocks.find((block) => block.kind === 'turn-non-body-group');
  const assistantBodies = blocks.filter((block) => block.kind === 'assistant-body');

  assert.ok(nonBodyGroup, 'progress narration and tools must enter one non-body group');
  assert.equal(nonBodyGroup?.defaultOpen, false, 'completed progress details must default to collapsed');
  assert.deepEqual(
    nonBodyGroup?.items?.map((item) => item.kind),
    ['thinking-group', 'tool-group', 'thinking-group', 'tool-group'],
  );
  assert.deepEqual(
    nonBodyGroup?.items
      ?.filter((item) => item.kind === 'thinking-group')
      .flatMap((item) => item.messages.map((message) => message.messageKey)),
    ['turn-progress-note-one', 'turn-progress-note-two'],
  );
  assert.equal(assistantBodies.length, 1, 'only final assistant body should stay directly visible');
  assert.equal(assistantBodies[0]?.message.messageKey, 'turn-progress-final-body');
});

test('Codex commentary phase history collapses before the final answer body', async () => {
  /**
   * Codex JSONL replays commentary as assistant text with phase metadata. Those
   * rows are process narration and must not stay visible as final answer text.
   */
  const converted = convertSessionMessages([
    {
      type: 'user',
      provider: 'codex',
      timestamp: FIXED_TIMESTAMP,
      messageKey: 'codex-commentary-user',
      message: { role: 'user', content: '继续修默认折叠' },
    },
    {
      type: 'assistant',
      provider: 'codex',
      timestamp: FIXED_TIMESTAMP,
      messageKey: 'codex-commentary-note',
      message: {
        role: 'assistant',
        phase: 'commentary',
        content: '我先确认真实历史消息形态。',
      },
    },
    {
      type: 'tool_use',
      provider: 'codex',
      timestamp: FIXED_TIMESTAMP,
      messageKey: 'codex-commentary-tool',
      toolName: 'exec_command',
      toolInput: { cmd: 'printf ok' },
      toolCallId: 'codex-commentary-call',
    },
    {
      type: 'tool_result',
      provider: 'codex',
      timestamp: FIXED_TIMESTAMP,
      messageKey: 'codex-commentary-tool-result',
      toolCallId: 'codex-commentary-call',
      output: 'ok',
    },
    {
      type: 'assistant',
      provider: 'codex',
      timestamp: FIXED_TIMESTAMP,
      messageKey: 'codex-commentary-final',
      message: { role: 'assistant', content: '完成：默认只展示正文回复。' },
    },
  ]);
  const blocks = buildTurnDisplayBlocks(converted);
  const nonBodyGroup = blocks.find((block) => block.kind === 'turn-non-body-group');
  const assistantBodies = blocks.filter((block) => block.kind === 'assistant-body');

  assert.equal(converted.find((message) => message.messageKey === 'codex-commentary-note')?.isThinking, true);
  assert.ok(nonBodyGroup, 'commentary and tool activity must enter one collapsed process group');
  assert.equal(nonBodyGroup?.defaultOpen, false, 'persisted Codex process detail must default to collapsed');
  assert.deepEqual(nonBodyGroup?.items.map((item) => item.kind), ['thinking-group', 'tool-group']);
  assert.equal(assistantBodies.length, 1, 'only the final assistant body should stay directly visible');
  assert.equal(assistantBodies[0]?.message.messageKey, 'codex-commentary-final');
});

test('plain assistant body rows without tool activity stay visible', async () => {
  /**
   * Multiple normal assistant body rows are still answer content when the turn
   * has no tool or thinking activity around them.
   */
  const blocks = buildTurnDisplayBlocks([
    row({
      type: 'user',
      content: '给我两段说明',
      messageKey: 'turn-plain-user',
    }),
    row({
      type: 'assistant',
      content: '第一段正文。',
      messageKey: 'turn-plain-body-one',
    }),
    row({
      type: 'assistant',
      content: '第二段正文。',
      messageKey: 'turn-plain-body-two',
    }),
  ]);

  assert.equal(blocks.some((block) => block.kind === 'turn-non-body-group'), false);
  assert.deepEqual(
    blocks
      .filter((block) => block.kind === 'assistant-body')
      .map((block) => block.message.messageKey),
    ['turn-plain-body-one', 'turn-plain-body-two'],
  );
});

test('live turns keep non-body execution visible until assistant body starts', async () => {
  /**
   * Running turns must not hide active reasoning/tool progress before the
   * final assistant response exists.
   */
  const liveRows = completedTurnRows()
    .filter((message) => message.messageKey !== 'turn-collapse-body')
    .map((message) => message.type === 'user'
      ? message
      : { ...message, source: 'codex-live', isStreaming: true });
  const blocks = buildTurnDisplayBlocks(liveRows);
  const nonBodyGroup = blocks.find((block) => block.kind === 'turn-non-body-group');

  assert.ok(nonBodyGroup, 'live thinking and tools must still be grouped');
  assert.equal(nonBodyGroup?.defaultOpen, true, 'live execution must default to expanded');
  assert.equal(blocks.some((block) => block.kind === 'assistant-body'), false, 'live execution must not fabricate body blocks');
});

test('historical unfinished turns keep non-body details collapsed', async () => {
  /**
   * Persisted history can end before a final assistant body because of
   * pagination or interruption, but it is no longer active websocket progress.
   */
  const historyRows = completedTurnRows().filter((message) => message.messageKey !== 'turn-collapse-body');
  const blocks = buildTurnDisplayBlocks(historyRows);
  const nonBodyGroup = blocks.find((block) => block.kind === 'turn-non-body-group');

  assert.ok(nonBodyGroup, 'historical thinking and tools must still be grouped');
  assert.equal(nonBodyGroup?.defaultOpen, false, 'non-live unfinished details must default to collapsed');
});

test('tool-only turn activity renders one collapsed tool group without row metadata', async () => {
  /**
   * Pure tool activity should collapse behind one count summary and then render
   * tool cards directly without repeated provider labels or timestamps.
   */
  const turnGroupSource = await readSource('frontend/components/chat/view/subcomponents/TurnNonBodyGroup.tsx');
  const messageSource = await readSource('frontend/components/chat/view/subcomponents/MessageComponent.tsx');
  const subagentSource = await readSource('frontend/components/chat/tools/components/SubagentContainer.tsx');

  assert.match(turnGroupSource, /isToolOnlyBlock/);
  assert.match(turnGroupSource, /data-testid=["']turn-tool-list-group["']/);
  assert.match(turnGroupSource, /data-testid=["']turn-tool-list-toggle["']/);
  assert.match(turnGroupSource, /data-testid=["']turn-tool-list["']/);
  assert.match(turnGroupSource, /工具调用\$\{toolInvocationCount\}次/);
  assert.match(turnGroupSource, /suppressAssistantMetadata:\s*true/);
  assert.match(messageSource, /suppressAssistantMetadata/);
  assert.match(messageSource, /Boolean\(suppressAssistantMetadata\)/);
  assert.doesNotMatch(turnGroupSource, /Tool call/);
  assert.doesNotMatch(turnGroupSource, /data-testid=["']turn-tool-command["']/);
  assert.doesNotMatch(turnGroupSource, /getCommandLabels/);
  assert.doesNotMatch(subagentSource, /\{child\.toolName\}/);
  assert.doesNotMatch(subagentSource, /`\$\{currentTool\.toolName\}…`/);
  assert.doesNotMatch(subagentSource, /getToolIcon\(child\.toolName\)/);
});

test('tool disclosure chrome keeps right chevrons and one-shot target scrolling', async () => {
  /**
   * The transcript uses nested details rows; global CSS must not flip their
   * right chevrons into left chevrons, and target jumps must not re-run after
   * virtual row height measurements settle.
   */
  const cssSource = await readSource('frontend/index.css');
  const commandContentSource = await readSource('frontend/components/chat/tools/components/ContentRenderers/ContextCommandContent.tsx');
  const paneLayoutSource = await readSource('frontend/components/chat/view/subcomponents/chatMessagesPaneLayoutController.ts');
  const searchNavigationSource = await readSource('frontend/components/chat/view/chatInterfaceSearchNavigation.ts');

  assert.doesNotMatch(cssSource, /summary svg\[class\*=["']group-open["']\][\s\S]{0,80}rotate\(180deg\)/);
  assert.match(commandContentSource, /aria-label=\{outputOpen \? 'Hide output' : 'Show output'\}/);
  assert.doesNotMatch(commandContentSource, />\{outputOpen \? 'Hide output' : 'Show output'\}<\/span>/);
  assert.match(paneLayoutSource, /appliedScrollTargetKeyRef/);
  assert.match(paneLayoutSource, /appliedScrollTargetKeyRef\.current === targetKey/);
  assert.match(searchNavigationSource, /scrolledSearchTargetRef/);
  assert.match(searchNavigationSource, /applySearchHighlight\(targetElement, activeSearchTarget\.query, shouldScroll\)/);
});

test('batch tool summaries count commands across historical payload shapes', async () => {
  /**
   * Persisted sessions may store tool input as objects, JSON strings, or split
   * tool_use/tool_result rows; summaries should count commands, not rows.
   */
  const stringInputRows = completedTurnRows().map((message) => (
    message.messageKey === 'turn-collapse-batch-tool'
      ? {
        ...message,
        toolInput: JSON.stringify({ command: 'pnpm exec tsc --noEmit\npnpm exec vitest run' }, null, 2),
      }
      : message
  ));
  const stringBlocks = buildTurnDisplayBlocks(stringInputRows);
  const stringGroup = stringBlocks
    .find((block) => block.kind === 'turn-non-body-group')
    ?.items?.find((item) => item.groupKey === 'turn-collapse-batch');

  const splitBlocks = buildTurnDisplayBlocks([
    row({
      type: 'user',
      content: '运行两条命令',
      messageKey: 'turn-collapse-split-user',
    }),
    row({
      type: 'tool_use',
      toolCallId: 'turn-collapse-split-batch',
      toolName: 'Bash',
      toolInput: { command: 'cmd1\ncmd2' },
      messageKey: 'turn-collapse-split-tool-use',
    }),
    row({
      type: 'tool_result',
      toolCallId: 'turn-collapse-split-batch',
      toolName: 'Bash',
      toolResult: { content: 'ok' },
      messageKey: 'turn-collapse-split-tool-result',
    }),
    row({
      type: 'assistant',
      content: '完成',
      messageKey: 'turn-collapse-split-body',
    }),
  ]);
  const splitGroup = splitBlocks
    .find((block) => block.kind === 'turn-non-body-group')
    ?.items?.find((item) => item.groupKey === 'turn-collapse-split-batch');

  assert.equal(stringGroup?.commandCount, 2, 'JSON string toolInput must keep batch command count');
  assert.equal(splitGroup?.messages?.length, 2, 'split tool_use/tool_result rows must stay in one tool group');
  assert.equal(splitGroup?.commandCount, 2, 'tool_result rows must not add command count');
});
