import React, { useState, useMemo } from 'react';
const Loader2 = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4 animate-spin"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>;
const CheckCircle2 = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 6-6"/></svg>;
const XCircle = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>;
const Circle = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>;
const ChevronDown = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>;
const ChevronRight = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>;
const Terminal = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="4,17 10,11 4,5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>;
const FileText = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10,9 9,9 8,9"/></svg>;
const Search = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
const Globe = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>;
const Wrench = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>;
const Bot = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7v-2M16 7v-2"/><circle cx="12" cy="3" r="2"/><path d="M12 12v.01"/></svg>;
const AlertTriangle = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
import { CollapsibleSection } from './CollapsibleSection';
import { Markdown } from '../../view/subcomponents/Markdown';
import type { SubagentChildTool } from '../../types/types';

interface SubagentContainerProps {
  toolInput: unknown;
  toolResult?: { content?: unknown; isError?: boolean } | null;
  subagentState: {
    childTools: SubagentChildTool[];
    currentToolIndex: number;
    isComplete: boolean;
  };
  autoExpandTools?: boolean;
}

/* ─── helpers ─── */

const getCompactToolDisplay = (toolName: string, toolInput: unknown): string => {
  const input = typeof toolInput === 'string'
    ? (() => { try { return JSON.parse(toolInput); } catch { return {}; } })()
    : (toolInput || {});

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
    case 'Task':
    case 'Agent':
      return input.description || input.subagent_type || '';
    case 'WebFetch':
    case 'WebSearch':
      return input.url || input.query || '';
    default:
      return '';
  }
};

const toolIconMap: Record<string, React.ReactNode> = {
  Read: <FileText className="w-3.5 h-3.5" />,
  Write: <FileText className="w-3.5 h-3.5" />,
  Edit: <FileText className="w-3.5 h-3.5" />,
  ApplyPatch: <FileText className="w-3.5 h-3.5" />,
  Grep: <Search className="w-3.5 h-3.5" />,
  Glob: <Search className="w-3.5 h-3.5" />,
  Bash: <Terminal className="w-3.5 h-3.5" />,
  WebFetch: <Globe className="w-3.5 h-3.5" />,
  WebSearch: <Globe className="w-3.5 h-3.5" />,
  Task: <Bot className="w-3.5 h-3.5" />,
};

const toolColorMap: Record<string, string> = {
  Read: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30',
  Write: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30',
  Edit: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30',
  ApplyPatch: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30',
  Grep: 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/40',
  Glob: 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/40',
  Bash: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30',
  WebFetch: 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/30',
  WebSearch: 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/30',
  Task: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/30',
};

const getToolColor = (toolName: string): string =>
  toolColorMap[toolName] || 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/40';

const getToolIcon = (toolName: string): React.ReactNode =>
  toolIconMap[toolName] || <Wrench className="w-3.5 h-3.5" />;

type ToolStatus = 'running' | 'done' | 'error' | 'pending';

const getToolStatus = (child: SubagentChildTool, isCurrent: boolean): ToolStatus => {
  if (isCurrent) return 'running';
  if (child.toolResult?.isError) return 'error';
  if (child.toolResult) return 'done';
  return 'pending';
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
  const colorClass = getToolColor(child.toolName);

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
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium ${colorClass}`}>
              {getToolIcon(child.toolName)}
              {child.toolName}
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
  toolInput,
  toolResult,
  subagentState,
  autoExpandTools = false,
}) => {
  const parsedInput = typeof toolInput === 'string'
    ? (() => { try { return JSON.parse(toolInput); } catch { return {}; } })()
    : (toolInput || {});

  const subagentType = parsedInput?.subagent_type || 'Agent';
  const description = parsedInput?.description || 'Running task';
  const prompt = parsedInput?.prompt || '';
  const { childTools, currentToolIndex, isComplete } = subagentState;
  const currentTool = currentToolIndex >= 0 ? childTools[currentToolIndex] : null;

  const isError = toolResult?.isError;
  const totalTools = childTools.length;
  const completedTools = childTools.filter(c => c.toolResult && !c.toolResult.isError).length;
  const errorTools = childTools.filter(c => c.toolResult?.isError).length;

  // Keep large child timelines collapsed so history rendering only mounts the summary row.
  const defaultOpen = autoExpandTools && childTools.length <= 20;

  const title = `${subagentType}: ${description} (${completedTools}/${totalTools} done${errorTools > 0 ? `, ${errorTools} errors` : ''})`;

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

  return (
    <div className="border-l-2 border-l-purple-500 dark:border-l-purple-400 pl-3 py-1 my-1">
      <CollapsibleSection
        title={title}
        toolName="Task"
        open={defaultOpen}
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
        <div className="flex items-center gap-3 mb-3">
          {!isComplete ? (
            <div className="flex items-center gap-1.5 text-xs text-purple-600 dark:text-purple-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span className="font-medium">
                {currentTool
                  ? `${currentTool.toolName}…`
                  : 'Starting…'}
              </span>
            </div>
          ) : isError ? (
            <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span className="font-medium">Failed</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span className="font-medium">Completed</span>
            </div>
          )}

          {/* Mini stats */}
          <div className="flex items-center gap-2 text-[11px] text-gray-400 dark:text-gray-500">
            <span>{completedTools}/{totalTools} done</span>
            {errorTools > 0 && (
              <span className="text-red-500">{errorTools} error{errorTools > 1 ? 's' : ''}</span>
            )}
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
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${getToolColor(currentTool.toolName)}`}>
                {getToolIcon(currentTool.toolName)}
                {currentTool.toolName}
              </span>
              {getCompactToolDisplay(currentTool.toolName, currentTool.toolInput) && (
                <span className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">
                  {getCompactToolDisplay(currentTool.toolName, currentTool.toolInput)}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Tool history timeline */}
        {childTools.length > 0 && (
          <div className="mb-3">
            <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium mb-1">
              Steps
            </div>
            <div className="pl-0.5">
              {childTools.map((child, index) => (
                <ChildToolRow
                  key={child.toolId}
                  child={child}
                  index={index}
                  isCurrent={index === currentToolIndex && !isComplete}
                />
              ))}
            </div>
          </div>
        )}

        {/* Final result */}
        {isComplete && resultContent && (
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
