/**
 * PURPOSE: Render delegated subagent lifecycle and child tool timeline.
 */
import React, { useState, useMemo } from 'react';
const Loader2 = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4 animate-spin"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>;
const CheckCircle2 = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 6-6"/></svg>;
const XCircle = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>;
const Circle = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>;
const ChevronDown = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>;
const ChevronRight = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>;
const Bot = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7v-2M16 7v-2"/><circle cx="12" cy="3" r="2"/><path d="M12 12v.01"/></svg>;
const AlertTriangle = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
import { CollapsibleSection } from './CollapsibleSection';
import { Markdown } from '../../view/subcomponents/Markdown';
import type { SubagentChildTool } from '../../types/types';
import {
  isSubagentToolCall,
  summarizeSubagentToolInput,
} from '../../../../../shared/subagent-tool-utils.js';

interface SubagentContainerProps {
  toolName: string;
  toolInput: unknown;
  toolResult?: { content?: unknown; isError?: boolean } | null;
  subagentState: {
    childTools: SubagentChildTool[];
    currentToolIndex: number;
    isComplete: boolean;
  };
  isLiveTool?: boolean;
}

/* ─── helpers ─── */

const getCompactToolDisplay = (toolName: string, toolInput: unknown): string => {
  const input = typeof toolInput === 'string'
    ? (() => { try { return JSON.parse(toolInput); } catch { return {}; } })()
    : (toolInput || {});

  if (isSubagentToolCall(toolName, toolInput)) {
    const summary = summarizeSubagentToolInput(toolInput);
    return summary.description || summary.subagentType;
  }

  switch (toolName) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'ApplyPatch':
      return input.file_path?.split('/').pop() || input.file_path || '';
    case 'Grep':
    case 'Glob':
      return input.pattern || '';
    case 'Bash': {
      const cmd = input.command || '';
      return cmd.length > 45 ? `${cmd.slice(0, 45)}...` : cmd;
    }
    case 'WebFetch':
    case 'WebSearch':
      return input.url || input.query || '';
    default:
      return '';
  }
};

type ToolStatus = 'running' | 'done' | 'error' | 'pending';
type LifecycleStatus = 'start' | 'active' | 'done' | 'error' | 'pending';

const getToolStatus = (child: SubagentChildTool, isCurrent: boolean): ToolStatus => {
  if (isCurrent) return 'running';
  if (child.toolResult?.isError) return 'error';
  if (child.toolResult) return 'done';
  return 'pending';
};

const lifecycleToneMap: Record<LifecycleStatus, { dot: string; text: string; connector: string }> = {
  start: {
    dot: 'bg-sky-50 text-sky-600 ring-1 ring-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:ring-sky-800/70',
    text: 'text-sky-700 dark:text-sky-300',
    connector: 'bg-sky-200 dark:bg-sky-800/70',
  },
  active: {
    dot: 'bg-purple-50 text-purple-600 ring-1 ring-purple-200 dark:bg-purple-950/30 dark:text-purple-300 dark:ring-purple-800/70',
    text: 'text-purple-700 dark:text-purple-300',
    connector: 'bg-purple-200 dark:bg-purple-800/70',
  },
  done: {
    dot: 'bg-green-50 text-green-600 ring-1 ring-green-200 dark:bg-green-950/30 dark:text-green-300 dark:ring-green-800/70',
    text: 'text-green-700 dark:text-green-300',
    connector: 'bg-gray-200 dark:bg-gray-700',
  },
  error: {
    dot: 'bg-red-50 text-red-600 ring-1 ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-800/70',
    text: 'text-red-700 dark:text-red-300',
    connector: 'bg-red-200 dark:bg-red-800/70',
  },
  pending: {
    dot: 'bg-gray-50 text-gray-400 ring-1 ring-gray-200 dark:bg-gray-900/40 dark:text-gray-500 dark:ring-gray-700/70',
    text: 'text-gray-500 dark:text-gray-400',
    connector: 'bg-gray-200 dark:bg-gray-700',
  },
};

/**
 * Choose the lifecycle marker icon shown in the subagent timeline.
 */
const getLifecycleStatusIcon = (status: LifecycleStatus): React.ReactNode => {
  switch (status) {
    case 'start':
      return <Bot className="w-3.5 h-3.5" />;
    case 'active':
      return <Loader2 className="w-3.5 h-3.5 animate-spin" />;
    case 'done':
      return <CheckCircle2 className="w-3.5 h-3.5" />;
    case 'error':
      return <AlertTriangle className="w-3.5 h-3.5" />;
    case 'pending':
      return <Circle className="w-3.5 h-3.5" />;
  }
};

/**
 * Build the compact lifecycle progress text used by the status chip and end node.
 */
const buildLifecycleSummary = (completedTools: number, totalTools: number, errorTools: number): string => {
  const base = totalTools > 0 ? `${completedTools}/${totalTools} done` : 'No child tools recorded';
  return errorTools > 0 ? `${base}, ${errorTools} error${errorTools > 1 ? 's' : ''}` : base;
};

/* ─── lifecycle row ─── */

const LifecycleTimelineRow: React.FC<{
  title: string;
  description?: string;
  status: LifecycleStatus;
  showConnector?: boolean;
}> = ({ title, description, status, showConnector = true }) => {
  /** Render one start/end lifecycle row while keeping child tools visually aligned. */
  const tone = lifecycleToneMap[status];

  return (
    <div className="relative">
      {showConnector && (
        <div className={`absolute left-[9px] top-6 bottom-0 w-px ${tone.connector}`} />
      )}
      <div className="flex items-start gap-2 py-1.5">
        <div className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${tone.dot}`}>
          {getLifecycleStatusIcon(status)}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-xs font-semibold ${tone.text}`}>
            {title}
          </div>
          {description && (
            <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400 break-words">
              {description}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ─── child tool row ─── */

const ChildToolRow: React.FC<{
  child: SubagentChildTool;
  index: number;
  isCurrent: boolean;
}> = ({ child, index, isCurrent }) => {
  const [expanded, setExpanded] = useState(false);
  const status = getToolStatus(child, isCurrent);
  const compact = getCompactToolDisplay(child.toolName, child.toolInput);

  const statusIcon = (() => {
    switch (status) {
      case 'running':
        return <Loader2 className="w-3.5 h-3.5 text-purple-500 animate-spin" />;
      case 'done':
        return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
      case 'error':
        return <XCircle className="w-3.5 h-3.5 text-red-500" />;
      case 'pending':
        return <Circle className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600" />;
    }
  })();

  const parsedInput = useMemo(() => {
    if (typeof child.toolInput === 'string') {
      try { return JSON.parse(child.toolInput); } catch { return child.toolInput; }
    }
    return child.toolInput;
  }, [child.toolInput]);

  const hasResult = child.toolResult && (child.toolResult.content !== undefined || child.toolResult.isError);

  return (
    <div className="relative">
      {/* timeline connector */}
      <div className="absolute left-[9px] top-5 bottom-0 w-px bg-gray-200 dark:bg-gray-700" />

      <div className="flex items-start gap-2 py-1">
        {/* status dot */}
        <div className="mt-0.5 flex-shrink-0 w-5 h-5 flex items-center justify-center">
          {statusIcon}
        </div>

        {/* content */}
        <div className="flex-1 min-w-0">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className={`flex items-center gap-1.5 text-xs w-full text-left hover:opacity-80 transition-opacity ${hasResult || parsedInput ? 'cursor-pointer' : 'cursor-default'}`}
          >
            <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300">
              Step {index + 1}
            </span>
            {compact && (
              <span className="text-gray-500 dark:text-gray-400 truncate font-mono">
                {compact}
              </span>
            )}
            {(hasResult || parsedInput) && (
              <span className="flex-shrink-0 text-gray-400 dark:text-gray-500">
                {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </span>
            )}
          </button>

          {expanded && (
            <div className="mt-1.5 space-y-1.5">
              {/* Input */}
              {parsedInput && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium mb-0.5">
                    Input
                  </div>
                  <pre className="text-[11px] bg-gray-50 dark:bg-gray-900/50 border border-gray-200/40 dark:border-gray-700/40 p-2 rounded whitespace-pre-wrap break-words overflow-hidden text-gray-600 dark:text-gray-400 font-mono">
                    {typeof parsedInput === 'string' ? parsedInput : JSON.stringify(parsedInput, null, 2)}
                  </pre>
                </div>
              )}
              {/* Result */}
              {hasResult && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium mb-0.5">
                    {child.toolResult?.isError ? 'Error' : 'Result'}
                  </div>
                  <pre className={`text-[11px] border p-2 rounded whitespace-pre-wrap break-words overflow-hidden font-mono ${
                    child.toolResult?.isError
                      ? 'bg-red-50 dark:bg-red-950/20 border-red-200/40 dark:border-red-800/40 text-red-700 dark:text-red-300'
                      : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200/40 dark:border-gray-700/40 text-gray-600 dark:text-gray-400'
                  }`}>
                    {typeof child.toolResult?.content === 'string'
                      ? child.toolResult.content
                      : JSON.stringify(child.toolResult?.content, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ─── main component ─── */

export const SubagentContainer: React.FC<SubagentContainerProps> = ({
  toolName,
  toolInput,
  toolResult,
  subagentState,
  isLiveTool = false,
}) => {
  const subagentSummary = useMemo(() => summarizeSubagentToolInput(toolInput), [toolInput]);
  const subagentType = subagentSummary.subagentType;
  const description = subagentSummary.description;
  const prompt = subagentSummary.prompt;
  const taskName = subagentSummary.taskName;
  const command = subagentSummary.command;
  const { childTools, currentToolIndex, isComplete } = subagentState;
  const currentTool = currentToolIndex >= 0 ? childTools[currentToolIndex] : null;

  const isError = toolResult?.isError;
  const totalTools = childTools.length;
  const completedTools = childTools.filter(c => c.toolResult && !c.toolResult.isError).length;
  const errorTools = childTools.filter(c => c.toolResult?.isError).length;
  const lifecycleSummary = buildLifecycleSummary(completedTools, totalTools, errorTools);
  const endNodeStatus: LifecycleStatus = isError ? 'error' : isComplete ? 'done' : 'pending';
  const endNodeTitle = isError ? 'Task failed' : isComplete ? 'Task completed' : 'Waiting for task end';
  const startNodeDescription = [subagentType, description].filter(Boolean).join(' / ');

  // Keep historical child timelines collapsed; only active websocket progress opens by default.
  const defaultOpen = isLiveTool && childTools.length <= 20;

  const titleProgress = totalTools > 0
    ? ` (${completedTools}/${totalTools} done${errorTools > 0 ? `, ${errorTools} errors` : ''})`
    : (isComplete ? ' (done)' : '');
  const title = `${subagentType}: ${description}${titleProgress}`;

  /* ─── result content ─── */
  const resultContent = useMemo(() => {
    if (!toolResult) return null;
    let content = toolResult.content;

    if (typeof content === 'string') {
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          const textParts = parsed
            .filter((p: any) => p.type === 'text' && p.text)
            .map((p: any) => p.text);
          if (textParts.length > 0) content = textParts.join('\n');
        }
      } catch { /* not JSON */ }
    } else if (Array.isArray(content)) {
      const textParts = content
        .filter((p: any) => p.type === 'text' && p.text)
        .map((p: any) => p.text);
      if (textParts.length > 0) content = textParts.join('\n');
    }

    return content;
  }, [toolResult]);

  const normalizedToolName = toolName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const isSpawnSubagent = normalizedToolName.includes('spawn_subagent')
    || normalizedToolName.includes('spawn_agent')
    || Boolean(taskName && command);

  if (isSpawnSubagent) {
    const displayTaskName = taskName || description || 'Agent task';
    const displayCommand = command || prompt;

    return (
      <div
        data-testid="spawn-subagent-card"
        className="my-1 overflow-hidden rounded-xl border border-violet-200/80 bg-gradient-to-br from-violet-50/80 to-white shadow-sm shadow-violet-500/10 dark:border-violet-800/60 dark:from-violet-950/35 dark:to-gray-950/20"
      >
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-600 ring-1 ring-violet-200 dark:bg-violet-900/50 dark:text-violet-300 dark:ring-violet-700/70">
            <Bot className="h-4 w-4" strokeWidth={2} />
          </div>
          <div
            data-testid="spawn-subagent-task-name"
            className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-800 dark:text-gray-100"
            title={displayTaskName}
          >
            {displayTaskName}
          </div>
        </div>
        {displayCommand && (
          <pre
            data-testid="spawn-subagent-command"
            className="m-0 border-t border-violet-100/90 bg-white/65 px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-gray-600 dark:border-violet-900/60 dark:bg-gray-950/35 dark:text-gray-300"
          >
            {displayCommand}
          </pre>
        )}
      </div>
    );
  }

  return (
    <div className="my-1 rounded-lg border border-purple-200/60 bg-purple-50/25 px-3 py-2 shadow-sm shadow-purple-500/5 dark:border-purple-900/45 dark:bg-purple-950/10">
      <CollapsibleSection
        title={title}
        toolName="Subagent"
        open={defaultOpen}
        wrapTitle
      >
        {/* Prompt */}
        {prompt && (
          <div className="mb-3">
            <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium mb-1">
              Prompt
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words bg-gray-50 dark:bg-gray-900/30 rounded px-2 py-1.5">
              {prompt}
            </div>
          </div>
        )}

        {/* Status bar */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {!isComplete ? (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-purple-200 bg-purple-50 px-2 py-1 text-xs text-purple-700 dark:border-purple-800/60 dark:bg-purple-950/25 dark:text-purple-300">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span className="font-medium">
                {currentTool
                  ? 'Running step…'
                  : 'Starting…'}
              </span>
            </div>
          ) : isError ? (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-800/60 dark:bg-red-950/25 dark:text-red-300">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span className="font-medium">Failed</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2 py-1 text-xs text-green-700 dark:border-green-800/60 dark:bg-green-950/25 dark:text-green-300">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span className="font-medium">Completed</span>
            </div>
          )}

          {/* Mini stats */}
          <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
            <span>{lifecycleSummary}</span>
          </div>
        </div>

        {/* Progress bar */}
        {totalTools > 0 && (
          <div className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-full mb-3 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isError ? 'bg-red-500' : isComplete ? 'bg-green-500' : 'bg-purple-500'
              }`}
              style={{
                width: `${isComplete ? 100 : Math.max(5, ((currentToolIndex + 1) / totalTools) * 100)}%`,
              }}
            />
          </div>
        )}

        {/* Current tool detail card (while running) */}
        {currentTool && !isComplete && (
          <div className="mb-3 rounded-lg border border-purple-200/60 dark:border-purple-800/40 bg-purple-50/50 dark:bg-purple-950/20 px-3 py-2">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-purple-500 animate-spin flex-shrink-0" />
              <span className="text-xs font-medium text-purple-700 dark:text-purple-300">Running step</span>
              {getCompactToolDisplay(currentTool.toolName, currentTool.toolInput) && (
                <span className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">
                  {getCompactToolDisplay(currentTool.toolName, currentTool.toolInput)}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Tool history timeline */}
        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium mb-1">
            Steps
          </div>
          <div className="rounded-md border border-gray-200/60 bg-white/55 px-2 py-1 dark:border-gray-800/70 dark:bg-gray-950/20">
            <LifecycleTimelineRow
              title="Task started"
              description={startNodeDescription}
              status="start"
            />
            {childTools.map((child, index) => (
              <ChildToolRow
                key={child.toolId}
                child={child}
                index={index}
                isCurrent={index === currentToolIndex && !isComplete}
              />
            ))}
            <LifecycleTimelineRow
              title={endNodeTitle}
              description={lifecycleSummary}
              status={endNodeStatus}
              showConnector={false}
            />
          </div>
        </div>

        {/* Final result */}
        {isComplete && resultContent !== null && resultContent !== undefined && resultContent !== '' && (
          <div className="mt-2">
            <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium mb-1">
              Result
            </div>
            {typeof resultContent === 'string' ? (
              <div className="text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/30 rounded px-3 py-2 border border-gray-200/40 dark:border-gray-700/40">
                <Markdown className="prose prose-sm max-w-none dark:prose-invert">
                  {resultContent}
                </Markdown>
              </div>
            ) : (
              <pre className="text-[11px] bg-gray-50 dark:bg-gray-900/50 border border-gray-200/40 dark:border-gray-700/40 p-2 rounded whitespace-pre-wrap break-words overflow-hidden text-gray-600 dark:text-gray-400 font-mono">
                {JSON.stringify(resultContent, null, 2)}
              </pre>
            )}
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
};
