/**
 * Chat composer state and submit flow.
 * Handles user input, command parsing, file mentions, and message dispatch lifecycle.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  SetStateAction,
  TouchEvent,
} from 'react';
import { useDropzone } from 'react-dropzone';
import { authenticatedFetch } from '../../../utils/api';

import { safeLocalStorage } from '../utils/chatStorage';
import type {
  ChatMessage,
  ChatAttachment,
  PendingPermissionRequest,
  PermissionMode,
} from '../types/types';
import { useFileMentions } from '../hooks/useFileMentions';
import { type SlashCommand, useSlashCommands } from '../hooks/useSlashCommands';
import type { Project, ProjectSession, SessionProvider } from '../../../types/app';
import { escapeRegExp } from '../utils/chatFormatting';
import { dedupeAdjacentChatMessages } from '../utils/messageDedup';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import { getIntrinsicMessageKey } from '../utils/messageKeys';
import { markPendingDeliveryFailed } from '../state/deliveryStatusMachine';
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MAX_COUNT,
  validateChatAttachmentQueue,
} from './attachmentQueue';
import {
  CHAT_USER_MESSAGE_DELIVERY_TIMEOUT_MS,
  getChatSubmitBlockReason,
} from './chatSubmitController';
import { getComposerDraftStorageKey, shouldPersistComposerDraft } from './composerDraftState';
import {
  type ActiveComposerSubmit,
  type ComposerSubmitPhase,
  CHAT_SUBMIT_DEDUP_WINDOW_MS,
  createComposerClientRequestId,
  isDuplicateComposerSubmit,
} from './submitDedupPolicy';
import {
  isCbwRouteSessionId,
  isTemporarySessionId,
  type PendingViewSession,
} from '../session/sessionIdentity';

export interface UseChatComposerStateArgs {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: SessionProvider;
  codexModel: string;
  piModel: string;
  piThinkingLevel: string;
  piCanSend?: boolean;
  piUnavailableMessage?: string;
  codexModelSwitchSessionId: string | null;
  codexReasoningEffort: string;
  codexServiceTier: string;
  canAbortSession: boolean;
  tokenBudget: Record<string, unknown> | null;
  chatMessages: ChatMessage[];
  sendMessage: (message: unknown) => void;
  onSessionActive?: (sessionId?: string | null) => void;
  onInputFocusChange?: (focused: boolean) => void;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  pendingViewSessionRef: { current: PendingViewSession | null };
  scrollToBottom: () => void;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setSessionMessages?: Dispatch<SetStateAction<any[]>>;
  setIsLoading: (loading: boolean) => void;
  setCanAbortSession: (canAbort: boolean) => void;

  setIsUserScrolledUp: (isScrolledUp: boolean) => void;
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
  onRequestDispatched?: () => void;
}

interface MentionableFile {
  name: string;
  path: string;
}

interface CommandExecutionResult {
  type: 'alias';
  content?: string;
  hasBashCommands?: boolean;
  hasFileIncludes?: boolean;
}

/**
 * Check the realtime processing marker for a session alias before dispatch.
 */
function hasProcessingSessionMarker(sessionId: string | null | undefined): boolean {
  if (!sessionId || typeof sessionStorage === 'undefined') {
    return false;
  }

  return sessionStorage.getItem(`ozw-processing-session:${sessionId}`) === '1';
}

/**
 * Check whether the backend has reported a concrete active turn for steering.
 */
function hasActiveTurnMarker(sessionId: string | null | undefined): boolean {
  if (!sessionId || typeof sessionStorage === 'undefined') {
    return false;
  }

  return Boolean(sessionStorage.getItem(`ozw-active-turn:${sessionId}`));
}

const DISCONNECTED_SUBMIT_MESSAGE =
  '当前与服务端的实时连接已断开，消息不会被发送。请等待重连后重试。';

/**
 * Preserve the original extension when synthesizing a clipboard filename.
 */
function getClipboardFileExtension(file: File): string {
  const explicitExtension = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : '';
  if (explicitExtension && /^[a-z0-9]+$/.test(explicitExtension)) {
    return explicitExtension;
  }

  const mimeExtension = file.type.split('/')[1]?.toLowerCase().replace(/[^a-z0-9]/g, '');
  return mimeExtension || 'bin';
}

/**
 * Create a deterministic-looking filename for pasted files so repeated
 * clipboard images no longer all appear as `image.png`.
 */
async function buildClipboardUploadFile(file: File): Promise<File> {
  const extension = getClipboardFileExtension(file);
  const fileBuffer = await file.arrayBuffer();
  const hashInput = new Uint8Array(fileBuffer);

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digestBuffer = await crypto.subtle.digest('SHA-256', hashInput);
    const digest = Array.from(new Uint8Array(digestBuffer))
      .map((chunk) => chunk.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 20);
    return new File([file], `${digest}.${extension}`, {
      type: file.type,
      lastModified: file.lastModified,
    });
  }

  const fallbackDigest = `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  return new File([file], `${fallbackDigest.slice(0, 20)}.${extension}`, {
    type: file.type,
    lastModified: file.lastModified,
  });
}

/**
 * Resolve the backend Claude project owner for the active session.
 */
function getActiveSessionProjectName(selectedProject: Project | null, selectedSession: ProjectSession | null): string {
  if (typeof selectedSession?.__projectName === 'string' && selectedSession.__projectName) {
    return selectedSession.__projectName;
  }

  return selectedProject?.name || '';
}

/**
 * Resolve the working directory for the active session.
 * Worktree sessions must continue in their own projectPath instead of the merged parent path.
 */
function getActiveSessionProjectPath(selectedProject: Project | null, selectedSession: ProjectSession | null): string {
  if (typeof selectedSession?.projectPath === 'string' && selectedSession.projectPath) {
    return selectedSession.projectPath;
  }

  return selectedProject?.fullPath || selectedProject?.path || '';
}

function getLastDurableTurnAnchorKey(messages: ChatMessage[]): string {
  /**
   * Resolve the stable history key that anchors the next optimistic turn.
   */
  const latestMessage = messages[messages.length - 1];
  if (
    latestMessage
    && (
      latestMessage.deliveryStatus === 'pending'
      || latestMessage.deliveryStatus === 'sent'
      || latestMessage.source === 'codex-live'
      || latestMessage.source === 'pi-live'
      || latestMessage.source === 'codex-realtime'
    )
  ) {
    const latestKey = getIntrinsicMessageKey(latestMessage);
    if (latestKey) {
      return latestKey;
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.deliveryStatus === 'pending' || message.deliveryStatus === 'sent') {
      continue;
    }
    if (message.source === 'codex-live' || message.source === 'pi-live' || message.source === 'codex-realtime') {
      continue;
    }
    const key = getIntrinsicMessageKey(message);
    if (key) {
      return key;
    }
  }
  return '';
}

export function useChatComposerState({
  selectedProject,
  selectedSession,
  currentSessionId,
  provider,
  codexModel,
  piModel,
  piThinkingLevel,
  piCanSend = true,
  piUnavailableMessage = 'Pi is unavailable. Configure Pi authentication before sending.',
  codexModelSwitchSessionId,
  codexReasoningEffort,
  codexServiceTier,
  canAbortSession,
  tokenBudget,
  chatMessages,
  sendMessage,
  onSessionActive,
  onInputFocusChange,
  onFileOpen,
  onShowSettings,
  pendingViewSessionRef,
  scrollToBottom,
  setChatMessages,
  setSessionMessages,
  setIsLoading,
  setCanAbortSession,
  setIsUserScrolledUp,
  setPendingPermissionRequests,
  onRequestDispatched,
}: UseChatComposerStateArgs) {
  const permissionMode: PermissionMode = 'bypassPermissions';
  const { isConnected } = useWebSocket();
  const [input, setInput] = useState(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      return safeLocalStorage.getItem(getComposerDraftStorageKey(selectedProject.name)) || '';
    }
    return '';
  });
  const [attachedUploads, setAttachedUploads] = useState<File[]>([]);
  const [uploadingAttachments, setUploadingAttachments] = useState<Map<string, number>>(new Map());
  const [attachmentErrors, setAttachmentErrors] = useState<Map<string, string>>(new Map());
  const [isTextareaExpanded, setIsTextareaExpanded] = useState(false);
  const [composerSubmitPhase, setComposerSubmitPhase] = useState<ComposerSubmitPhase>('idle');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputHighlightRef = useRef<HTMLDivElement>(null);
  const inputValueRef = useRef(input);
  const composerSubmitPhaseRef = useRef<ComposerSubmitPhase>('idle');
  const activeSubmitRef = useRef<ActiveComposerSubmit | null>(null);
  const submitCooldownTimerRef = useRef<number | null>(null);
  const deliveryTimeoutsRef = useRef<Map<string, number>>(new Map());

  const updateComposerSubmitPhase = useCallback((phase: ComposerSubmitPhase) => {
    composerSubmitPhaseRef.current = phase;
    setComposerSubmitPhase(phase);
  }, []);

  const resetComposerSubmit = useCallback(() => {
    if (submitCooldownTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(submitCooldownTimerRef.current);
      submitCooldownTimerRef.current = null;
    }
    activeSubmitRef.current = null;
    updateComposerSubmitPhase('idle');
  }, [updateComposerSubmitPhase]);

  const armSubmitCooldown = useCallback(() => {
    if (typeof window === 'undefined') {
      resetComposerSubmit();
      return;
    }

    updateComposerSubmitPhase('cooldown');
    if (submitCooldownTimerRef.current !== null) {
      window.clearTimeout(submitCooldownTimerRef.current);
    }
    submitCooldownTimerRef.current = window.setTimeout(() => {
      submitCooldownTimerRef.current = null;
      activeSubmitRef.current = null;
      updateComposerSubmitPhase('idle');
    }, CHAT_SUBMIT_DEDUP_WINDOW_MS);
  }, [resetComposerSubmit, updateComposerSubmitPhase]);

  /**
   * Mark optimistic user messages as failed if no persisted transcript confirms
   * the send within the user-visible delivery window.
   */
  const armUserMessageDeliveryTimeout = useCallback((clientRequestId: string) => {
    if (typeof window === 'undefined') {
      return;
    }

    const existingTimer = deliveryTimeoutsRef.current.get(clientRequestId);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }

    const timerId = window.setTimeout(() => {
      deliveryTimeoutsRef.current.delete(clientRequestId);
      setChatMessages((previous) => previous.map((message) => {
        if (
          message.type === 'user'
          && message.clientRequestId === clientRequestId
          && message.deliveryStatus === 'pending'
        ) {
          return { ...message, deliveryStatus: markPendingDeliveryFailed(message.deliveryStatus) };
        }
        return message;
      }));
    }, CHAT_USER_MESSAGE_DELIVERY_TIMEOUT_MS);

    deliveryTimeoutsRef.current.set(clientRequestId, timerId);
  }, [setChatMessages]);

  const handleCustomCommand = useCallback(async (
    result: CommandExecutionResult,
    appendBaseInput = '',
  ) => {
    const { content } = result;

    const commandContent = (content || '').trim();
    const baseInput = appendBaseInput.trimEnd();
    const nextInput = baseInput && commandContent
      ? `${baseInput}\n\n${commandContent}`
      : (baseInput || commandContent);

    setInput(nextInput);
    inputValueRef.current = nextInput;
    if (!textareaRef.current) {
      return;
    }

    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
  }, []);

  const executeCommand = useCallback(
    async (command: SlashCommand, rawInput?: string, appendBaseInput = '') => {
      if (!command) {
        return;
      }

      try {
        const effectiveInput = rawInput ?? input;
        const resolvedProjectPath = getActiveSessionProjectPath(selectedProject, selectedSession);
        const resolvedProjectName = getActiveSessionProjectName(selectedProject, selectedSession);
        const commandMatch = effectiveInput.match(new RegExp(`${escapeRegExp(command.name)}\\s*(.*)`));
        const args =
          commandMatch && commandMatch[1] ? commandMatch[1].trim().split(/\s+/) : [];

        const context = {
          projectPath: resolvedProjectPath,
          projectName: resolvedProjectName,
          sessionId: currentSessionId,
          provider,
          model: provider === 'codex' ? codexModel : undefined,
          reasoningEffort: provider === 'codex' ? codexReasoningEffort : undefined,
          serviceTier: provider === 'codex' ? codexServiceTier : undefined,
          tokenUsage: tokenBudget,
        };

        const response = await authenticatedFetch('/api/commands/execute', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            commandName: command.name,
            commandPath: command.path,
            args,
            context,
          }),
        });

        if (!response.ok) {
          let errorMessage = `Failed to execute command (${response.status})`;
          try {
            const errorData = await response.json();
            errorMessage = errorData?.message || errorData?.error || errorMessage;
          } catch {
            // Ignore JSON parse failures and use fallback message.
          }
          throw new Error(errorMessage);
        }

        const result = (await response.json()) as CommandExecutionResult;
        if (result.type === 'alias') {
          await handleCustomCommand(result, appendBaseInput);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error executing command:', error);
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'assistant',
            content: `Error executing command: ${message}`,
            timestamp: Date.now(),
          },
        ]);
      }
    },
    [
      codexModel,
      codexReasoningEffort,
      codexServiceTier,
      currentSessionId,
      handleCustomCommand,
      input,
      provider,
      selectedProject,
      setChatMessages,
      tokenBudget,
    ],
  );

  const {
    slashCommands,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    handleCommandInputChange,
    handleCommandMenuKeyDown,
  } = useSlashCommands({
    selectedProject,
    input,
    setInput,
    textareaRef,
    onExecuteCommand: executeCommand,
  });

  const {
    showFileDropdown,
    fileSearchQuery,
    setFileSearchQuery,
    fileTree,
    expandedFileTreePaths,
    toggleFileTreeDirectory,
    filteredFiles,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    openFileDropdown,
    setCursorPosition,
    handleFileMentionsKeyDown,
  } = useFileMentions({
    selectedProject,
    input,
    setInput,
    textareaRef,
  });

  const syncInputOverlayScroll = useCallback((target: HTMLTextAreaElement) => {
    if (!inputHighlightRef.current || !target) {
      return;
    }
    inputHighlightRef.current.scrollTop = target.scrollTop;
    inputHighlightRef.current.scrollLeft = target.scrollLeft;
  }, []);

  /**
   * Validate local uploads before the browser sends them to the server.
   */
  const handleAttachmentFiles = useCallback((files: File[]) => {
    const { accepted: validFiles, rejected } = validateChatAttachmentQueue(files);

    if (rejected.length > 0) {
      setAttachmentErrors((previous) => {
        const next = new Map(previous);
        rejected.forEach(({ key, reason }) => {
          next.set(key, reason);
        });
        return next;
      });
    }

    if (validFiles.length > 0) {
      setAttachedUploads((previous) => [...previous, ...validFiles].slice(0, CHAT_ATTACHMENT_MAX_COUNT));
    }
  }, []);

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(event.clipboardData.items);
      const clipboardImagePromises: Array<Promise<File>> = [];

      items.forEach((item) => {
        if (!item.type.startsWith('image/')) {
          return;
        }
        const file = item.getAsFile();
        if (file) {
          clipboardImagePromises.push(buildClipboardUploadFile(file));
        }
      });

      if (clipboardImagePromises.length > 0) {
        void Promise.all(clipboardImagePromises)
          .then((files) => {
            handleAttachmentFiles(files);
          })
          .catch((error) => {
            console.error('Failed to normalize clipboard attachments:', error);
          });
      }

      if (items.length === 0 && event.clipboardData.files.length > 0) {
        const files = Array.from(event.clipboardData.files);
        if (files.length > 0) {
          void Promise.all(files.map((file) => (
            file.type.startsWith('image/')
              ? buildClipboardUploadFile(file)
              : Promise.resolve(file)
          )))
            .then((normalizedFiles) => {
              handleAttachmentFiles(normalizedFiles);
            })
            .catch((error) => {
              console.error('Failed to normalize fallback clipboard files:', error);
            });
        }
      }
    },
    [handleAttachmentFiles],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    maxSize: CHAT_ATTACHMENT_MAX_BYTES,
    maxFiles: CHAT_ATTACHMENT_MAX_COUNT,
    onDrop: handleAttachmentFiles,
    noClick: true,
    noKeyboard: true,
  });

  /**
   * Consume files from a native file or folder picker, then reset the input so
   * choosing the same path again still fires a change event.
   */
  const handleAttachmentSelection = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      handleAttachmentFiles(files);
    }
    event.target.value = '';
  }, [handleAttachmentFiles]);

  const submitComposerInput = useCallback(
    async (currentInput: string) => {
      console.log('[handleSubmit] input:', JSON.stringify(currentInput?.substring(0, 50)),
        'selectedProject:', selectedProject?.name || null,
        'isConnected:', isConnected);
      const submitBlockReason = getChatSubmitBlockReason({
        input: currentInput,
        hasProject: Boolean(selectedProject),
        isConnected,
      });

      if (submitBlockReason === 'empty-input') {
        console.warn('[handleSubmit] Blocked: empty input');
        return;
      }
      if (submitBlockReason === 'missing-project') {
        console.warn('[handleSubmit] Blocked: no project');
        return;
      }
      if (submitBlockReason === 'disconnected') {
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'error',
            content: DISCONNECTED_SUBMIT_MESSAGE,
            timestamp: new Date(),
          },
        ]);
        return;
      }

      const trimmedInput = currentInput.trim();
      const activeProject = selectedProject;
      if (!activeProject) {
        console.warn('[handleSubmit] Blocked: no project after validation');
        return;
      }

      if (provider === 'pi' && !piCanSend) {
        const blockedMessage = piUnavailableMessage.trim()
          || 'Pi is unavailable. Configure Pi authentication before sending.';
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'error',
            content: blockedMessage,
            timestamp: new Date(),
          },
        ]);
        return;
      }

      if (
        composerSubmitPhaseRef.current !== 'idle'
        || isDuplicateComposerSubmit(activeSubmitRef.current, Date.now())
      ) {
        console.warn(
          '[handleSubmit] Blocked duplicate submit during phase:',
          composerSubmitPhaseRef.current,
          'requestId:',
          activeSubmitRef.current?.requestId || null,
        );
        return;
      }

      const clientRequestId = createComposerClientRequestId();
      activeSubmitRef.current = {
        requestId: clientRequestId,
        startedAt: Date.now(),
      };
      updateComposerSubmitPhase(attachedUploads.length > 0 ? 'uploading' : 'dispatching');

      const messageContent = currentInput;
      const turnAnchorKey = getLastDurableTurnAnchorKey(chatMessages);

      let uploadedAttachments: ChatAttachment[] = [];
      if (attachedUploads.length > 0) {
        const uploadProjectName = getActiveSessionProjectName(activeProject, selectedSession);
        const formData = new FormData();
        attachedUploads.forEach((file) => {
          formData.append('attachments', file);
        });
        formData.append('relativePaths', JSON.stringify(
          attachedUploads.map((file) => file.webkitRelativePath || file.name),
        ));

        try {
          const response = await authenticatedFetch(`/api/projects/${uploadProjectName}/upload-attachments`, {
            method: 'POST',
            headers: {},
            body: formData,
          });

          if (!response.ok) {
            throw new Error('Failed to upload attachments');
          }

          const result = await response.json();
          uploadedAttachments = Array.isArray(result.attachments) ? result.attachments : [];
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error('Attachment upload failed:', error);
          setChatMessages((previous) => [
            ...previous,
            {
              type: 'error',
              content: `Failed to upload attachments: ${message}`,
              timestamp: new Date(),
            },
          ]);
          resetComposerSubmit();
          return;
        }
      }

      const userMessage: ChatMessage = {
        type: 'user',
        content: currentInput,
        attachments: uploadedAttachments,
        timestamp: new Date(),
        clientRequestId,
        deliveryStatus: 'pending',
        messageKey: `optimistic:${clientRequestId}`,
        submittedContent: messageContent,
        ...(turnAnchorKey ? { turnAnchorKey } : {}),
      };

      setChatMessages((previous) => dedupeAdjacentChatMessages([...previous, userMessage]) as ChatMessage[]);
      armUserMessageDeliveryTimeout(clientRequestId);
      updateComposerSubmitPhase('dispatching');
      // Disable abort before dispatching the new command to prevent a stale
      // abort-session from a previous session racing with the new request.
      setCanAbortSession(false);
      // Loading state for stop-button visibility; authoritative running status
      // comes from provider session-status events, not from the local composer.
      setIsLoading(true);

      setIsUserScrolledUp(false);
      setTimeout(() => scrollToBottom(), 100);

      const selectedRouteSessionId = isCbwRouteSessionId(selectedSession?.id)
        ? selectedSession?.id || null
        : Number.isInteger(Number(selectedSession?.routeIndex))
          ? `c${Number(selectedSession?.routeIndex)}`
          : null;
      const routePathSessionId = typeof window !== 'undefined'
        ? window.location.pathname.match(/\/(c\d+)(?:[/?#].*)?$/)?.[1] || null
        : null;
      const routeIdentityMismatch = Boolean(routePathSessionId && selectedRouteSessionId !== routePathSessionId);
      const shouldCreateNewCodexSession = provider === 'codex'
        && selectedSession?.__provider === 'codex'
        && Boolean(selectedSession?.id)
        && codexModelSwitchSessionId === selectedSession.id;
      const candidateSessionId = routeIdentityMismatch
        ? null
        : currentSessionId || selectedSession?.id || null;
      const effectiveSessionId =
        shouldCreateNewCodexSession || isTemporarySessionId(candidateSessionId) || isCbwRouteSessionId(candidateSessionId)
          ? null
          : candidateSessionId;
      const ozwSessionId = routePathSessionId || selectedRouteSessionId || (
        !effectiveSessionId && isCbwRouteSessionId(candidateSessionId)
          ? candidateSessionId
          : null
      );
      const sessionToActivate = candidateSessionId || effectiveSessionId || `new-session-${Date.now()}`;

      if (!effectiveSessionId && (!selectedSession?.id || isTemporarySessionId(selectedSession.id))) {
        pendingViewSessionRef.current = {
          sessionId: null,
          startedAt: Date.now(),
          clientRequestId,
          draftSessionId: selectedSession?.id || null,
        };
      }
      onSessionActive?.(sessionToActivate);
      // onSessionProcessing removed: provider lifecycle is authoritative from provider/ozw flow.

      const getToolsSettings = () => {
        try {
          const settingsKey =
            provider === 'codex'
                ? 'codex-settings'
                : 'pi-settings';
          const savedSettings = safeLocalStorage.getItem(settingsKey);
          if (savedSettings) {
            const parsed = JSON.parse(savedSettings);
            return parsed;
          }
        } catch (error) {
          console.error('Error loading tools settings:', error);
        }

        return {
          allowedTools: [],
          disallowedTools: [],
          skipPermissions: false,
        };
      };

      const toolsSettings = getToolsSettings();
      const resolvedProjectPath = getActiveSessionProjectPath(selectedProject, selectedSession);
      const resolvedProjectName = getActiveSessionProjectName(selectedProject, selectedSession);

      // Determine send policy based on provider native capabilities.
      const providerCapabilities = provider === 'codex'
        ? { runningInput: ['steer', 'abort-and-send'], steer: true, followUp: false }
        : { runningInput: ['steer', 'followUp'], steer: true, followUp: true };

      let runningBehavior: string | undefined;
      const runtimeSessionIds = [
        effectiveSessionId,
        ozwSessionId,
        selectedSession?.id,
        selectedSession?.providerSessionId,
      ];
      const sessionIsProcessing = runtimeSessionIds.some((id) =>
        hasProcessingSessionMarker(id as string | null | undefined));
      const sessionHasActiveTurn = runtimeSessionIds.some((id) =>
        hasActiveTurnMarker(id as string | null | undefined));

      if (provider === 'codex') {
        if (canAbortSession || sessionHasActiveTurn) {
          runningBehavior = 'steer';
        }
      } else if (canAbortSession || sessionIsProcessing) {
        runningBehavior = 'steer';
      }

      if (provider === 'codex') {
        sendMessage({
          type: 'codex-command',
          clientRequestId,
          command: messageContent,
          sessionId: effectiveSessionId,
          ozwSessionId,
          ozw_session_id: ozwSessionId,
          startRequestId: clientRequestId,
          start_request_id: clientRequestId,
          clientRef: messageContent,
          client_ref: messageContent,
          turnAnchorKey,
          options: {
            cwd: resolvedProjectPath,
            projectPath: resolvedProjectPath,
            projectName: resolvedProjectName,
            sessionId: effectiveSessionId,
            ozwSessionId,
            ozw_session_id: ozwSessionId,
            clientRequestId,
            startRequestId: clientRequestId,
            start_request_id: clientRequestId,
            clientRef: messageContent,
            client_ref: messageContent,
            turnAnchorKey,
            resume: Boolean(effectiveSessionId),
            model: codexModel,
            reasoningEffort: codexReasoningEffort,
            serviceTier: codexServiceTier || null,
            permissionMode,
            attachments: uploadedAttachments,
            runningBehavior,
          },
        });
      }
      // Do NOT re-enable abort here.  Authoritative abortability comes
      // exclusively from provider session-status events carrying an active_turn_id.
      // Setting canAbortSession prematurely would allow abort-session to be
      // sent before the provider acknowledges a turn, violating the spec.
      armSubmitCooldown();
      onRequestDispatched?.();

      setInput('');
      inputValueRef.current = '';
      resetCommandMenuState();
      setAttachedUploads([]);
      setUploadingAttachments(new Map());
      setAttachmentErrors(new Map());
      setIsTextareaExpanded(false);

      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }

      safeLocalStorage.removeItem(getComposerDraftStorageKey(activeProject.name));
    },
    [
      attachedUploads,
      codexModel,
      piModel,
      piThinkingLevel,
      piCanSend,
      piUnavailableMessage,
      codexModelSwitchSessionId,
      codexReasoningEffort,
      codexServiceTier,
      chatMessages,
      currentSessionId,
      executeCommand,
      onSessionActive,
      isConnected,
      pendingViewSessionRef,
      permissionMode,
      provider,
      resetCommandMenuState,
      scrollToBottom,
      selectedProject,
      selectedSession?.id,
      sendMessage,
      setCanAbortSession,
      setChatMessages,
      setIsLoading,
      setIsUserScrolledUp,
      slashCommands,
      onRequestDispatched,
      armUserMessageDeliveryTimeout,
      armSubmitCooldown,
      resetComposerSubmit,
      updateComposerSubmitPhase,
      setIsLoading,
    ],
  );

  /**
   * Submit the current textarea content from a user interaction event.
   */
  const handleSubmit = useCallback(
    async (
      event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>,
    ) => {
      event.preventDefault();
      await submitComposerInput(inputValueRef.current);
    },
    [submitComposerInput],
  );

  /**
   * Submit a synthetic workflow prompt through the same path as a manual send.
   */
  const submitAutomatedInput = useCallback(
    async (nextInput: string) => {
      const normalizedInput = String(nextInput || '');
      if (!normalizedInput.trim()) {
        return;
      }

      setInput(normalizedInput);
      inputValueRef.current = normalizedInput;
      await submitComposerInput(normalizedInput);
    },
    [setInput, submitComposerInput],
  );
  useEffect(() => {
    inputValueRef.current = input;
  }, [input]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }
    const initialPrompt = typeof selectedSession?.initialPrompt === 'string' ? selectedSession.initialPrompt : '';
    if (initialPrompt.trim()) {
      setInput(initialPrompt);
      inputValueRef.current = initialPrompt;
      safeLocalStorage.setItem(getComposerDraftStorageKey(selectedProject.name), initialPrompt);
      return;
    }
    const savedInput = safeLocalStorage.getItem(getComposerDraftStorageKey(selectedProject.name)) || '';
    setInput((previous) => {
      const next = previous === savedInput ? previous : savedInput;
      inputValueRef.current = next;
      return next;
    });
  }, [selectedProject?.name, selectedSession?.id, selectedSession?.initialPrompt]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }
    const draftKey = getComposerDraftStorageKey(selectedProject.name);
    if (input !== '' && shouldPersistComposerDraft({ input, projectName: selectedProject.name })) {
      safeLocalStorage.setItem(draftKey, input);
    } else {
      safeLocalStorage.removeItem(draftKey);
    }
  }, [input, selectedProject]);

  useEffect(() => {
    if (!textareaRef.current) {
      return;
    }
    // Re-run when input changes so restored drafts get the same autosize behavior as typed text.
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    const lineHeight = parseInt(window.getComputedStyle(textareaRef.current).lineHeight);
    const expanded = textareaRef.current.scrollHeight > lineHeight * 2;
    setIsTextareaExpanded(expanded);
  }, [input]);

  useEffect(() => {
    if (!textareaRef.current || input.trim()) {
      return;
    }
    textareaRef.current.style.height = 'auto';
    setIsTextareaExpanded(false);
  }, [input]);

  useEffect(() => () => {
    if (submitCooldownTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(submitCooldownTimerRef.current);
    }
    if (typeof window !== 'undefined') {
      deliveryTimeoutsRef.current.forEach((timerId) => window.clearTimeout(timerId));
      deliveryTimeoutsRef.current.clear();
    }
  }, []);

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = event.target.value;
      const cursorPos = event.target.selectionStart;

      setInput(newValue);
      inputValueRef.current = newValue;
      setCursorPosition(cursorPos);

      if (!newValue.trim()) {
        event.target.style.height = 'auto';
        setIsTextareaExpanded(false);
        resetCommandMenuState();
        return;
      }

      handleCommandInputChange(newValue);
    },
    [handleCommandInputChange, resetCommandMenuState, setCursorPosition],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (handleCommandMenuKeyDown(event)) {
        return;
      }

      if (handleFileMentionsKeyDown(event)) {
        return;
      }

      if (event.key === 'Enter') {
        if (event.nativeEvent.isComposing) {
          return;
        }

        if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
          event.preventDefault();
          handleSubmit(event);
        }
      }
    },
    [
      handleCommandMenuKeyDown,
      handleFileMentionsKeyDown,
      handleSubmit,
      showCommandMenu,
      showFileDropdown,
    ],
  );

  const handleTextareaClick = useCallback(
    (event: MouseEvent<HTMLTextAreaElement>) => {
      setCursorPosition(event.currentTarget.selectionStart);
    },
    [setCursorPosition],
  );

  const handleTextareaInput = useCallback(
    (event: FormEvent<HTMLTextAreaElement>) => {
      const target = event.currentTarget;
      target.style.height = 'auto';
      target.style.height = `${target.scrollHeight}px`;
      setCursorPosition(target.selectionStart);
      syncInputOverlayScroll(target);

      const lineHeight = parseInt(window.getComputedStyle(target).lineHeight);
      setIsTextareaExpanded(target.scrollHeight > lineHeight * 2);
    },
    [setCursorPosition, syncInputOverlayScroll],
  );

  const handleClearInput = useCallback(() => {
    setInput('');
    inputValueRef.current = '';
    resetCommandMenuState();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.focus();
    }
    setIsTextareaExpanded(false);
  }, [resetCommandMenuState]);

  const handleAbortSession = useCallback(() => {
    if (!canAbortSession) {
      return;
    }

    const candidateSessionIds = [
      currentSessionId,
      pendingViewSessionRef.current?.sessionId || null,
      selectedSession?.id || null,
    ];
    const selectedRouteSessionId = Number.isInteger(Number(selectedSession?.routeIndex))
      ? `c${Number(selectedSession?.routeIndex)}`
      : null;

    const concreteSessionId =
      candidateSessionIds.find((sessionId) =>
        Boolean(sessionId) && !isTemporarySessionId(sessionId) && !isCbwRouteSessionId(sessionId)) || null;
    const draftSessionId =
      selectedRouteSessionId || pendingViewSessionRef.current?.draftSessionId || selectedSession?.id || currentSessionId || null;
    const targetSessionId = concreteSessionId || selectedRouteSessionId || (isTemporarySessionId(draftSessionId) ? draftSessionId : null);

    if (!targetSessionId) {
      console.warn('Abort requested but no session ID is available yet.');
      return;
    }
    sendMessage({
      type: 'abort-session',
      sessionId: targetSessionId,
      ozwSessionId: selectedRouteSessionId || (isTemporarySessionId(draftSessionId) ? draftSessionId : null),
      startRequestId: pendingViewSessionRef.current?.clientRequestId || null,
      projectName: getActiveSessionProjectName(selectedProject, selectedSession),
      projectPath: getActiveSessionProjectPath(selectedProject, selectedSession),
      provider,
    });
  }, [canAbortSession, currentSessionId, pendingViewSessionRef, provider, selectedProject, selectedSession, sendMessage]);

  const handleTranscript = useCallback((text: string) => {
    if (!text.trim()) {
      return;
    }

    setInput((previousInput) => {
      const newInput = previousInput.trim() ? `${previousInput} ${text}` : text;
      inputValueRef.current = newInput;

      setTimeout(() => {
        if (!textareaRef.current) {
          return;
        }

        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        const lineHeight = parseInt(window.getComputedStyle(textareaRef.current).lineHeight);
        setIsTextareaExpanded(textareaRef.current.scrollHeight > lineHeight * 2);
      }, 0);

      return newInput;
    });
  }, []);

  const [isInputFocused, setIsInputFocused] = useState(false);

  const handleInputFocusChange = useCallback(
    (focused: boolean) => {
      setIsInputFocused(focused);
      onInputFocusChange?.(focused);
    },
    [onInputFocusChange],
  );

  return {
    input,
    setInput,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    showFileDropdown,
    fileSearchQuery,
    setFileSearchQuery,
    fileTree,
    expandedFileTreePaths,
    toggleFileTreeDirectory,
    filteredFiles: filteredFiles as MentionableFile[],
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    openFileDropdown,
    handleFileMentionsKeyDown,
    attachedUploads,
    setAttachedUploads,
    uploadingAttachments,
    attachmentErrors,
    isComposerSubmitting: composerSubmitPhase !== 'idle',
    getRootProps,
    getInputProps,
    isDragActive,
    openAttachmentPicker: open,
    handleAttachmentSelection,
    handleSubmit,
    submitAutomatedInput,
    handleInputChange,
    handleKeyDown,
    handlePaste,
    handleTextareaClick,
    handleTextareaInput,
    syncInputOverlayScroll,
    handleClearInput,
    handleAbortSession,
    handleTranscript,
    handleInputFocusChange,
    isInputFocused,
  };
}
