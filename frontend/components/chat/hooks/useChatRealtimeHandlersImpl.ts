/**
 * Realtime chat event handling.
 * Consumes backend WebSocket messages in sequence and updates chat/session UI state.
 */
import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { SocketMessageEnvelope } from '../../../contexts/WebSocketContext';
import { getPendingSocketMessages } from '../../../../shared/socket-message-utils';
import { decodeHtmlEntities, formatUsageLimitText } from '../utils/chatFormatting';
import { safeLocalStorage } from '../utils/chatStorage';
import { convertSessionMessages } from '../utils/messageTransforms';
import { normalizePiQueueItems } from '../utils/piQueueState';
import {
  chatMessageReducer,
} from '../state/chatMessageReducer';
import { normalizeNativeRuntimeMessage } from '../state/chatRealtimeEvents';
import type { ChatMessageAction } from '../state/chatMessageStateTypes';
import type { ChatMessage, PendingPermissionRequest } from '../types/types';
import type { Project, ProjectSession, SessionProvider } from '../../../types/app';

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
  clientRequestId?: string;
  draftSessionId?: string | null;
};

type LatestChatMessage = {
  type?: string;
  data?: any;
  sessionId?: string;
  requestId?: string;
  toolName?: string;
  input?: unknown;
  context?: unknown;
  error?: string;
  tool?: string;
  exitCode?: number;
  isProcessing?: boolean;
  actualSessionId?: string;
  [key: string]: any;
};

interface UseChatRealtimeHandlersArgs {
  messageHistory: SocketMessageEnvelope[];
  provider: SessionProvider;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  setCurrentSessionId: (sessionId: string | null) => void;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setSessionMessages: Dispatch<SetStateAction<any[]>>;
  setIsLoading: (loading: boolean) => void;
  setActiveTurnStartedAt: (turnStartedAt: string | null) => void;
  setCanAbortSession: (canAbort: boolean) => void;
  setTokenBudget: (budget: Record<string, unknown> | null) => void;
  setIsSystemSessionChange: (isSystemSessionChange: boolean) => void;
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
  sendMessage: (message: unknown) => void;
  pendingViewSessionRef: MutableRefObject<PendingViewSession | null>;
  streamBufferRef: MutableRefObject<string>;
  streamTimerRef: MutableRefObject<number | null>;
  onSessionInactive?: (sessionId?: string | null) => void;
  onSessionProcessing?: (sessionId?: string | null) => void;
  onSessionNotProcessing?: (sessionId?: string | null) => void;
  onReplaceTemporarySession?: (sessionId?: string | null) => void;
  onNavigateToSession?: (
    sessionId: string,
    options?: {
      provider?: SessionProvider;
      projectName?: string;
      projectPath?: string;
      workflowId?: string;
      workflowStageKey?: string;
    },
  ) => void;
  codexModelSwitchSessionId: string | null;
  loadSessionMessages: (
    projectName: string,
    sessionId: string,
    loadMore?: boolean,
    provider?: string,
    projectPath?: string,
  ) => Promise<any[]>;
  onCodexModelSwitchComplete?: () => void;
  onRawMessage?: (message: LatestChatMessage) => void;
  onTurnOutcome?: (payload: { sessionId: string | null; status: 'completed' | 'failed' }) => void;
}

const isTemporarySessionId = (sessionId?: string | null): boolean =>
  Boolean(sessionId && sessionId.startsWith('new-session-'));

const isCbwRouteSessionId = (sessionId?: string | null): boolean =>
  Boolean(sessionId && /^c\d+$/.test(sessionId));

const isUnsavedNewSessionId = (sessionId?: string | null): boolean =>
  Boolean(sessionId && sessionId.startsWith('new-session-'));

/**
 * Check whether a provider session-created event belongs to the draft request
 * currently shown in this chat view.
 */
const isSessionCreatedForPendingView = (
  latestMessage: LatestChatMessage,
  pendingViewSession: PendingViewSession | null,
): boolean => {
  if (!pendingViewSession) {
    return false;
  }

  const expectedRequestId = pendingViewSession.clientRequestId;
  if (!expectedRequestId) {
    return true;
  }

  return latestMessage.clientRequestId === expectedRequestId;
};

/**
 * Check whether a lifecycle event belongs to the optimistic request in this view.
 */
const isMessageForPendingRequest = (
  latestMessage: LatestChatMessage,
  pendingViewSession: PendingViewSession | null,
): boolean => {
  const expectedRequestId = pendingViewSession?.clientRequestId;
  return Boolean(expectedRequestId && latestMessage.clientRequestId === expectedRequestId);
};

const buildWorkflowNavigationOptions = (
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
  provider: SessionProvider,
) => {
  if (!selectedSession?.workflowId) {
    return undefined;
  }

  return {
    provider: selectedSession.__provider || provider,
    projectName: selectedSession.__projectName || selectedProject?.name || '',
    projectPath: selectedSession.projectPath || selectedProject?.fullPath || selectedProject?.path || '',
    workflowId: selectedSession.workflowId,
    workflowStageKey: selectedSession.stageKey,
  };
};

/**
 * Check whether a project-scoped realtime event belongs to the active project.
 */
const isMessageForSelectedProject = (
  latestMessage: LatestChatMessage,
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
): boolean => {
  const messageProjectPath = typeof latestMessage.projectPath === 'string' ? latestMessage.projectPath.trim() : '';
  const messageProjectName = typeof latestMessage.projectName === 'string' ? latestMessage.projectName.trim() : '';
  if (!messageProjectPath && !messageProjectName) {
    return true;
  }

  const activeProjectPath = (selectedSession?.projectPath || selectedProject?.fullPath || selectedProject?.path || '').trim();
  const activeProjectName = (selectedSession?.__projectName || selectedProject?.name || '').trim();
  if (messageProjectPath && activeProjectPath) {
    return messageProjectPath === activeProjectPath;
  }
  if (messageProjectName && activeProjectName) {
    return messageProjectName === activeProjectName;
  }
  return false;
};

const appendStreamingChunk = (
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  chunk: string,
  newline = false,
) => {
  if (!chunk) {
    return;
  }
  setChatMessages((previous) =>
    chatMessageReducer({ messages: previous }, { type: 'streamingChunkAppended', chunk, newline }).messages);
};

const finalizeStreamingMessage = (setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>) => {
  setChatMessages((previous) =>
    chatMessageReducer({ messages: previous }, { type: 'streamingMessageFinalized' }).messages);
};

/**
 * Reload persisted Codex transcript entries so completed Edit tools replace
 * any transient realtime placeholders.
 */
const reloadCodexSessionMessages = async ({
  selectedProject,
  selectedSession,
  sessionId,
  loadSessionMessages,
  setSessionMessages,
  setChatMessages,
  provider: fallbackProvider,
  preserveLiveMessages = true,
}: {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  sessionId: string | null;
  loadSessionMessages: (
    projectName: string,
    sessionId: string,
    loadMore?: boolean,
    provider?: string,
    projectPath?: string,
  ) => Promise<any[]>;
  setSessionMessages: Dispatch<SetStateAction<any[]>>;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  provider?: string;
  preserveLiveMessages?: boolean;
}) => {
  if (!selectedProject?.name || !sessionId || isUnsavedNewSessionId(sessionId)) {
    return;
  }

  // For cN/co-owned sessions, use the cN route ID so the server reads from
  // the co conversation read model.  Ordinary Codex JSONL sessions keep their
  // UUID id.  We check selectedSession.id directly — routeIndex is a sidebar
  // slot that ALL sessions have and must NOT be used to infer co ownership.
    const resolvedSessionId = selectedSession?.id && isCbwRouteSessionId(selectedSession.id)
    ? selectedSession.id
    : sessionId;

  const resolvedProvider = selectedSession?.__provider || fallbackProvider || 'codex';
  const projectName = resolvedProvider === 'codex'
    ? selectedProject.name
    : selectedSession?.__projectName || selectedProject.name;
  const projectPath = selectedSession?.projectPath || selectedProject.fullPath || selectedProject.path || '';

  const messages = await loadSessionMessages(projectName, resolvedSessionId, false, resolvedProvider, projectPath);
  const rawMessages = Array.isArray(messages) ? messages : [];
  // Directly update chat transcript so the DOM reflects the reloaded read-model.
  // NOTE: intentionally NOT updating sessionMessages here — doing so would trigger
  // the useEffect-based merge in useChatSessionState (line ~1086) which races with
  // this direct replacement and causes message loss on multi-turn conversations.
  // The sessionMessages / convertedMessages pipeline is only used for initial load.
  setChatMessages((previous) => {
    const persisted = convertSessionMessages(rawMessages);
    // Guard: don't wipe existing chat on an empty reload. Transient read-model
    // race conditions can cause the API to return [] while turns are still
    // materializing, and a full replace would make prior responses disappear.
    if (rawMessages.length === 0 && previous.some((m) => m.type === 'assistant' || m.messageKey)) {
      return previous;
    }
    return chatMessageReducer(
      { messages: previous },
      {
        type: 'persistedReloaded',
        persistedMessages: persisted,
        preservePreviousMessages: preserveLiveMessages,
        sessionId: resolvedSessionId,
      },
    ).messages;
  });
};

export function useChatRealtimeHandlers({
  messageHistory,
  provider,
  selectedProject,
  selectedSession,
  currentSessionId,
  setCurrentSessionId,
  setChatMessages,
  setSessionMessages,
  setIsLoading,
  setActiveTurnStartedAt,
  setCanAbortSession,
  setTokenBudget,
  setIsSystemSessionChange,
  setPendingPermissionRequests,
  sendMessage,
  pendingViewSessionRef,
  streamBufferRef,
  streamTimerRef,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  onReplaceTemporarySession,
  onNavigateToSession,
  codexModelSwitchSessionId,
  loadSessionMessages,
  onCodexModelSwitchComplete,
  onRawMessage,
  onTurnOutcome,
}: UseChatRealtimeHandlersArgs) {
  /**
   * Replay buffered socket messages for routes that mount after the socket event.
   */
  const lastProcessedSequenceRef = useRef(0);
  /** Debounce timer for content-event-driven read-model invalidation. */
  const contentReloadTimerRef = useRef<number | null>(null);
  /**
   * Dispatch one pure transcript action through the reducer boundary.
   */
  const updateChatMessages = (action: ChatMessageAction) => {
    setChatMessages((previous) =>
      chatMessageReducer({ messages: previous }, action).messages);
  };

  useEffect(() => {
    let bridgedSocket: any = null;
    let bridgeTimer: number | null = null;
    const handleCodexTestMessage = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(String(event.data || '{}'));
        const codexData = parsed?.type === 'codex-response' ? parsed.data : null;
        if (codexData?.type !== 'item') {
          return;
        }
        // Codex item payloads are rendered only after they are persisted to JSONL.
      } catch {
        // Ignore malformed test socket payloads.
      }
    };

    const attachBridge = () => {
      const testSocket = (window as any).__codexRealtimeSocket;
      if (!testSocket || testSocket.__ozwCodexBridge) {
        return;
      }
      bridgedSocket = testSocket;
      bridgedSocket.__ozwCodexBridge = true;
      bridgedSocket.addEventListener?.('message', handleCodexTestMessage);
      if (bridgeTimer !== null) {
        window.clearInterval(bridgeTimer);
        bridgeTimer = null;
      }
    };

    attachBridge();
    if (!bridgedSocket) {
      bridgeTimer = window.setInterval(attachBridge, 25);
    }

    return () => {
      if (bridgeTimer !== null) {
        window.clearInterval(bridgeTimer);
      }
      bridgedSocket?.removeEventListener?.('message', handleCodexTestMessage);
      if (bridgedSocket) {
        bridgedSocket.__ozwCodexBridge = false;
      }
    };
  }, [setChatMessages]);

  // Clean up the content-event debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (contentReloadTimerRef.current !== null) {
        window.clearTimeout(contentReloadTimerRef.current);
        contentReloadTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const pendingMessages = getPendingSocketMessages(
      messageHistory,
      lastProcessedSequenceRef.current,
    ) as Array<{ sequence: number; message: LatestChatMessage }>;
    if (pendingMessages.length === 0) {
      return;
    }

    pendingMessages.forEach(({ sequence, message: latestMessage }) => {
      lastProcessedSequenceRef.current = sequence;
      onRawMessage?.(latestMessage);

      const messageData = latestMessage.data?.message || latestMessage.data;
      const structuredMessageData =
        messageData && typeof messageData === 'object' ? (messageData as Record<string, any>) : null;
      const rawStructuredData =
        latestMessage.data && typeof latestMessage.data === 'object'
          ? (latestMessage.data as Record<string, any>)
          : null;

      const globalMessageTypes = ['projects_updated', 'session-created'];
      const isGlobalMessage = globalMessageTypes.includes(String(latestMessage.type));
      const projectsUpdateProvider = latestMessage.provider || latestMessage.watchProvider;
      if (
        latestMessage.type === 'projects_updated' &&
        projectsUpdateProvider === 'codex' &&
        selectedSession?.__provider === 'codex'
      ) {
        const selectedProviderSessionId =
          typeof selectedSession.providerSessionId === 'string' ? selectedSession.providerSessionId : null;
        const codexReloadSessionId =
          selectedProviderSessionId ||
          pendingViewSessionRef.current?.sessionId ||
          selectedSession.id;
        const isCurrentSessionProcessing = [
          codexReloadSessionId,
          selectedSession.id,
        ].some((sessionId) => (
          typeof sessionId === 'string' &&
          sessionStorage.getItem(`ozw-processing-session:${sessionId}`) === '1'
        ));
        if (isCurrentSessionProcessing) {
          return;
        }
        void reloadCodexSessionMessages({
          selectedProject,
          selectedSession,
          sessionId: codexReloadSessionId,
          loadSessionMessages,
          setChatMessages,
          setSessionMessages,
          provider,
        });
      }
      const lifecycleMessageTypes = new Set([
        'claude-complete',
        'codex-complete',
        'pi-complete',
        'session-aborted',
        'claude-error',
        'codex-error',
        'pi-error',
      ]);

      const isClaudeSystemInit =
        latestMessage.type === 'claude-response' &&
        structuredMessageData &&
        structuredMessageData.type === 'system' &&
        structuredMessageData.subtype === 'init';

      const systemInitSessionId = isClaudeSystemInit ? structuredMessageData?.session_id : null;

      const activeViewSessionId =
        selectedSession?.id || currentSessionId || pendingViewSessionRef.current?.sessionId || null;
      const routePathSessionId = typeof window !== 'undefined'
        ? window.location.pathname.match(/\/(c\d+)(?:[/?#].*)?$/)?.[1] || null
        : null;
      const selectedRouteSessionId = Number.isInteger(Number(selectedSession?.routeIndex))
        ? `c${Number(selectedSession?.routeIndex)}`
        : routePathSessionId;
      const activeProviderSessionId =
        typeof selectedSession?.providerSessionId === 'string' ? selectedSession.providerSessionId : null;
      const activeViewSessionIds = new Set(
        [
          activeViewSessionId,
          selectedRouteSessionId,
          activeProviderSessionId,
        ].filter((value): value is string => typeof value === 'string' && value.length > 0),
      );
      const isTemporaryViewSession = isTemporarySessionId(activeViewSessionId);
      const isCbwRouteView = isCbwRouteSessionId(activeViewSessionId);
      const messageRouteSessionId =
        latestMessage.ozwSessionId || latestMessage.ozw_session_id || latestMessage.sessionId;
      const isSystemInitForView =
        systemInitSessionId && (!activeViewSessionId || systemInitSessionId === activeViewSessionId);
      const shouldBypassSessionFilter = isGlobalMessage
        || Boolean(isSystemInitForView)
        || (latestMessage.type === 'session-created' && isTemporaryViewSession)
        || isMessageForPendingRequest(latestMessage, pendingViewSessionRef.current);
      const isUnscopedError =
        !latestMessage.sessionId &&
        pendingViewSessionRef.current &&
        !pendingViewSessionRef.current.sessionId &&
        (latestMessage.type === 'claude-error' ||
          latestMessage.type === 'codex-error' ||
          latestMessage.type === 'pi-error');

      const handleBackgroundLifecycle = (sessionId?: string) => {
        if (!sessionId) {
          return;
        }
        onSessionInactive?.(sessionId);
        onSessionNotProcessing?.(sessionId);
      };

      const collectSessionIds = (...sessionIds: Array<string | null | undefined>) =>
        Array.from(
          new Set(
            sessionIds.filter((sessionId): sessionId is string => typeof sessionId === 'string' && sessionId.length > 0),
          ),
        );

      const clearRealtimeSessionMarkers = (...sessionIds: Array<string | null | undefined>) => {
        const normalizedSessionIds = collectSessionIds(...sessionIds);
        if (typeof sessionStorage === 'undefined') {
          return normalizedSessionIds;
        }
        normalizedSessionIds.forEach((sessionId) => {
          sessionStorage.removeItem(`ozw-processing-session:${sessionId}`);
          sessionStorage.removeItem(`ozw-active-turn:${sessionId}`);
        });
        return normalizedSessionIds;
      };

      const clearLoadingIndicators = () => {
        setIsLoading(false);
        setCanAbortSession(false);
      };

      const markSessionsAsCompleted = (...sessionIds: Array<string | null | undefined>) => {
        const normalizedSessionIds = clearRealtimeSessionMarkers(...sessionIds);
        normalizedSessionIds.forEach((sessionId) => {
          onSessionInactive?.(sessionId);
          onSessionNotProcessing?.(sessionId);
        });
      };
      const isCodexModelSwitchForCurrentSession = Boolean(
        codexModelSwitchSessionId
        && selectedSession?.id === codexModelSwitchSessionId
        && selectedSession?.__provider === 'codex',
      );
      const clearCodexModelSwitchState = () => {
        if (!isCodexModelSwitchForCurrentSession) {
          return;
        }
        onCodexModelSwitchComplete?.();
      };

      if (!shouldBypassSessionFilter) {
        if (!isMessageForSelectedProject(latestMessage, selectedProject, selectedSession)) {
          return;
        }

        if (!activeViewSessionId) {
          // session-status carries its own sessionId and is safe to let through;
          // the handler will perform isCurrentSession checks internally.
          if (latestMessage.type === 'session-status' && latestMessage.sessionId) {
            // allow pass-through
          } else if (latestMessage.sessionId && lifecycleMessageTypes.has(String(latestMessage.type))) {
            handleBackgroundLifecycle(latestMessage.sessionId);
          } else if (!latestMessage.sessionId && latestMessage.type === 'codex-response') {
            lastProcessedSequenceRef.current = sequence - 1;
            return;
          } else if (!isUnscopedError) {
            return;
          }
        }

        if (!messageRouteSessionId && latestMessage.type === 'codex-response') {
          // Codex CLI item events can be scoped by the current view route rather than the socket envelope.
        } else if (!messageRouteSessionId && latestMessage.type === 'session-status') {
          // session-status may lack a route-scoped sessionId; let the handler
          // perform its own session matching.
        } else if (!messageRouteSessionId && !isUnscopedError) {
          return;
        }

        if (messageRouteSessionId && !activeViewSessionIds.has(messageRouteSessionId)) {
          // session-status uses its own session matching in the handler;
          // don't drop it just because the session hasn't been resolved yet.
          if (latestMessage.type === 'session-status') {
            // allow pass-through
          } else if (messageRouteSessionId && lifecycleMessageTypes.has(String(latestMessage.type))) {
            handleBackgroundLifecycle(messageRouteSessionId);
          } else {
            return;
          }
        }
      }

      switch (latestMessage.type) {
      case 'message-accepted':
        updateChatMessages({ type: 'acceptedUserMessageSent', clientRequestId: latestMessage.clientRequestId });
        break;
      case 'session-created':
        if (
          !isCodexModelSwitchForCurrentSession
          && !isSessionCreatedForPendingView(latestMessage, pendingViewSessionRef.current)
        ) {
          return;
        }
        if (
          latestMessage.sessionId
          && (!currentSessionId || isTemporarySessionId(currentSessionId))
          && !isCbwRouteView
        ) {
          sessionStorage.setItem('pendingSessionId', latestMessage.sessionId);
          if (pendingViewSessionRef.current && !pendingViewSessionRef.current.sessionId) {
            pendingViewSessionRef.current.sessionId = latestMessage.sessionId;
          }

          setIsSystemSessionChange(true);
          onReplaceTemporarySession?.(latestMessage.sessionId);
          onNavigateToSession?.(
            latestMessage.sessionId,
            buildWorkflowNavigationOptions(selectedProject, selectedSession, provider),
          );

          setPendingPermissionRequests((previous) =>
            previous.map((request) =>
              request.sessionId ? request : { ...request, sessionId: latestMessage.sessionId },
            ),
          );
          updateChatMessages({ type: 'userMessagesPersisted' });
          return;
        }

        if (latestMessage.sessionId && isCodexModelSwitchForCurrentSession) {
          sessionStorage.setItem('pendingSessionId', latestMessage.sessionId);
          if (pendingViewSessionRef.current && !pendingViewSessionRef.current.sessionId) {
            pendingViewSessionRef.current.sessionId = latestMessage.sessionId;
          }

          onReplaceTemporarySession?.(latestMessage.sessionId);
          clearCodexModelSwitchState();
          onNavigateToSession?.(
            latestMessage.sessionId,
            buildWorkflowNavigationOptions(selectedProject, selectedSession, provider),
          );
        }
        updateChatMessages({ type: 'userMessagesPersisted' });
        break;

      case 'token-budget':
        if (latestMessage.data) {
          setTokenBudget(latestMessage.data);
        }
        break;

      case 'claude-response': {
        if (messageData && typeof messageData === 'object' && messageData.type) {
          if (messageData.type === 'content_block_delta' && messageData.delta?.text) {
            const decodedText = decodeHtmlEntities(messageData.delta.text);
            streamBufferRef.current += decodedText;
            if (!streamTimerRef.current) {
              streamTimerRef.current = window.setTimeout(() => {
                const chunk = streamBufferRef.current;
                streamBufferRef.current = '';
                streamTimerRef.current = null;
                appendStreamingChunk(setChatMessages, chunk, false);
              }, 100);
            }
            return;
          }

          if (messageData.type === 'content_block_stop') {
            if (streamTimerRef.current) {
              clearTimeout(streamTimerRef.current);
              streamTimerRef.current = null;
            }
            const chunk = streamBufferRef.current;
            streamBufferRef.current = '';
            appendStreamingChunk(setChatMessages, chunk, false);
            finalizeStreamingMessage(setChatMessages);
            return;
          }
        }

        if (
          structuredMessageData?.type === 'system' &&
          structuredMessageData.subtype === 'init' &&
          structuredMessageData.session_id &&
          currentSessionId &&
          structuredMessageData.session_id !== currentSessionId &&
          isSystemInitForView
        ) {
          setIsSystemSessionChange(true);
          onNavigateToSession?.(structuredMessageData.session_id);
          return;
        }

        if (
          structuredMessageData?.type === 'system' &&
          structuredMessageData.subtype === 'init' &&
          structuredMessageData.session_id &&
          !currentSessionId &&
          isSystemInitForView
        ) {
          setIsSystemSessionChange(true);
          onNavigateToSession?.(structuredMessageData.session_id);
          return;
        }

        if (
          structuredMessageData?.type === 'system' &&
          structuredMessageData.subtype === 'init' &&
          structuredMessageData.session_id &&
          currentSessionId &&
          structuredMessageData.session_id === currentSessionId &&
          isSystemInitForView
        ) {
          return;
        }

        if (structuredMessageData && Array.isArray(structuredMessageData.content)) {
          const parentToolUseId = rawStructuredData?.parentToolUseId;

          structuredMessageData.content.forEach((part: any) => {
            if (part.type === 'tool_use') {
              const toolInput = part.input ? JSON.stringify(part.input, null, 2) : '';

              // Check if this is a child tool from a subagent
              if (parentToolUseId) {
                updateChatMessages({
                  type: 'childToolUseAppended',
                  parentToolUseId,
                  childTool: {
                    toolId: part.id,
                    toolName: part.name,
                    toolInput: part.input,
                    toolResult: null,
                    timestamp: new Date(),
                  },
                });
                return;
              }

              // Check if this is a subagent tool (Task for legacy, Agent for Claude preset)
              const isSubagentContainer = part.name === 'Task' || part.name === 'Agent';

              updateChatMessages({
                type: 'assistantMessageAppended',
                persistUsers: true,
                message: {
                  type: 'assistant',
                  content: '',
                  timestamp: new Date(),
                  isToolUse: true,
                  source: 'claude-realtime',
                  toolName: part.name,
                  toolInput,
                  toolId: part.id,
                  toolResult: null,
                  isSubagentContainer,
                  subagentState: isSubagentContainer
                    ? { childTools: [], currentToolIndex: -1, isComplete: false }
                    : undefined,
                },
              });
              return;
            }

            if (part.type === 'text' && part.text?.trim()) {
              let content = decodeHtmlEntities(part.text);
              content = formatUsageLimitText(content);
              updateChatMessages({
                type: 'assistantMessageAppended',
                persistUsers: true,
                message: {
                  type: 'assistant',
                  content,
                  timestamp: new Date(),
                  source: 'claude-realtime',
                },
              });
            }
          });
        } else if (structuredMessageData && typeof structuredMessageData.content === 'string' && structuredMessageData.content.trim()) {
          let content = decodeHtmlEntities(structuredMessageData.content);
          content = formatUsageLimitText(content);
          updateChatMessages({
            type: 'assistantMessageAppended',
            persistUsers: true,
            message: {
              type: 'assistant',
              content,
              timestamp: new Date(),
              source: 'claude-realtime',
            },
          });
        }

        if (structuredMessageData?.role === 'user' && Array.isArray(structuredMessageData.content)) {
          const parentToolUseId = rawStructuredData?.parentToolUseId;

          structuredMessageData.content.forEach((part: any) => {
            if (part.type !== 'tool_result') {
              return;
            }

            updateChatMessages({
              type: 'toolUseResultApplied',
              toolUseId: part.tool_use_id,
              parentToolUseId,
              toolResult: {
                content: part.content,
                isError: part.is_error,
                timestamp: new Date(),
              },
            });
          });
        }
        break;
      }

      case 'claude-output': {
        const cleaned = String(latestMessage.data || '');
        if (cleaned.trim()) {
          streamBufferRef.current += streamBufferRef.current ? `\n${cleaned}` : cleaned;
          if (!streamTimerRef.current) {
            streamTimerRef.current = window.setTimeout(() => {
              const chunk = streamBufferRef.current;
              streamBufferRef.current = '';
              streamTimerRef.current = null;
              appendStreamingChunk(setChatMessages, chunk, true);
            }, 100);
          }
        }
        break;
      }

      case 'claude-interactive-prompt':
        // Interactive prompts are parsed/rendered as text in the UI.
        // Normalize to string to keep ChatMessage.content shape consistent.
        {
          const interactiveContent =
            typeof latestMessage.data === 'string'
              ? latestMessage.data
              : JSON.stringify(latestMessage.data ?? '', null, 2);
          updateChatMessages({
            type: 'assistantMessageAppended',
            message: {
              type: 'assistant',
              content: interactiveContent,
              timestamp: new Date(),
              isInteractivePrompt: true,
              source: 'claude-realtime',
            },
          });
        }
        break;

      case 'claude-permission-request':
        // YOLO模式：自动批准所有权限请求，不弹出UI
        if (latestMessage.requestId) {
          sendMessage({
            type: 'claude-permission-response',
            requestId: latestMessage.requestId,
            allow: true,
          });
        }
        break;

      case 'claude-permission-cancelled':
        break;

      case 'claude-error':
        updateChatMessages({ type: 'errorMessageAppended', content: `Error: ${latestMessage.error}` });
        break;

      case 'claude-complete': {
        const pendingSessionId = sessionStorage.getItem('pendingSessionId');
        const completedSessionId =
          latestMessage.ozwSessionId
          || latestMessage.ozw_session_id
          || currentSessionId
          || latestMessage.sessionId
          || pendingSessionId;

        clearLoadingIndicators();
        updateChatMessages({ type: 'userMessagesPersisted' });
        markSessionsAsCompleted(
          completedSessionId,
          currentSessionId,
          selectedSession?.id,
          pendingSessionId,
        );

        if (pendingSessionId && !currentSessionId && latestMessage.exitCode === 0) {
          setCurrentSessionId(pendingSessionId);
          sessionStorage.removeItem('pendingSessionId');
          console.log('New session complete, ID set to:', pendingSessionId);
        }

        if (selectedProject && latestMessage.exitCode === 0) {
          safeLocalStorage.removeItem(`chat_messages_${selectedProject.name}`);
        }
        setPendingPermissionRequests([]);
        break;
      }

      case 'codex-response': {
        const codexData = latestMessage.data;
        if (!codexData) {
          break;
        }

        const CODEX_LIVE_ITEM_TYPES = ['agent_message', 'reasoning', 'thinking', 'command_execution', 'tool_call', 'tool_result', 'file_change', 'mcp_tool_call', 'function_call', 'function_call_output', 'update', 'error'];
        if (codexData.type === 'item' && !CODEX_LIVE_ITEM_TYPES.includes(codexData.itemType)) {
          console.log('[Codex] Unhandled item type:', codexData.itemType, codexData);
        }

        // Live content is rendered directly from the native provider event
        // without waiting for JSONL persistence.
        if (codexData.type === 'item' && CODEX_LIVE_ITEM_TYPES.includes(codexData.itemType)) {
          const action = normalizeNativeRuntimeMessage(latestMessage as Record<string, unknown>);
          if (action) {
            updateChatMessages(action);
          }
        }

        if (codexData.type === 'turn_complete') {
          clearLoadingIndicators();
          updateChatMessages({ type: 'userMessagesPersisted' });
          markSessionsAsCompleted(
            latestMessage.sessionId,
            currentSessionId,
            selectedSession?.id,
            selectedRouteSessionId,
            activeProviderSessionId,
            pendingViewSessionRef.current?.sessionId,
          );
          onTurnOutcome?.({
            sessionId: latestMessage.sessionId || currentSessionId || selectedSession?.id || null,
            status: 'completed',
          });
        }

        if (codexData.type === 'turn_failed') {
          clearLoadingIndicators();
          markSessionsAsCompleted(
            latestMessage.sessionId,
            currentSessionId,
            selectedSession?.id,
            selectedRouteSessionId,
            activeProviderSessionId,
            pendingViewSessionRef.current?.sessionId,
          );
          onTurnOutcome?.({
            sessionId: latestMessage.sessionId || currentSessionId || selectedSession?.id || null,
            status: 'failed',
          });
        }
        break;
      }

      case 'codex-complete': {
        const codexPendingSessionId = sessionStorage.getItem('pendingSessionId');
        const codexActualSessionId = latestMessage.actualSessionId || codexPendingSessionId;
        const codexCompletedSessionId =
          latestMessage.sessionId || currentSessionId || codexPendingSessionId;

        clearLoadingIndicators();
        updateChatMessages({ type: 'userMessagesPersisted' });
        markSessionsAsCompleted(
          codexCompletedSessionId,
          codexActualSessionId,
          currentSessionId,
          selectedSession?.id,
          selectedRouteSessionId,
          activeProviderSessionId,
          codexPendingSessionId,
          pendingViewSessionRef.current?.sessionId,
        );

        if (codexPendingSessionId && !currentSessionId) {
          setCurrentSessionId(codexActualSessionId);
          setIsSystemSessionChange(true);
          if (codexActualSessionId) {
            onNavigateToSession?.(codexActualSessionId);
          }
          sessionStorage.removeItem('pendingSessionId');
        }
        if (isCodexModelSwitchForCurrentSession) {
          clearCodexModelSwitchState();
          if (codexCompletedSessionId) {
            onNavigateToSession?.(codexCompletedSessionId);
          }
        }

        if (selectedProject) {
          safeLocalStorage.removeItem(`chat_messages_${selectedProject.name}`);
        }
        void reloadCodexSessionMessages({
          selectedProject,
          selectedSession,
          sessionId: codexCompletedSessionId,
          loadSessionMessages,
          setChatMessages,
          setSessionMessages,
          provider,
          preserveLiveMessages: true,
        });
        window.setTimeout(() => {
          const retrySessionId =
            latestMessage.actualSessionId ||
            pendingViewSessionRef.current?.sessionId ||
            codexCompletedSessionId;
          void reloadCodexSessionMessages({
            selectedProject,
            selectedSession,
            sessionId: retrySessionId,
            loadSessionMessages,
            setChatMessages,
            setSessionMessages,
            provider,
            preserveLiveMessages: true,
          });
        }, 500);
        break;
      }

      case 'codex-error': {
        const codexErrorSessionId = latestMessage.sessionId || currentSessionId;
        setIsLoading(false);
        setCanAbortSession(false);
        if (isCodexModelSwitchForCurrentSession) {
          clearCodexModelSwitchState();
        }
        updateChatMessages({
          type: 'uniqueErrorMessageAppended',
          content: latestMessage.error || 'An error occurred with Codex',
        });
        // Reconcile any partial provider history that may have been persisted
        // before the error occurred.
        void reloadCodexSessionMessages({
          selectedProject,
          selectedSession,
          sessionId: codexErrorSessionId,
          loadSessionMessages,
          setChatMessages,
          setSessionMessages,
          provider,
          preserveLiveMessages: false,
        });
        break;
      }

      case 'pi-response': {
        const piData = latestMessage.data;
        if (!piData) {
          break;
        }

        const PI_LIVE_ITEM_TYPES = ['agent_message', 'reasoning', 'thinking', 'command_execution', 'tool_call', 'tool_result', 'error'];
        if (piData.type === 'item' && !PI_LIVE_ITEM_TYPES.includes(piData.itemType)) {
          console.log('[Pi] Unhandled item type:', piData.itemType, piData);
        }

        // Live content is rendered directly from the native provider event
        // without waiting for JSONL persistence.
        if (piData.type === 'item' && PI_LIVE_ITEM_TYPES.includes(piData.itemType)) {
          const action = normalizeNativeRuntimeMessage(latestMessage as Record<string, unknown>);
          if (action) {
            updateChatMessages(action);
          }
        }

        if (piData.type === 'turn_complete') {
          clearLoadingIndicators();
          updateChatMessages({ type: 'userMessagesPersisted' });
          markSessionsAsCompleted(
            latestMessage.sessionId,
            currentSessionId,
            selectedSession?.id,
            selectedRouteSessionId,
            activeProviderSessionId,
            pendingViewSessionRef.current?.sessionId,
          );
          onTurnOutcome?.({
            sessionId: latestMessage.sessionId || currentSessionId || selectedSession?.id || null,
            status: 'completed',
          });
        }

        if (piData.type === 'turn_failed') {
          clearLoadingIndicators();
          markSessionsAsCompleted(
            latestMessage.sessionId,
            currentSessionId,
            selectedSession?.id,
            selectedRouteSessionId,
            activeProviderSessionId,
            pendingViewSessionRef.current?.sessionId,
          );
          onTurnOutcome?.({
            sessionId: latestMessage.sessionId || currentSessionId || selectedSession?.id || null,
            status: 'failed',
          });
        }
        break;
      }

      case 'session-queue-state': {
        if (latestMessage.provider === 'pi') {
          onRawMessage?.({
            ...latestMessage,
            steering: normalizePiQueueItems(latestMessage.steering),
            followUp: normalizePiQueueItems(latestMessage.followUp),
          });
        }
        break;
      }

      case 'pi-complete': {
        const piPendingSessionId = sessionStorage.getItem('pendingSessionId');
        const piActualSessionId = latestMessage.actualSessionId || piPendingSessionId;
        const piCompletedSessionId =
          latestMessage.sessionId || currentSessionId || piPendingSessionId;

        clearLoadingIndicators();
        updateChatMessages({ type: 'userMessagesPersisted' });
        markSessionsAsCompleted(
          piCompletedSessionId,
          piActualSessionId,
          currentSessionId,
          selectedSession?.id,
          selectedRouteSessionId,
          activeProviderSessionId,
          piPendingSessionId,
          pendingViewSessionRef.current?.sessionId,
        );

        if (piPendingSessionId && !currentSessionId) {
          setCurrentSessionId(piActualSessionId);
          setIsSystemSessionChange(true);
          if (piActualSessionId) {
            onNavigateToSession?.(piActualSessionId);
          }
          sessionStorage.removeItem('pendingSessionId');
        }

        if (selectedProject) {
          safeLocalStorage.removeItem(`chat_messages_${selectedProject.name}`);
        }

        // Reload persisted session messages while keeping overlay rows that
        // the partial provider history has not covered yet.
        void reloadCodexSessionMessages({
          selectedProject,
          selectedSession,
          sessionId: piCompletedSessionId,
          loadSessionMessages,
          setChatMessages,
          setSessionMessages,
          provider,
          preserveLiveMessages: true,
        });
        window.setTimeout(() => {
          const retrySessionId =
            latestMessage.actualSessionId ||
            pendingViewSessionRef.current?.sessionId ||
            piCompletedSessionId;
          void reloadCodexSessionMessages({
            selectedProject,
            selectedSession,
            sessionId: retrySessionId,
            loadSessionMessages,
            setChatMessages,
            setSessionMessages,
            provider,
            preserveLiveMessages: true,
          });
        }, 500);
        break;
      }

      case 'pi-error': {
        const piErrorSessionId = latestMessage.sessionId || currentSessionId;
        setIsLoading(false);
        setCanAbortSession(false);
        updateChatMessages({
          type: 'errorMessageAppended',
          content: latestMessage.error || 'An error occurred with Pi',
        });
        // Reconcile any partial provider history that may have been persisted
        // before the error occurred.
        void reloadCodexSessionMessages({
          selectedProject,
          selectedSession,
          sessionId: piErrorSessionId,
          loadSessionMessages,
          setChatMessages,
          setSessionMessages,
          provider,
          preserveLiveMessages: false,
        });
        break;
      }

      case 'steer-rejected':
        // A steer/message rejection only rejects the specific optimistic message,
        // not the entire active turn. Keep the running state intact so the
        // session can continue processing or accept further steers.
        updateChatMessages({
          type: 'pendingUserMessageRejected',
          clientRequestId: latestMessage.clientRequestId,
          errorContent: latestMessage.error || 'Steer request was rejected by the running process.',
        });
        break;

      case 'message-rejected':
        // A steer/message rejection only rejects the specific optimistic message,
        // not the entire active turn. Keep the running state intact so the
        // session can continue processing or accept further steers.
        updateChatMessages({
          type: 'pendingUserMessageRejected',
          clientRequestId: latestMessage.clientRequestId,
          errorContent: latestMessage.error || 'Message was rejected by the running process.',
        });
        break;

      case 'session-aborted': {
        const pendingSessionId =
          typeof window !== 'undefined' ? sessionStorage.getItem('pendingSessionId') : null;
        const abortedSessionId = latestMessage.sessionId || currentSessionId;
        const abortSucceeded = latestMessage.success !== false;

        if (abortSucceeded) {
          clearLoadingIndicators();
          markSessionsAsCompleted(
            abortedSessionId,
            currentSessionId,
            selectedSession?.id,
            selectedRouteSessionId,
            activeProviderSessionId,
            pendingSessionId,
            pendingViewSessionRef.current?.sessionId,
          );
          if (isCodexModelSwitchForCurrentSession) {
            clearCodexModelSwitchState();
          }
          if (pendingSessionId && (!abortedSessionId || pendingSessionId === abortedSessionId)) {
            sessionStorage.removeItem('pendingSessionId');
          }

          setPendingPermissionRequests([]);
          updateChatMessages({
            type: 'assistantMessageAppended',
            message: {
              type: 'assistant',
              content: 'Session interrupted by user.',
              timestamp: new Date(),
            },
          });
          // Reconcile any partial provider history that was persisted before abort.
          void reloadCodexSessionMessages({
            selectedProject,
            selectedSession,
            sessionId: abortedSessionId,
            loadSessionMessages,
            setChatMessages,
            setSessionMessages,
            provider,
            preserveLiveMessages: false,
          });
        } else {
          updateChatMessages({
            type: 'errorMessageAppended',
            content: 'Stop request failed. The session is still running.',
          });
        }
        break;
      }

      case 'session-status': {
        const statusSessionId = latestMessage.sessionId;
        const statusCbwSessionId = latestMessage.ozwSessionId || latestMessage.ozw_session_id || null;
        if (!statusSessionId) {
          break;
        }

        const isCurrentSession =
          statusSessionId === currentSessionId
          || statusCbwSessionId === currentSessionId
          || statusSessionId === selectedRouteSessionId
          || statusCbwSessionId === selectedRouteSessionId
          || (selectedSession && (
            statusSessionId === selectedSession.id
            || statusCbwSessionId === selectedSession.id
            || statusSessionId === activeProviderSessionId
            || statusCbwSessionId === activeProviderSessionId
          ));

        const statusSessionAliases = isCurrentSession
          ? collectSessionIds(
            statusSessionId,
            statusCbwSessionId,
            currentSessionId,
            selectedSession?.id,
            selectedRouteSessionId,
            activeProviderSessionId,
            pendingViewSessionRef.current?.sessionId,
          )
          : collectSessionIds(statusSessionId, statusCbwSessionId);

        if (latestMessage.isProcessing) {
          const turnStartedAt = latestMessage.turnStartedAt || latestMessage.turn_started_at || null;
          statusSessionAliases.forEach((sessionId) => {
            sessionStorage.setItem(`ozw-processing-session:${sessionId}`, '1');
          });
          if (latestMessage.turnId || latestMessage.turn_id) {
            statusSessionAliases.forEach((sessionId) => {
              sessionStorage.setItem(`ozw-active-turn:${sessionId}`, String(latestMessage.turnId || latestMessage.turn_id));
            });
            // Only allow abort when the backend has confirmed an active turn.
            if (isCurrentSession) {
              setCanAbortSession(true);
            }
          }
          statusSessionAliases.forEach((sessionId) => {
            onSessionProcessing?.(sessionId);
          });
          if (isCurrentSession) {
            setIsLoading(true);
            setActiveTurnStartedAt(turnStartedAt ? String(turnStartedAt) : null);
          }
          break;
        }

        clearRealtimeSessionMarkers(...statusSessionAliases).forEach((sessionId) => {
          onSessionInactive?.(sessionId);
          onSessionNotProcessing?.(sessionId);
        });
        if (isCurrentSession) {
          clearLoadingIndicators();
          setActiveTurnStartedAt(null);
        }
        break;
      }

        default:
          break;
      }
    });
  }, [
    messageHistory,
    provider,
    selectedProject,
    selectedSession,
    currentSessionId,
    setCurrentSessionId,
    setChatMessages,
    setIsLoading,
    setActiveTurnStartedAt,
    setCanAbortSession,
    setTokenBudget,
    setIsSystemSessionChange,
    setPendingPermissionRequests,
    sendMessage,
    onSessionInactive,
    onSessionProcessing,
    onSessionNotProcessing,
    onReplaceTemporarySession,
    onNavigateToSession,
    onRawMessage,
  ]);
}
