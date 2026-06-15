/**
 * Sources: 2026-06-14-116-统一Pi与Codex聊天渲染反馈
 *
 * PURPOSE: Verify Codex/Pi chat rendering parity with the real frontend
 * message component and merge utilities used by manual sessions.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
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

test('final assistant image links stay on the workspace file preview route', async () => {
  /**
   * Final replies often point at generated screenshots before the file tree
   * index has reloaded, so image links must still use the workspace open flow.
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

  assert.match(html, /href="\/home\/zzl\/projects\/matx\/test-results\/final-view\.png"/, 'image link href must remain visible');
  assert.doesNotMatch(html, /target="_blank"/, 'workspace image links must be intercepted instead of opening a blank browser tab');
  assert.match(visibleTextFromHtml(html), /test-results\/final-view\.png/, 'final answer must keep the image path visible');
});
