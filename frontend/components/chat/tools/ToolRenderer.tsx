/**
 * PURPOSE: Route chat tool payloads into the correct compact renderer for each tool family.
 */
import React, { memo, useMemo, useCallback } from 'react';
import { getToolConfig } from './configs/toolConfigs';
import { OneLineDisplay, CollapsibleDisplay, DiffViewer, MarkdownContent, FileListContent, TodoListContent, TaskListContent, TextContent, QuestionAnswerContent, PlanContent, BatchExecuteContent, ContextCommandContent, FileChangesContent, SubagentContainer } from './components';
import type { Project } from '../../../types/app';
import type { SubagentChildTool } from '../types/types';
import { formatPathRelativeToProject, formatPathTextRelativeToProject } from '../../../utils/pathDisplay';

type DiffLine = {
  type: string;
  content: string;
  lineNum: number;
};

interface ToolRendererProps {
  toolName: string;
  toolInput: any;
  toolResult?: any;
  toolId?: string;
  mode: 'input' | 'result';
  onFileOpen?: (filePath: string, diffInfo?: any) => void;
  createDiff?: (oldStr: string, newStr: string) => DiffLine[];
  selectedProject?: Project | null;
  autoExpandTools?: boolean;
  enableResultAnchor?: boolean;
  showRawParameters?: boolean;
  rawToolInput?: string;
  isSubagentContainer?: boolean;
  subagentState?: {
    childTools: SubagentChildTool[];
    currentToolIndex: number;
    isComplete: boolean;
  };
}

/**
 * Provide the stable #tool-result anchor expected by transcript tests.
 */
function InlineToolResultAnchor({ toolId }: { toolId?: string }) {
  if (!toolId) return null;

  return <span id={`tool-result-${toolId}`} className="sr-only" aria-hidden="true" />;
}

function getToolCategory(toolName: string): string {
  // Normalize to handle Pi SDK lowercase tool names (bash, read, edit, etc.)
  const normalized = toolName.charAt(0).toUpperCase() + toolName.slice(1);
  if (['Edit', 'Edit file', 'Write', 'ApplyPatch'].includes(normalized)) return 'edit';
  if (['Grep', 'Glob'].includes(normalized)) return 'search';
  if (normalized === 'Bash') return 'bash';
  if (['TodoWrite', 'TodoRead'].includes(normalized)) return 'todo';
  if (['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'].includes(normalized)) return 'task';
  if (['Task', 'Agent'].includes(normalized)) return 'agent';  // Subagent task
  if (['exit_plan_mode', 'ExitPlanMode', 'update_plan'].includes(toolName)) return 'plan';
  if (normalized === 'AskUserQuestion') return 'question';
  return 'default';
}

/**
 * Main tool renderer router
 * Routes to OneLineDisplay or CollapsibleDisplay based on tool config
 */
export const ToolRenderer: React.FC<ToolRendererProps> = memo(({
  toolName,
  toolInput,
  toolResult,
  toolId,
  mode,
  onFileOpen,
  createDiff,
  selectedProject,
  autoExpandTools = false,
  enableResultAnchor = true,
  showRawParameters = false,
  rawToolInput,
  isSubagentContainer,
  subagentState
}) => {
  // Route subagent containers to dedicated component
  if (isSubagentContainer && subagentState) {
    if (mode === 'result') {
      return null;
    }
    return (
      <SubagentContainer
        toolInput={toolInput}
        toolResult={toolResult}
        subagentState={subagentState}
        autoExpandTools={autoExpandTools}
      />
    );
  }

  // Normalize tool name for case-insensitive lookup (Pi SDK may send lowercase).
  // Underscored/dotted names (exec_command, functions.exec_command) are already
  // canonical and must stay unchanged to match config keys.
  const normalizedToolName = useMemo(() => {
    if (!toolName) return '';
    if (toolName.includes('_') || toolName.includes('.')) return toolName;
    return toolName.charAt(0).toUpperCase() + toolName.slice(1);
  }, [toolName]);

  const config = getToolConfig(normalizedToolName);
  const displayConfig: any = mode === 'input' ? config.input : config.result;

  const parsePayload = useCallback((rawData: unknown) => {
    try {
      return typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    } catch {
      return rawData;
    }
  }, []);

  const parsedToolInput = useMemo(() => parsePayload(toolInput), [parsePayload, toolInput]);
  const parsedToolResult = useMemo(() => parsePayload(toolResult), [parsePayload, toolResult]);
  const parsedData = mode === 'input' ? parsedToolInput : parsedToolResult;
  const projectRoot = selectedProject?.fullPath || selectedProject?.path || '';
  const formatProjectPath = useCallback(
    (pathValue: string) => formatPathRelativeToProject(pathValue, projectRoot),
    [projectRoot],
  );

  // Guard title/getContentProps helpers against null/undefined payloads that
  // reach tools through persisted sessions where input may be missing or malformed.
  const safeData = useMemo(() => {
    if (parsedData === null || parsedData === undefined || (typeof parsedData !== 'object' && typeof parsedData !== 'string')) {
      return {};
    }
    return parsedData;
  }, [parsedData]);

  const handleAction = useCallback(() => {
    if (displayConfig?.action === 'open-file' && onFileOpen) {
      const value = displayConfig.getValue?.(safeData) || '';
      onFileOpen(value);
    }
  }, [displayConfig, safeData, onFileOpen]);

  // Keep hooks above this guard so hook call order stays stable across renders.
  if (!displayConfig) return null;

  if (displayConfig.type === 'one-line') {
    const value = displayConfig.getValue?.(safeData) || '';
    const secondary = displayConfig.getSecondary?.(safeData);
    const displayValue = displayConfig.action === 'open-file'
      ? formatProjectPath(value)
      : formatPathTextRelativeToProject(value, projectRoot);
    const displaySecondary = secondary
      ? formatPathTextRelativeToProject(secondary, projectRoot)
      : secondary;

    return (
      <OneLineDisplay
        toolName={toolName}
        toolResult={toolResult}
        toolId={toolId}
        icon={displayConfig.icon}
        label={displayConfig.label}
        value={value}
        displayValue={displayValue}
        secondary={displaySecondary}
        action={displayConfig.action}
        onAction={handleAction}
        style={displayConfig.style}
        wrapText={displayConfig.wrapText}
        colorScheme={displayConfig.colorScheme}
        resultId={mode === 'input' ? `tool-result-${toolId}` : undefined}
      />
    );
  }

  if (displayConfig.type === 'content') {
    const contentProps = displayConfig.getContentProps?.(safeData, {
      selectedProject,
      createDiff,
      onFileOpen,
      toolInput: parsedToolInput,
      toolResult: parsedToolResult,
      mode,
    }) || {};
    if (displayConfig.contentType === 'context-command') {
      return (
        <ContextCommandContent
          payload={contentProps.payload}
          variant={contentProps.variant}
          formatPath={formatProjectPath}
          resultId={mode === 'input' && enableResultAnchor && toolId ? `tool-result-${toolId}` : undefined}
        />
      );
    }

    if (displayConfig.contentType === 'batch-execute') {
      return (
        <>
          <BatchExecuteContent payload={contentProps.payload} />
          {mode === 'input' && <InlineToolResultAnchor toolId={toolId} />}
        </>
      );
    }

    if (displayConfig.contentType === 'plan') {
      return <PlanContent plan={contentProps.plan} />;
    }

    if (displayConfig.contentType === 'file-changes') {
      return (
        <FileChangesContent
          payload={contentProps.payload}
          onFileClick={onFileOpen}
          formatPath={formatProjectPath}
        />
      );
    }

    return null;
  }

  if (displayConfig.type === 'collapsible') {
    const title = typeof displayConfig.title === 'function'
      ? displayConfig.title(safeData)
      : displayConfig.title ?? 'Details';
    const displayTitle = formatPathTextRelativeToProject(title, projectRoot);
    const displayToolName = typeof displayConfig.displayToolName === 'function'
      ? displayConfig.displayToolName(safeData)
      : displayConfig.displayToolName !== undefined
        ? displayConfig.displayToolName
        : toolName;

    const isContextModeInput = mode === 'input' && (
      displayConfig.contentType === 'batch-execute' ||
      displayConfig.contentType === 'context-command' ||
      displayConfig.title === 'Context command'
    );
    const defaultOpen = mode === 'result'
      ? Boolean(displayConfig.defaultOpen)
      : (isContextModeInput && Boolean(displayConfig.defaultOpen));

    const contentProps = displayConfig.getContentProps?.(safeData, {
      selectedProject,
      createDiff,
      onFileOpen,
      toolInput: parsedToolInput,
      toolResult: parsedToolResult,
      mode,
    }) || {};

    // Build the content component based on contentType
    let contentComponent: React.ReactNode = null;

    switch (displayConfig.contentType) {
      case 'diff':
        if (createDiff) {
          contentComponent = (
            <DiffViewer
              {...contentProps}
              displayFilePath={formatProjectPath(contentProps.filePath || '')}
              createDiff={createDiff}
              onFileClick={() => onFileOpen?.(contentProps.filePath)}
            />
          );
        }
        break;

      case 'markdown':
        contentComponent = <MarkdownContent content={contentProps.content || ''} />;
        break;

      case 'file-list':
        contentComponent = (
            <FileListContent
              files={contentProps.files || []}
              onFileClick={onFileOpen}
              title={contentProps.title}
              formatPath={formatProjectPath}
            />
        );
        break;

      case 'todo-list':
        if (contentProps.todos?.length > 0) {
          contentComponent = (
            <TodoListContent
              todos={contentProps.todos}
              isResult={contentProps.isResult}
            />
          );
        }
        break;

      case 'task':
        contentComponent = <TaskListContent content={contentProps.content || ''} />;
        break;

      case 'question-answer':
        contentComponent = (
          <QuestionAnswerContent
            questions={contentProps.questions || []}
            answers={contentProps.answers || {}}
          />
        );
        break;

      case 'text':
        contentComponent = (
          <TextContent
            content={contentProps.content || ''}
            format={contentProps.format || 'plain'}
            maxLines={contentProps.maxLines}
          />
        );
        break;

      case 'plan':
        contentComponent = <PlanContent plan={contentProps.plan} />;
        break;

      case 'batch-execute':
        contentComponent = <BatchExecuteContent payload={contentProps.payload} />;
        break;

      case 'context-command':
        contentComponent = (
            <ContextCommandContent
              payload={contentProps.payload}
              variant={contentProps.variant}
              formatPath={formatProjectPath}
            />
        );
        break;

      case 'file-changes':
        contentComponent = (
            <FileChangesContent
              payload={contentProps.payload}
              onFileClick={onFileOpen}
              formatPath={formatProjectPath}
            />
        );
        break;

      case 'success-message': {
        const msg = displayConfig.getMessage?.(parsedData) || 'Success';
        contentComponent = (
          <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {msg}
          </div>
        );
        break;
      }
    }

    const contextCommandFilePath = contentProps.variant === 'execute-file'
      ? contentProps.payload?.path
      : undefined;
    const toolCategory = getToolCategory(toolName);
    const editTitleFilePath = toolCategory === 'edit'
      ? contentProps.filePath
      : undefined;
    const titleFilePath = editTitleFilePath || contextCommandFilePath;

    // For file-backed tools, make the title clickable to open the file.
    const handleTitleClick = titleFilePath && onFileOpen
      ? () => onFileOpen(titleFilePath, editTitleFilePath
        ? {
            old_string: contentProps.oldContent,
            new_string: contentProps.newContent
          }
        : undefined)
      : undefined;

    return (
      <CollapsibleDisplay
        toolName={displayToolName}
        toolId={toolId}
        title={displayTitle}
        defaultOpen={defaultOpen}
        onTitleClick={handleTitleClick}
        showRawParameters={mode === 'input' && showRawParameters}
        rawContent={rawToolInput}
        toolCategory={getToolCategory(toolName)}
        wrapTitle={displayConfig.wrapTitle}
      >
        {contentComponent}
      </CollapsibleDisplay>
    );
  }

  return null;
});

ToolRenderer.displayName = 'ToolRenderer';
