/**
 * PURPOSE: Render the scrollable chat transcript, including history pagination affordances.
 */
import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import type {
  Dispatch,
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
  SetStateAction,
  TouchEvent as ReactTouchEvent,
  WheelEvent as ReactWheelEvent,
} from 'react';

import MessageComponent from './MessageComponent';
import ProviderSelectionEmptyState from './ProviderSelectionEmptyState';
import TurnNonBodyGroup from './TurnNonBodyGroup';
import type { ChatMessage } from '../../types/types';
import type { Project, ProjectSession, SessionProvider } from '../../../../types/app';
import { useChatMessagesPaneLayout } from './chatMessagesPaneLayoutController';

/**
 * Detect workflow states that are still producing child-session output.
 */
function isActiveWorkflowStatus(status: unknown): boolean {
  const normalized = String(status || '').toLowerCase();
  return normalized === 'running' || normalized === 'active' || normalized === 'processing';
}

/**
 * Check whether the selected chat is a child session of an active workflow run.
 */
function isActiveWorkflowChildSession(project: Project, session: ProjectSession | null): boolean {
  if (!session) {
    return false;
  }
  const sessionId = String(session.id || '');
  const workflowId = String(session.workflowId || '');
  const stageKey = String(session.stageKey || '');

  return Boolean((project.workflows || []).some((workflow) => {
    const ownsSession =
      (workflowId && workflow.id === workflowId) ||
      (workflow.childSessions || []).some((child) => child.id === sessionId) ||
      (workflow.workflowOwnedSessionRefs || []).some((ref) => ref.sessionId === sessionId);
    if (!ownsSession) {
      return false;
    }
    const stageIsActive = stageKey
      ? (workflow.stageStatuses || []).some((stage) => stage.key === stageKey && isActiveWorkflowStatus(stage.status))
      : false;
    const processIsActive = (workflow.runnerProcesses || []).some((process) => (
      (process.sessionId === sessionId || process.stage === stageKey) && isActiveWorkflowStatus(process.status)
    ));
    return isActiveWorkflowStatus(workflow.runState) || stageIsActive || processIsActive;
  }));
}

interface ChatMessagesPaneProps {
  scrollContainerRef: RefObject<HTMLDivElement>;
  onWheel?: (event: ReactWheelEvent<HTMLDivElement>) => void;
  onTouchStart?: (event: ReactTouchEvent<HTMLDivElement>) => void;
  onTouchMove?: (event: ReactTouchEvent<HTMLDivElement>) => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  isLoadingSessionMessages: boolean;
  sessionMessagesError: string | null;
  chatMessages: ChatMessage[];
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: SessionProvider;
  setProvider: (provider: SessionProvider) => void;
  textareaRef: RefObject<HTMLTextAreaElement>;
  codexModel: string;
  setCodexModel: (model: string) => void;
  codexModelOptions: Array<{ value: string; label: string }>;
  codexReasoningEffort: string;
  setCodexReasoningEffort: (effort: string) => void;
  codexReasoningOptions: Array<{ value: string; label: string; description?: string }>;
  setInput: Dispatch<SetStateAction<string>>;
  isLoadingMoreMessages: boolean;
  hasMoreMessages: boolean;
  totalMessages: number;
  visibleMessageCount: number;
  visibleMessages: ChatMessage[];
  loadEarlierMessages: () => void;
  loadAllMessages: () => void;
  allMessagesLoaded: boolean;
  isLoadingAllMessages: boolean;
  loadAllJustFinished: boolean;
  showLoadAllOverlay: boolean;
  createDiff: any;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  autoExpandTools?: boolean;
  showRawParameters?: boolean;
  showThinking?: boolean;
  isFollowingLatest: boolean;
  selectedProject: Project;
  scrollTargetMessageKey?: string | null;
  onTranscriptScroll?: (container: HTMLDivElement) => void;
}

export default function ChatMessagesPane({
  scrollContainerRef,
  onWheel,
  onTouchStart,
  onTouchMove,
  onKeyDown,
  isLoadingSessionMessages,
  sessionMessagesError,
  chatMessages,
  selectedSession,
  currentSessionId,
  provider,
  setProvider,
  textareaRef,
  codexModel,
  setCodexModel,
  codexModelOptions,
  codexReasoningEffort,
  setCodexReasoningEffort,
  codexReasoningOptions,
  setInput,
  isLoadingMoreMessages,
  hasMoreMessages,
  totalMessages,
  visibleMessageCount,
  visibleMessages,
  loadEarlierMessages,
  loadAllMessages,
  allMessagesLoaded,
  isLoadingAllMessages,
  loadAllJustFinished,
  showLoadAllOverlay,
  createDiff,
  onFileOpen,
  onShowSettings,
  autoExpandTools,
  showRawParameters,
  showThinking,
  isFollowingLatest,
  selectedProject,
  scrollTargetMessageKey,
  onTranscriptScroll,
}: ChatMessagesPaneProps) {
  const { t } = useTranslation('chat');
  const renderedMessageCount = chatMessages.length;
  const visibleRenderedMessageCount = visibleMessages.length;
  const hasHiddenRenderedHistory = renderedMessageCount > visibleRenderedMessageCount;
  const activeTailDefaultOpen = useMemo(
    () => isActiveWorkflowChildSession(selectedProject, selectedSession),
    [selectedProject, selectedSession],
  );
  const shouldShowTopHistoryHint =
    hasMoreMessages && !isLoadingMoreMessages && !allMessagesLoaded && hasHiddenRenderedHistory;
  const {
    handleScroll,
    maxRenderedTranscriptMessages,
    measureMessage,
    virtualDisplayBlocks,
    virtualRange,
  } = useChatMessagesPaneLayout({
    visibleMessages,
    scrollContainerRef,
    isFollowingLatest,
    scrollTargetMessageKey,
    activeTailDefaultOpen,
  });

  return (
    <div
      ref={scrollContainerRef}
      data-testid="chat-scroll-container"
      data-virtualized="true"
      data-render-window-size={maxRenderedTranscriptMessages}
      onScroll={(event) => {
        /** Keep virtual layout measurement and the owning history controller in sync. */
        handleScroll(event);
        onTranscriptScroll?.(event.currentTarget);
      }}
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onKeyDown={onKeyDown}
      tabIndex={0}
      className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-0 py-3 sm:p-4"
    >
      {isLoadingSessionMessages && chatMessages.length === 0 ? (
        <div className="text-center text-gray-500 dark:text-gray-400 mt-8">
          <div className="flex items-center justify-center space-x-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400" />
            <p>{t('session.loading.sessionMessages')}</p>
          </div>
        </div>
      ) : sessionMessagesError && chatMessages.length === 0 ? (
        <div
          className="mx-auto mt-8 max-w-md px-6 text-center text-sm text-muted-foreground"
          data-testid="chat-session-load-error"
        >
          <p className="mb-1 text-base font-semibold text-foreground">
            {t('session.loadError.title', { defaultValue: '无法加载会话历史' })}
          </p>
          <p>{t('session.loadError.description', { defaultValue: '消息接口返回失败，请刷新页面或返回项目页后重试。' })}</p>
        </div>
      ) : chatMessages.length === 0 ? (
        <ProviderSelectionEmptyState
          selectedSession={selectedSession}
          currentSessionId={currentSessionId}
          provider={provider}
          setProvider={setProvider}
          textareaRef={textareaRef}
            codexModel={codexModel}
          setCodexModel={setCodexModel}
          codexModelOptions={codexModelOptions}
          codexReasoningEffort={codexReasoningEffort}
          setCodexReasoningEffort={setCodexReasoningEffort}
          codexReasoningOptions={codexReasoningOptions}
          setInput={setInput}
        />
      ) : (
        <>
          {/* Loading indicator for older messages (hide when load-all is active) */}
          {isLoadingMoreMessages && !isLoadingAllMessages && !allMessagesLoaded && (
            <div className="text-center text-gray-500 dark:text-gray-400 py-3">
              <div className="flex items-center justify-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400" />
                <p className="text-sm">{t('session.loading.olderMessages')}</p>
              </div>
            </div>
          )}

          {/* Indicator showing there are more messages to load (hide when all loaded) */}
          {shouldShowTopHistoryHint && (
            <div className="text-center text-gray-500 dark:text-gray-400 text-sm py-2 border-b border-gray-200 dark:border-gray-700">
              {renderedMessageCount > 0 && (
                <span>
                  {t('session.messages.showingOf', {
                    shown: visibleRenderedMessageCount,
                    total: renderedMessageCount,
                  })}{' '}
                  <span className="text-xs">{t('session.messages.scrollToLoad')}</span>
                </span>
              )}
            </div>
          )}

          {/* Floating "Load all messages" overlay */}
          {(showLoadAllOverlay || isLoadingAllMessages || loadAllJustFinished) && (
            <div className="sticky top-2 z-20 flex justify-center pointer-events-none">
              {loadAllJustFinished ? (
                <div className="px-4 py-1.5 text-xs font-medium text-white bg-green-600 dark:bg-green-500 rounded-full shadow-lg flex items-center space-x-2">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>{t('session.messages.allLoaded')}</span>
                </div>
              ) : (
                <button
                  className="pointer-events-auto px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 rounded-full shadow-lg transition-all duration-200 hover:scale-105 disabled:opacity-75 disabled:cursor-wait flex items-center space-x-2"
                  onClick={loadAllMessages}
                  disabled={isLoadingAllMessages}
                >
                  {isLoadingAllMessages && (
                    <div className="animate-spin rounded-full h-3 w-3 border-2 border-white/30 border-t-white" />
                  )}
                  <span>
                    {isLoadingAllMessages
                      ? t('session.messages.loadingAll')
                      : <>{t('session.messages.loadAll')} {totalMessages > 0 && `(${totalMessages})`}</>
                    }
                  </span>
                </button>
              )}
            </div>
          )}

          {/* Performance warning when all messages are loaded */}
          {allMessagesLoaded && !Number.isFinite(visibleMessageCount) && (
            <div className="text-center text-amber-600 dark:text-amber-400 text-xs py-1.5 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
              {t('session.messages.perfWarning')}
            </div>
          )}

          {/* Legacy message count indicator (for non-paginated view) */}
          {!hasMoreMessages && chatMessages.length > visibleMessageCount && (
            <div className="text-center text-gray-500 dark:text-gray-400 text-sm py-2 border-b border-gray-200 dark:border-gray-700">
              {t('session.messages.showingLast', { count: visibleMessageCount, total: chatMessages.length })} |
              <button className="ml-1 text-blue-600 hover:text-blue-700 underline" onClick={loadEarlierMessages}>
                {t('session.messages.loadEarlier')}
              </button>
              {' | '}
              <button
                className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 underline"
                onClick={loadAllMessages}
              >
                {t('session.messages.loadAll')}
              </button>
            </div>
          )}

          {virtualRange.paddingTop > 0 && (
            <div aria-hidden="true" style={{ height: virtualRange.paddingTop }} />
          )}

          {virtualDisplayBlocks.map(({ block, blockIndex, blockKey, sourceIndex }) => {
            const isNonBodyGroup = block.kind === 'turn-non-body-group';
            const message = isNonBodyGroup ? null : block.message;
            const prevMessage = sourceIndex > 0 ? visibleMessages[sourceIndex - 1] : null;
            return (
              <div
                key={blockKey}
                ref={(element) => measureMessage(blockKey, element)}
                className="mb-3 sm:mb-4 last:mb-0"
                data-virtual-row="chat-message"
              >
                {block.kind === 'turn-non-body-group' ? (
                  <TurnNonBodyGroup
                    block={block}
                    blockIndex={blockIndex}
                    createDiff={createDiff}
                    onFileOpen={onFileOpen}
                    onShowSettings={onShowSettings}
                    autoExpandTools={autoExpandTools}
                    showRawParameters={showRawParameters}
                    showThinking={showThinking}
                    selectedProject={selectedProject}
                    provider={provider}
                  />
                ) : (
                  <MessageComponent
                    message={block.message}
                    index={sourceIndex}
                    prevMessage={prevMessage}
                    createDiff={createDiff}
                    onFileOpen={onFileOpen}
                    onShowSettings={onShowSettings}
                    autoExpandTools={autoExpandTools}
                    showRawParameters={showRawParameters}
                    showThinking={showThinking}
                    selectedProject={selectedProject}
                    provider={provider}
                  />
                )}
              </div>
            );
          })}

          {virtualRange.paddingBottom > 0 && (
            <div aria-hidden="true" style={{ height: virtualRange.paddingBottom }} />
          )}
        </>
      )}
    </div>
  );
}
