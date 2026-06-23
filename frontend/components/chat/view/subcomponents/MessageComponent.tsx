/**
 * PURPOSE: Render one chat transcript row, including user bubbles, assistant
 * text, thinking output, tool cards, and compact task notifications.
 */
import React, { memo, useMemo, useState, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { ChatMessage, Provider } from '../../types/types';
import { Markdown } from './Markdown';
import { formatUsageLimitText } from '../../utils/chatFormatting';
import type { Project } from '../../../../types/app';
import { ToolRenderer, shouldHideToolResult } from '../../tools';
import { trimOuterBlankLines } from '../../utils/toolTextNormalization';
import { formatPathRelativeToProject } from '../../../../utils/pathDisplay';

/**
 * Identify realtime-only tool cards whose result has not converged through
 * JSONL yet.
 */
function isLiveToolSource(source: unknown): boolean {
  return source === 'codex-live' ||
    source === 'codex-realtime' ||
    source === 'pi-live' ||
    source === 'claude-realtime';
}

/**
 * Detect Codex realtime rows whose surrounding session already supplies the
 * provider context, so repeated row metadata adds noise during streaming.
 */
function isCodexLiveAssistant(message: ChatMessage): boolean {
  return message.type === 'assistant'
    && (message.source === 'codex-live' || message.source === 'codex-realtime');
}

type DiffLine = {
  type: string;
  content: string;
  lineNum: number;
};

interface MessageComponentProps {
  message: ChatMessage;
  index: number;
  prevMessage: ChatMessage | null;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  autoExpandTools?: boolean;
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject?: Project | null;
  provider: Provider | string;
}

type InteractiveOption = {
  number: string;
  text: string;
  isSelected: boolean;
};

/**
 * Format task runtime as a compact human-readable duration badge.
 */
function formatTaskDurationMs(value: unknown): string | null {
  const durationMs = Number(value);
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return null;
  }

  const totalSeconds = Math.round(durationMs / 1000);
  if (totalSeconds <= 0) {
    return '<1s';
  }

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes.toString().padStart(2, '0')}m`;
}

/**
 * Render a single chat transcript message using shared visual contracts for
 * provider-agnostic flags such as isThinking and isToolUse.
 */
const MessageComponent = memo(({ message, index, prevMessage, createDiff, onFileOpen, onShowSettings, autoExpandTools, showRawParameters, showThinking, selectedProject, provider }: MessageComponentProps) => {
  const { t } = useTranslation('chat');
  const messageAttachments = Array.isArray(message.attachments)
    ? message.attachments
    : (Array.isArray(message.images) ? message.images : []);
  const isGrouped = prevMessage && prevMessage.type === message.type &&
    ((prevMessage.type === 'assistant') ||
      (prevMessage.type === 'user') ||
      (prevMessage.type === 'error'));
  const messageRef = React.useRef<HTMLDivElement | null>(null);
  const formattedTime = useMemo(() => new Date(message.timestamp).toLocaleTimeString(), [message.timestamp]);

  // Thinking block collapse state — persisted across streaming updates
  // for the same message (messageKey stays stable during streaming).
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  useEffect(() => {
    setThinkingExpanded(false);
  }, [message.messageKey]);

  const userStyles = useMemo(() => {
    switch (message.deliveryStatus) {
      case 'pending':
        return {
          bubble: 'bg-transparent border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100',
          attachment: 'bg-gray-100/50 dark:bg-gray-700/30 text-gray-700 dark:text-gray-300',
          meta: 'text-gray-500 dark:text-gray-400',
          icon: 'text-gray-500 dark:text-gray-400',
          avatar: 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
        };
      case 'sent':
        return {
          bubble: 'bg-blue-600 text-white',
          attachment: 'bg-blue-500/30 text-blue-50',
          meta: 'text-blue-100',
          icon: 'text-blue-200',
          avatar: 'bg-blue-600 text-white',
        };
      case 'persisted':
        return {
          bubble: 'bg-green-600 text-white',
          attachment: 'bg-green-500/30 text-green-50',
          meta: 'text-green-100',
          icon: 'text-green-200',
          avatar: 'bg-green-600 text-white',
        };
      case 'failed':
        return {
          bubble: 'bg-red-600 text-white',
          attachment: 'bg-red-500/30 text-red-50',
          meta: 'text-red-100',
          icon: 'text-red-200',
          avatar: 'bg-red-600 text-white',
        };
      default:
        return {
          bubble: 'bg-green-600 text-white',
          attachment: 'bg-green-500/30 text-green-50',
          meta: 'text-green-100',
          icon: 'text-green-200',
          avatar: 'bg-green-600 text-white',
        };
    }
  }, [message.deliveryStatus]);
  const messageProvider = message.provider === 'codex' || message.provider === 'pi'
    ? message.provider
    : provider;
  // Tool card rendering applies to both Codex and Pi
  const isToolCard = Boolean(message.isToolUse);
  const isRunningTool = isToolCard && (message.exitCode === null || message.status === 'running');
  const toolRenderId = useMemo(() => {
    /**
     * Persisted command_execution rows can render as one combined command/output
     * card without carrying a provider tool id. Use the stable message identity
     * as a rendering anchor so output details remain inspectable.
     */
    if (!isToolCard) return undefined;
    const rawId = message.toolId || message.toolCallId || message.messageKey || `${index}`;
    return String(rawId).replace(/[^A-Za-z0-9_-]/g, '-');
  }, [index, isToolCard, message.messageKey, message.toolCallId, message.toolId]);
  const [errorDetailsOpen, setErrorDetailsOpen] = useState(false);
  const normalizedToolErrorContent = trimOuterBlankLines(String(message.toolResult?.content || ''));
  const assistantLabel = messageProvider === 'codex'
    ? t('messageTypes.codex')
    : messageProvider === 'pi'
      ? t('messageTypes.pi')
      : t('messageTypes.assistant');
  const isCompletedTaskNotification = message.taskStatus === 'completed';
  const isGoalCompletionNotification = isCompletedTaskNotification && message.taskKind === 'goal_complete';
  const completedTaskDuration = useMemo(() => formatTaskDurationMs(message.durationMs), [message.durationMs]);
  const selectedProjectRoot = selectedProject?.fullPath || selectedProject?.path || '';
  const hideAssistantMetadata = isCodexLiveAssistant(message) || (isToolCard && isLiveToolSource(message.source));

  return (
    <div
      ref={messageRef}
      data-message-key={message.messageKey}
      data-delivery-status={message.deliveryStatus || ''}
      className={`chat-message ${message.type} ${isGrouped ? 'grouped' : ''} ${message.type === 'user' ? 'flex justify-end px-3 sm:px-0' : 'px-3 sm:px-0'}`}
    >
      {message.type === 'user' ? (
        /* User message bubble on the right */
        <div className="flex items-end space-x-0 sm:space-x-3 w-full sm:w-auto sm:max-w-[85%] md:max-w-md lg:max-w-lg xl:max-w-xl">
          <div className={`${userStyles.bubble} rounded-2xl rounded-br-md px-3 sm:px-4 py-2 shadow-sm flex-1 sm:flex-initial group`}>
            <div className="text-sm whitespace-pre-wrap break-words">
              {message.content}
            </div>
            {messageAttachments.length > 0 && (
              <div className="mt-2 space-y-2">
                {messageAttachments.map((attachment, idx) => {
                  const attachmentPath = attachment.absolutePath || attachment.relativePath || attachment.name;
                  const displayAttachmentPath = formatPathRelativeToProject(attachmentPath, selectedProjectRoot);

                  return (
                    <div
                      key={`${attachmentPath}-${idx}`}
                      className={`rounded-lg px-3 py-2 text-xs ${userStyles.attachment}`}
                    >
                      <div className="font-medium">{attachment.relativePath || attachment.name}</div>
                      <div className={`break-all ${userStyles.meta}`}>{displayAttachmentPath}</div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className={`flex items-center justify-end gap-1 mt-1 text-xs ${userStyles.meta}`}>
              <span>{formattedTime}</span>
            </div>
          </div>
          {!isGrouped && (
            <div className={`hidden sm:flex w-8 h-8 ${userStyles.avatar} rounded-full items-center justify-center text-sm flex-shrink-0`}>
              U
            </div>
          )}
        </div>
      ) : message.isTaskNotification ? (
        /* Compact task notification on the left */
        isGoalCompletionNotification ? (
          <div className="w-full py-1">
            <div
              data-testid="goal-completion-banner"
              className="relative overflow-hidden rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-sm ring-1 ring-emerald-100 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:ring-emerald-900/60"
            >
              <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-emerald-500 via-teal-400 to-amber-400" />
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm dark:bg-emerald-500">
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M16.704 5.29a1 1 0 010 1.414l-7.25 7.25a1 1 0 01-1.414 0l-3.25-3.25a1 1 0 111.414-1.414l2.543 2.543 6.543-6.543a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">Goal completed</span>
                    {completedTaskDuration && (
                      <span className="rounded-full border border-emerald-200 bg-white/80 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-100">
                        {completedTaskDuration}
                      </span>
                    )}
                  </div>
                  {message.content && (
                    <div className="mt-1 text-sm leading-6 text-emerald-900 dark:text-emerald-100/90">
                      {message.content}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full">
            <div className={isCompletedTaskNotification ? 'flex items-center gap-2 py-0.5' : 'py-0.5'}>
              {isCompletedTaskNotification && (
                <span className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400 dark:bg-green-500" />
              )}
              <span className={isCompletedTaskNotification ? 'text-xs text-gray-500 dark:text-gray-400' : 'text-sm text-gray-700 dark:text-gray-300'}>{message.content}</span>
            </div>
          </div>
        )
      ) : (
        /* Assistant/Error/Tool messages on the left */
        <div className="w-full">
          {!isGrouped && !hideAssistantMetadata && (
            <div className="flex items-center space-x-3 mb-2">
              {message.type === 'error' ? (
                <div className="w-8 h-8 bg-red-600 rounded-full flex items-center justify-center text-white text-sm flex-shrink-0">
                  !
                </div>
              ) : null}
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                {message.type === 'error'
                  ? t('messageTypes.error')
                  : assistantLabel}
              </div>
            </div>
          )}

          <div className="w-full">

            {message.isToolUse ? (
              <div
                data-testid="codex-tool-card"
                data-collapsed={isRunningTool || autoExpandTools ? undefined : 'true'}
              >
                {isRunningTool && (
                  <div className="flex items-center gap-1.5 text-xs py-0.5 text-blue-600 dark:text-blue-400">
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Running...
                  </div>
                )}

                {(Boolean(message.toolInput) || message.isSubagentContainer) && (
                  <ToolRenderer
                    toolName={message.toolName || 'UnknownTool'}
                    toolInput={message.toolInput ?? {}}
                    toolResult={message.toolResult}
                    toolId={toolRenderId}
                    mode="input"
                    onFileOpen={onFileOpen}
                    createDiff={createDiff}
                    selectedProject={selectedProject}
                    autoExpandTools={autoExpandTools}
                    enableResultAnchor={true}
                    showRawParameters={showRawParameters}
                    rawToolInput={typeof message.toolInput === 'string' ? message.toolInput : undefined}
                    isSubagentContainer={message.isSubagentContainer}
                    subagentState={message.subagentState}
                  />
                )}

                {/* Tool Result Section */}
                {message.toolResult && !shouldHideToolResult(message.toolName || 'UnknownTool', message.toolResult) && (
                  message.toolResult.isError ? (
                    // Error results - collapsed details with red error box.
                    // Conditional rendering prevents Chromium from reporting
                    // non-zero getBoundingClientRect for elements inside closed <details>.
                    <details
                      id={`tool-result-${toolRenderId}`}
                      open={errorDetailsOpen}
                      onToggle={(event) => flushSync(() => setErrorDetailsOpen(event.currentTarget.open))}
                    >
                      <summary className="text-xs cursor-pointer font-medium text-gray-500 dark:text-gray-400 py-1 select-none">
                        Output
                      </summary>
                      {errorDetailsOpen && (
                        <div
                          className="relative mt-2 p-3 rounded border scroll-mt-4 bg-red-50/50 dark:bg-red-950/10 border-red-200/60 dark:border-red-800/40"
                        >
                          <div className="relative flex items-center gap-1.5 mb-2">
                            <svg className="w-4 h-4 text-red-500 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            <span className="text-xs font-medium text-red-700 dark:text-red-300">{t('messageTypes.error')}</span>
                          </div>
                          <div className="relative text-sm text-red-900 dark:text-red-100">
                            <Markdown
                              className="prose prose-sm max-w-none prose-red dark:prose-invert"
                              selectedProject={selectedProject}
                              onFileOpen={onFileOpen}
                            >
                              {normalizedToolErrorContent}
                            </Markdown>
                          </div>
                        </div>
                      )}
                    </details>
                  ) : (
                    // Non-error results - ToolRenderer's CollapsibleSection provides
                    // the <details> wrapper with id="tool-result-xxx" and collapse behavior.
                    <ToolRenderer
                      toolName={message.toolName || 'UnknownTool'}
                      toolInput={message.toolInput}
                      toolResult={message.toolResult}
                      toolId={toolRenderId}
                      mode="result"
                      onFileOpen={onFileOpen}
                      createDiff={createDiff}
                      selectedProject={selectedProject}
                      autoExpandTools={autoExpandTools}
                      isSubagentContainer={message.isSubagentContainer}
                      subagentState={message.subagentState}
                    />
                  )
                )}
              </div>
            ) : message.isInteractivePrompt ? (
              // Special handling for interactive prompts
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-amber-900 dark:text-amber-100 text-base mb-3">
                      {t('interactive.title')}
                    </h4>
                    {(() => {
                      const lines = (message.content || '').split('\n').filter((line) => line.trim());
                      const questionLine = lines.find((line) => line.includes('?')) || lines[0] || '';
                      const options: InteractiveOption[] = [];

                      // Parse the menu options
                      lines.forEach((line) => {
                        // Match lines like "❯ 1. Yes" or "  2. No"
                        const optionMatch = line.match(/[❯\s]*(\d+)\.\s+(.+)/);
                        if (optionMatch) {
                          const isSelected = line.includes('❯');
                          options.push({
                            number: optionMatch[1],
                            text: optionMatch[2].trim(),
                            isSelected
                          });
                        }
                      });

                      return (
                        <>
                          <p className="text-sm text-amber-800 dark:text-amber-200 mb-4">
                            {questionLine}
                          </p>

                          {/* Option buttons */}
                          <div className="space-y-2 mb-4">
                            {options.map((option) => (
                              <button
                                key={option.number}
                                className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${option.isSelected
                                  ? 'bg-amber-600 dark:bg-amber-700 text-white border-amber-600 dark:border-amber-700 shadow-md'
                                  : 'bg-white dark:bg-gray-800 text-amber-900 dark:text-amber-100 border-amber-300 dark:border-amber-700'
                                  } cursor-not-allowed opacity-75`}
                                disabled
                              >
                                <div className="flex items-center gap-3">
                                  <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${option.isSelected
                                    ? 'bg-white/20'
                                    : 'bg-amber-100 dark:bg-amber-800/50'
                                    }`}>
                                    {option.number}
                                  </span>
                                  <span className="text-sm sm:text-base font-medium flex-1">
                                    {option.text}
                                  </span>
                                  {option.isSelected && (
                                    <span className="text-lg">❯</span>
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>

                          <div className="bg-amber-100 dark:bg-amber-800/30 rounded-lg p-3">
                            <p className="text-amber-900 dark:text-amber-100 text-sm font-medium mb-1">
                              {t('interactive.waiting')}
                            </p>
                            <p className="text-amber-800 dark:text-amber-200 text-xs">
                              {t('interactive.instruction')}
                            </p>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            ) : message.isThinking ? (
              /* Thinking messages — collapsed to single-line summary with ▶ triangle */
              <div className="text-sm text-gray-700 dark:text-gray-300">
                {(() => {
                  const thinkingContent = String(message.content || '');
                  const lines = thinkingContent.split('\n').filter((l) => l.trim());
                  const lastLine = lines.length > 0 ? lines[lines.length - 1] : '';
                  const hasMultipleLines = lines.length > 1;

                  if (!hasMultipleLines && lines.length === 1) {
                    return (
                      <div className="flex items-start gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                        <svg className="w-3 h-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                        <Markdown
                          className="prose prose-sm max-w-none dark:prose-invert prose-gray min-w-0"
                          selectedProject={selectedProject}
                          onFileOpen={onFileOpen}
                        >
                          {lastLine}
                        </Markdown>
                      </div>
                    );
                  }

                  if (!hasMultipleLines && lines.length === 0) {
                    return null;
                  }

                  return (
                    <details
                      className="group/tk"
                      open={thinkingExpanded}
                      onToggle={(event) => {
                        const open = event.currentTarget.open;
                        setThinkingExpanded(open);
                      }}
                    >
                      <summary className="flex items-center gap-1.5 cursor-pointer select-none text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 py-0.5">
                        <svg
                          className="w-3 h-3 transition-transform duration-150 group-open/tk:rotate-90 flex-shrink-0"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <span className="font-medium text-gray-500 dark:text-gray-400 flex-shrink-0">
                          {t('messageTypes.thinking', { defaultValue: 'Thinking' })}
                        </span>
                        <span className="text-gray-300 dark:text-gray-600 text-[10px] flex-shrink-0">/</span>
                        <span className="truncate text-gray-500 dark:text-gray-400">{lastLine}</span>
                      </summary>
                      {thinkingExpanded && (
                        <div className="mt-1.5 pl-[18px]">
                          <Markdown
                            className="prose prose-sm max-w-none dark:prose-invert prose-gray"
                            selectedProject={selectedProject}
                            onFileOpen={onFileOpen}
                          >
                            {thinkingContent}
                          </Markdown>
                        </div>
                      )}
                    </details>
                  );
                })()}
              </div>
            ) : (
              <div className="text-sm text-gray-700 dark:text-gray-300">
                {/* Thinking accordion for reasoning */}
                {showThinking && message.reasoning && (
                  <details className="mb-3">
                    <summary className="cursor-pointer text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 font-medium">
                      {'\u22EF'}
                    </summary>
                    <div className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                      <div className="whitespace-pre-wrap">
                        {message.reasoning}
                      </div>
                    </div>
                  </details>
                )}

                {(() => {
                  const content = formatUsageLimitText(String(message.content || ''));

                  // Detect if content is pure JSON (starts with { or [)
                  const trimmedContent = content.trim();
                  if ((trimmedContent.startsWith('{') || trimmedContent.startsWith('[')) &&
                    (trimmedContent.endsWith('}') || trimmedContent.endsWith(']'))) {
                    try {
                      const parsed = JSON.parse(trimmedContent);
                      const formatted = JSON.stringify(parsed, null, 2);

                      return (
                        <div className="my-2">
                          <div className="flex items-center gap-2 mb-2 text-sm text-gray-600 dark:text-gray-400">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                            <span className="font-medium">{t('json.response')}</span>
                          </div>
                          <div className="bg-gray-800 dark:bg-gray-900 border border-gray-600/30 dark:border-gray-700 rounded-lg overflow-hidden">
                            <pre className="p-4 overflow-x-auto">
                              <code className="text-gray-100 dark:text-gray-200 text-sm font-mono block whitespace-pre">
                                {formatted}
                              </code>
                            </pre>
                          </div>
                        </div>
                      );
                    } catch {
                      // Not valid JSON, fall through to normal rendering
                    }
                  }

                  // Normal rendering for non-JSON content
                  return message.type === 'assistant' ? (
                    <Markdown
                      className="prose prose-sm max-w-none dark:prose-invert prose-gray"
                      selectedProject={selectedProject}
                      onFileOpen={onFileOpen}
                    >
                      {content}
                    </Markdown>
                  ) : (
                    <div className="whitespace-pre-wrap">
                      {content}
                    </div>
                  );
                })()}
              </div>
            )}

            {!isGrouped && !hideAssistantMetadata && (
              <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                {formattedTime}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default MessageComponent;
