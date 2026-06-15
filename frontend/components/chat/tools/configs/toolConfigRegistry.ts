/**
 * PURPOSE: Centralize tool display rules and map structured tool payloads to compact UI renderers.
 */
import {
  parsePlanPayload,
  parseBatchExecutePayload,
  parseContextCommandPayload,
  parseFileChangesPayload,
} from '../components/ContentRenderers';
import {
  createImageOpenFileToolConfig,
  getOpenFileToolPath,
} from './openFileToolConfig';

/**
 * Centralized tool configuration registry
 * Defines display behavior for all tool types
 */

export interface ToolDisplayConfig {
  input: {
    type: 'one-line' | 'collapsible' | 'content' | 'hidden';
    // One-line config
    icon?: string;
    label?: string;
    getValue?: (input: any) => string;
    getSecondary?: (input: any) => string | undefined;
    action?: 'copy' | 'open-file' | 'jump-to-results' | 'none';
    style?: string;
    wrapText?: boolean;
    colorScheme?: {
      primary?: string;
      secondary?: string;
      background?: string;
      border?: string;
      icon?: string;
    };
    // Collapsible config
    title?: string | ((input: any) => string);
    displayToolName?: string | ((input: any) => string);
    defaultOpen?: boolean;
    wrapTitle?: boolean;
    contentType?: 'diff' | 'markdown' | 'file-list' | 'todo-list' | 'text' | 'task' | 'question-answer' | 'plan' | 'batch-execute' | 'context-command' | 'file-changes';
    getContentProps?: (input: any, helpers?: any) => any;
    actionButton?: 'file-button' | 'none';
    getOpenFilePath?: (input: any, contentProps?: any) => string | undefined;
    getOpenFileDiffInfo?: (input: any, contentProps?: any) => any;
  };
  result?: {
    hidden?: boolean;
    hideOnSuccess?: boolean;
    type?: 'one-line' | 'collapsible' | 'special';
    title?: string | ((result: any) => string);
    displayToolName?: string | ((result: any) => string);
    defaultOpen?: boolean;
    // Special result handlers
    contentType?: 'markdown' | 'file-list' | 'todo-list' | 'text' | 'success-message' | 'task' | 'question-answer' | 'plan' | 'batch-execute' | 'context-command' | 'file-changes';
    getMessage?: (result: any) => string;
    getContentProps?: (result: any) => any;
  };
}

const CONTEXT_MODE_TOOL_PREFIX = /^mcp__(?:plugin_)?context[-_]mode.*?[.:_]/;
const CONTEXT_MODE_BATCH_TOOLS = new Set([
  'ctx_batch_execute',
  'ctx_batch_exec',
]);
const CONTEXT_MODE_FETCH_TOOLS = new Set([
  'ctx_fetch_and_index',
]);
const CONTEXT_MODE_READ_TOOLS = new Set([
  'ctx_index',
]);
const CONTEXT_MODE_EXECUTE_FILE_TOOLS = new Set([
  'ctx_execute_file',
  'ctx_exec_file',
]);
const CONTEXT_MODE_EXECUTE_TOOLS = new Set([
  'ctx_execute',
]);
const CONTEXT_MODE_SEARCH_TOOLS = new Set([
  'ctx_search',
]);

/**
 * Normalize context-mode names so MCP-qualified aliases share one renderer.
 * Handles nested prefixes like mcp__plugin_context-mode_context-mode__ctx_batch_execute.
 */
function normalizeContextModeToolName(toolName: string): string {
  const normalized = String(toolName || '').replace(CONTEXT_MODE_TOOL_PREFIX, '');
  return normalized.replace(/^context[-_]mode__/, '');
}

function formatContextTimeoutTitle(timeout: unknown): string {
  /**
   * ctx_execute_file cards use the timeout as their compact title, in seconds.
   */
  const numericTimeout = typeof timeout === 'number'
    ? timeout
    : typeof timeout === 'string'
      ? Number(timeout)
      : NaN;
  if (!Number.isFinite(numericTimeout) || numericTimeout <= 0) {
    return 'timeout';
  }
  const seconds = numericTimeout / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
}

function stripExecCommandEnvelope(content: string): string {
  if (!content) return '';

  const lines = content.split('\n');
  if (!lines[0]?.startsWith('Chunk ID:')) {
    return content;
  }

  const outputStart = lines.findIndex((line) => line.trim() === 'Output:');
  if (outputStart === -1) {
    return content;
  }

  return lines.slice(outputStart + 1).join('\n').trimStart();
}

function normalizeExecResultPayload(result: unknown): string {
  if (result === null || result === undefined) return '';

  if (typeof result === 'string') {
    return result;
  }

  if (Array.isArray(result)) {
    return result.map((item) => normalizeExecResultPayload(item)).filter(Boolean).join('\n');
  }

  if (typeof result === 'object') {
    const record = result as Record<string, unknown>;
    const nested = record.content ?? record.output ?? record.stdout ?? record.stderr ?? record.text;
    if (nested !== undefined && nested !== result) {
      return normalizeExecResultPayload(nested);
    }
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
  }

  return String(result);
}

export function getExecResultContent(result: any): string {
  const raw = normalizeExecResultPayload(result);
  return stripExecCommandEnvelope(raw);
}

function getShellCommandInput(input: any): string {
  const command = typeof input === 'string'
    ? input
    : input?.command || input?.cmd || '';
  return stripLoginShellCommandPrefix(String(command || ''));
}

/**
 * Remove transport shell wrappers such as `/bin/zsh -lc 'cmd'` so the transcript
 * shows the command the user cares about, not the shell used to launch it.
 */
function stripLoginShellCommandPrefix(command: string): string {
  const trimmedCommand = command.trim();
  const match = trimmedCommand.match(/^(?:\/(?:usr\/)?bin\/)?(?:zsh|bash|sh)\s+-lc\s+([\s\S]+)$/);
  if (!match) {
    return command;
  }

  return unwrapShellCommandArgument(match[1]);
}

/**
 * Decode one shell-quoted command argument without trying to be a full shell parser.
 */
function unwrapShellCommandArgument(argument: string): string {
  const trimmedArgument = argument.trim();
  if (trimmedArgument.length < 2) {
    return trimmedArgument;
  }

  const first = trimmedArgument[0];
  const last = trimmedArgument[trimmedArgument.length - 1];
  if (first === "'" && last === "'") {
    return trimmedArgument.slice(1, -1).replace(/'\\''/g, "'");
  }
  if (first === '"' && last === '"') {
    return trimmedArgument.slice(1, -1).replace(/\\(["\\$`])/g, '$1');
  }
  return trimmedArgument;
}

function getShellCommandPayload(input: any, result?: any) {
  /**
   * Render terminal-like tools through the same highlighted code card used by
   * ctx shell commands, with output folded under the command.
   */
  const code = getShellCommandInput(input);
  return {
    intent: '',
    language: 'shell',
    path: '',
    code,
    output: getExecResultContent(result),
    queries: [],
    metadata: [],
    fallback: code,
  };
}

function getFileOperationPath(input: any): string {
  return getOpenFileToolPath(input);
}

function getWriteStdinLabel(input: any): string {
  /**
   * Keep stdin events readable in the transcript without exposing the raw JSON
   * envelope.
   */
  const sessionId = input?.session_id ?? input?.sessionId;
  return sessionId ? `stdin -> session ${sessionId}` : 'stdin';
}

function getWriteStdinPreview(input: any): string | undefined {
  /**
   * Summarize the forwarded stdin chunk so polling events and typed input are
   * easy to distinguish in one line.
   */
  const chars = typeof input?.chars === 'string' ? input.chars : '';
  if (!chars) {
    return '轮询输出';
  }

  const compact = chars.replace(/\n/g, '\\n').replace(/\/n/g, '\\n');
  return compact.length > 48 ? `${compact.slice(0, 48)}…` : compact;
}

function hasVisiblePlanContent(payload: ReturnType<typeof parsePlanPayload>): boolean {
  /**
   * A rendered update_plan should stay attached to the payload that actually
   * carries explanation text or checklist steps.
   */
  return Boolean(payload.explanation) || payload.steps.length > 0;
}

function resolveDisplayedPlanPayload(input: unknown, toolResult: unknown) {
  /**
   * Some runtimes emit an empty success result for update_plan. In that case,
   * keep showing the original plan input instead of an empty collapsible body.
   */
  const resultPlan = parsePlanPayload(toolResult);
  if (hasVisiblePlanContent(resultPlan)) {
    return resultPlan;
  }

  return parsePlanPayload(input);
}

export const TOOL_CONFIGS: Record<string, ToolDisplayConfig> = {
  // ============================================================================
  // COMMAND TOOLS
  // ============================================================================

  Bash: {
    input: {
      type: 'content',
      contentType: 'context-command',
      getContentProps: (input, helpers) => ({
        payload: getShellCommandPayload(input, helpers?.toolResult),
        variant: 'shell-command',
      })
    },
    result: {
      hidden: true
    }
  },

  exec_command: {
    input: {
      type: 'content',
      contentType: 'context-command',
      getContentProps: (input, helpers) => ({
        payload: getShellCommandPayload(input, helpers?.toolResult),
        variant: 'shell-command',
      })
    },
    result: {
      hidden: true
    }
  },

  'functions.exec_command': {
    input: {
      type: 'content',
      contentType: 'context-command',
      getContentProps: (input, helpers) => ({
        payload: getShellCommandPayload(input, helpers?.toolResult),
        variant: 'shell-command',
      })
    },
    result: {
      hidden: true
    }
  },

  write_stdin: {
    input: {
      type: 'one-line',
      icon: 'terminal',
      getValue: (input) => getWriteStdinLabel(input),
      getSecondary: (input) => getWriteStdinPreview(input),
      action: 'copy',
      style: 'terminal',
      wrapText: true,
      colorScheme: {
        primary: 'text-green-400 font-mono',
        secondary: 'text-gray-400',
        background: '',
        border: 'border-green-500 dark:border-green-400',
        icon: 'text-green-500 dark:text-green-400'
      }
    },
    result: {
      type: 'collapsible',
      title: 'Output',
      defaultOpen: false,
      contentType: 'text',
      getContentProps: (result) => ({
        content: getExecResultContent(result),
        format: 'code',
        maxLines: 8
      })
    }
  },

  'functions.write_stdin': {
    input: {
      type: 'one-line',
      icon: 'terminal',
      getValue: (input) => getWriteStdinLabel(input),
      getSecondary: (input) => getWriteStdinPreview(input),
      action: 'copy',
      style: 'terminal',
      wrapText: true,
      colorScheme: {
        primary: 'text-green-400 font-mono',
        secondary: 'text-gray-400',
        background: '',
        border: 'border-green-500 dark:border-green-400',
        icon: 'text-green-500 dark:text-green-400'
      }
    },
    result: {
      type: 'collapsible',
      title: 'Output',
      defaultOpen: false,
      contentType: 'text',
      getContentProps: (result) => ({
        content: getExecResultContent(result),
        format: 'code',
        maxLines: 8
      })
    }
  },

  // ============================================================================
  // FILE OPERATION TOOLS
  // ============================================================================

  Read: {
    input: {
      type: 'collapsible',
      title: (input) => getFileOperationPath(input) || 'file',
      displayToolName: 'Read',
      defaultOpen: false,
      wrapTitle: true,
      contentType: 'markdown',
      getContentProps: (input, helpers) => {
        const filePath = getFileOperationPath(input) || 'unknown';
        const fileContent = normalizeExecResultPayload(helpers?.toolResult);
        const hasContent = typeof fileContent === 'string' && fileContent.trim();
        return {
          content: hasContent
            ? `\`\`\`\n${fileContent}\n\`\`\``
            : `📄 \`${filePath}\``,
        };
      },
      getOpenFilePath: (input) => getFileOperationPath(input),
    },
    result: {
      hidden: true
    }
  },

  view_image: createImageOpenFileToolConfig(),

  'functions.view_image': createImageOpenFileToolConfig(),

  Edit: {
    input: {
      type: 'collapsible',
      title: (input) => getFileOperationPath(input) || 'file',
      displayToolName: 'Edit',
      defaultOpen: false,
      contentType: 'diff',
      actionButton: 'none',
      getContentProps: (input) => ({
        oldContent: input.old_string,
        newContent: input.new_string,
        filePath: getFileOperationPath(input),
        badge: 'Edit',
        badgeColor: 'gray'
      }),
      getOpenFilePath: (input, contentProps) => contentProps?.filePath || getFileOperationPath(input),
      getOpenFileDiffInfo: (_input, contentProps) => ({
        old_string: contentProps?.oldContent,
        new_string: contentProps?.newContent,
      }),
    },
    result: {
      hideOnSuccess: true
    }
  },

  'Edit file': {
    input: {
      type: 'collapsible',
      title: (input) => getFileOperationPath(input) || 'file',
      displayToolName: 'Edit',
      defaultOpen: false,
      contentType: 'diff',
      actionButton: 'none',
      getContentProps: (input) => ({
        oldContent: input.old_string,
        newContent: input.new_string,
        filePath: getFileOperationPath(input),
        badge: 'Edit',
        badgeColor: 'gray'
      }),
      getOpenFilePath: (input, contentProps) => contentProps?.filePath || getFileOperationPath(input),
      getOpenFileDiffInfo: (_input, contentProps) => ({
        old_string: contentProps?.oldContent,
        new_string: contentProps?.newContent,
      }),
    },
    result: {
      hideOnSuccess: true
    }
  },

  Write: {
    input: {
      type: 'collapsible',
      title: (input) => getFileOperationPath(input) || 'file',
      displayToolName: 'Write',
      defaultOpen: false,
      contentType: 'diff',
      actionButton: 'none',
      getContentProps: (input) => ({
        oldContent: '',
        newContent: input.content,
        filePath: getFileOperationPath(input),
        badge: 'Write',
        badgeColor: 'green'
      }),
      getOpenFilePath: (input, contentProps) => contentProps?.filePath || getFileOperationPath(input),
      getOpenFileDiffInfo: (_input, contentProps) => ({
        old_string: contentProps?.oldContent,
        new_string: contentProps?.newContent,
      }),
    },
    result: {
      hideOnSuccess: true
    }
  },

  ApplyPatch: {
    input: {
      type: 'collapsible',
      title: (input) => getFileOperationPath(input) || 'file',
      displayToolName: 'Patch',
      defaultOpen: false,
      contentType: 'diff',
      actionButton: 'none',
      getContentProps: (input) => ({
        oldContent: input.old_string,
        newContent: input.new_string,
        filePath: getFileOperationPath(input),
        badge: 'Patch',
        badgeColor: 'gray'
      }),
      getOpenFilePath: (input, contentProps) => contentProps?.filePath || getFileOperationPath(input),
      getOpenFileDiffInfo: (_input, contentProps) => ({
        old_string: contentProps?.oldContent,
        new_string: contentProps?.newContent,
      }),
    },
    result: {
      hideOnSuccess: true
    }
  },

  // ============================================================================
  // SEARCH TOOLS
  // ============================================================================

  Grep: {
    input: {
      type: 'collapsible',
      title: (input) => {
        const p = input.pattern || '';
        const dir = input.path || '';
        return dir ? `${p} in ${dir}` : p || 'search';
      },
      displayToolName: 'Grep',
      defaultOpen: false,
      wrapTitle: true,
      contentType: 'file-list',
      getContentProps: (input, helpers) => {
        const toolData = helpers?.toolResult?.toolUseResult || {};
        return { files: toolData.filenames || [] };
      },
    },
    result: {
      hidden: true
    }
  },

  Glob: {
    input: {
      type: 'collapsible',
      title: (input) => {
        const p = input.pattern || '';
        const dir = input.path || '';
        return dir ? `${p} in ${dir}` : p || 'glob';
      },
      displayToolName: 'Glob',
      defaultOpen: false,
      wrapTitle: true,
      contentType: 'file-list',
      getContentProps: (input, helpers) => {
        const toolData = helpers?.toolResult?.toolUseResult || {};
        return { files: toolData.filenames || [] };
      },
    },
    result: {
      hidden: true
    }
  },

  // ============================================================================
  // ============================================================================

  TodoWrite: {
    input: {
      type: 'collapsible',
      title: 'Updating todo list',
      displayToolName: 'Todo',
      defaultOpen: false,
      contentType: 'todo-list',
      getContentProps: (input) => ({
        todos: input.todos
      })
    },
    result: {
      hidden: true
    }
  },

  TodoRead: {
    input: {
      type: 'one-line',
      label: 'TodoRead',
      getValue: () => 'reading list',
      action: 'none',
      colorScheme: {
        primary: 'text-gray-500 dark:text-gray-400',
        border: 'border-violet-400 dark:border-violet-500'
      }
    },
    result: {
      type: 'collapsible',
      contentType: 'todo-list',
      getContentProps: (result) => {
        try {
          const content = String(result.content || '');
          let todos = null;
          if (content.startsWith('[')) {
            todos = JSON.parse(content);
          }
          return { todos, isResult: true };
        } catch (e) {
          return { todos: [], isResult: true };
        }
      }
    }
  },

  // ============================================================================
  // TASK TOOLS (TaskCreate, TaskUpdate, TaskList, TaskGet)
  // ============================================================================

  TaskCreate: {
    input: {
      type: 'collapsible',
      title: (input) => input.subject || 'Creating task',
      displayToolName: 'Task',
      defaultOpen: false,
      wrapTitle: true,
      contentType: 'text',
      getContentProps: (input) => {
        const parts = [];
        if (input.subject) parts.push(`**Subject:** ${input.subject}`);
        if (input.description) parts.push(`**Description:** ${input.description}`);
        if (input.status) parts.push(`**Status:** ${input.status}`);
        return { content: parts.join('\n\n') || 'Creating task', format: 'markdown' };
      },
    },
    result: {
      hidden: true
    }
  },

  TaskUpdate: {
    input: {
      type: 'collapsible',
      title: (input) => {
        const parts = [];
        if (input.taskId) parts.push(`#${input.taskId}`);
        if (input.status) parts.push(input.status);
        if (input.subject) parts.push(`"${input.subject}"`);
        return parts.join(' → ') || 'updating';
      },
      displayToolName: 'Task',
      defaultOpen: false,
      wrapTitle: true,
      contentType: 'text',
      getContentProps: (input) => {
        const parts = [];
        if (input.subject) parts.push(`**Subject:** ${input.subject}`);
        if (input.description) parts.push(`**Description:** ${input.description}`);
        if (input.status) parts.push(`**Status:** ${input.status}`);
        return { content: parts.join('\n\n') || 'updating', format: 'markdown' };
      },
    },
    result: {
      hidden: true
    }
  },

  TaskList: {
    input: {
      type: 'collapsible',
      title: 'Task list',
      displayToolName: 'Tasks',
      defaultOpen: false,
      contentType: 'task',
      getContentProps: (input, helpers) => ({
        content: String(helpers?.toolResult?.content || '')
      }),
    },
    result: {
      hidden: true
    }
  },

  TaskGet: {
    input: {
      type: 'collapsible',
      title: (input) => input.taskId ? `Task #${input.taskId}` : 'Task details',
      displayToolName: 'Task',
      defaultOpen: false,
      contentType: 'task',
      getContentProps: (input, helpers) => ({
        content: String(helpers?.toolResult?.content || '')
      }),
    },
    result: {
      hidden: true
    }
  },

  // ============================================================================
  // SUBAGENT TASK TOOL
  // ============================================================================

  Agent: {
    input: {
      type: 'collapsible',
      title: (input) => {
        const subagentType = input.subagent_type || 'Agent';
        const description = input.description || 'Running task';
        return `Subagent / ${subagentType}: ${description}`;
      },
      defaultOpen: false,
      contentType: 'markdown',
      getContentProps: (input) => {
        const hasOnlyPrompt = input.prompt && !input.model && !input.resume;
        if (hasOnlyPrompt) {
          return { content: input.prompt || '' };
        }
        const parts = [];
        if (input.model) parts.push(`**Model:** ${input.model}`);
        if (input.prompt) parts.push(`**Prompt:**\n${input.prompt}`);
        if (input.resume) parts.push(`**Resuming from:** ${input.resume}`);
        return { content: parts.join('\n\n') };
      },
      colorScheme: {
        border: 'border-purple-500 dark:border-purple-400',
        icon: 'text-purple-500 dark:text-purple-400'
      }
    },
    result: {
      type: 'collapsible',
      title: 'Subagent result',
      defaultOpen: false,
      contentType: 'markdown',
      getContentProps: (result) => {
        if (result && result.content) {
          let content = result.content;
          if (typeof content === 'string') {
            try {
              const parsed = JSON.parse(content);
              if (Array.isArray(parsed)) content = parsed;
            } catch {
              return { content };
            }
          }
          if (Array.isArray(content)) {
            const textContent = content
              .filter((item: any) => item.type === 'text')
              .map((item: any) => item.text)
              .join('\n\n');
            return { content: textContent || 'No response text' };
          }
          return { content: String(content) };
        }
        return { content: String(result || 'No response') };
      }
    }
  },

  Task: {
    input: {
      type: 'collapsible',
      title: (input) => {
        const subagentType = input.subagent_type || 'Agent';
        const description = input.description || 'Running task';
        return `Subagent / ${subagentType}: ${description}`;
      },
      defaultOpen: false,
      contentType: 'markdown',
      getContentProps: (input) => {
        // If only prompt exists (and required fields), show just the prompt
        // Otherwise show all available fields
        const hasOnlyPrompt = input.prompt &&
          !input.model &&
          !input.resume;

        if (hasOnlyPrompt) {
          return {
            content: input.prompt || ''
          };
        }

        // Format multiple fields
        const parts = [];

        if (input.model) {
          parts.push(`**Model:** ${input.model}`);
        }

        if (input.prompt) {
          parts.push(`**Prompt:**\n${input.prompt}`);
        }

        if (input.resume) {
          parts.push(`**Resuming from:** ${input.resume}`);
        }

        return {
          content: parts.join('\n\n')
        };
      },
      colorScheme: {
        border: 'border-purple-500 dark:border-purple-400',
        icon: 'text-purple-500 dark:text-purple-400'
      }
    },
    result: {
      type: 'collapsible',
      title: 'Subagent result',
      defaultOpen: false,
      contentType: 'markdown',
      getContentProps: (result) => {
        // Handle agent results which may have complex structure
        if (result && result.content) {
          let content = result.content;
          // If content is a JSON string, try to parse it (agent results may arrive serialized)
          if (typeof content === 'string') {
            try {
              const parsed = JSON.parse(content);
              if (Array.isArray(parsed)) {
                content = parsed;
              }
            } catch {
              // Not JSON — use as-is
              return { content };
            }
          }
          // If content is an array (typical for agent responses with multiple text blocks)
          if (Array.isArray(content)) {
            const textContent = content
              .filter((item: any) => item.type === 'text')
              .map((item: any) => item.text)
              .join('\n\n');
            return { content: textContent || 'No response text' };
          }
          return { content: String(content) };
        }
        // Fallback to string representation
        return { content: String(result || 'No response') };
      }
    }
  },

  // ============================================================================
  // INTERACTIVE TOOLS
  // ============================================================================

  AskUserQuestion: {
    input: {
      type: 'collapsible',
      title: (input: any) => {
        const count = input.questions?.length || 0;
        const hasAnswers = input.answers && Object.keys(input.answers).length > 0;
        if (count === 1) {
          const header = input.questions[0]?.header || 'Question';
          return hasAnswers ? `${header} — answered` : header;
        }
        return hasAnswers ? `${count} questions — answered` : `${count} questions`;
      },
      defaultOpen: false,
      contentType: 'question-answer',
      getContentProps: (input: any) => ({
        questions: input.questions || [],
        answers: input.answers || {}
      }),
    },
    result: {
      hideOnSuccess: true
    }
  },

  // ============================================================================
  // PLAN TOOLS
  // ============================================================================

  update_plan: {
    input: {
      type: 'content',
      title: 'Implementation plan',
      defaultOpen: true,
      contentType: 'plan',
      getContentProps: (input, helpers) => ({
        plan: resolveDisplayedPlanPayload(input, helpers?.toolResult),
      })
    },
    result: {
      type: 'collapsible',
      title: 'Plan updated',
      defaultOpen: false,
      contentType: 'plan',
      hideOnSuccess: true,
      getContentProps: (result) => ({
        plan: parsePlanPayload(result),
      })
    }
  },

  exit_plan_mode: {
    input: {
      type: 'collapsible',
      title: 'Implementation plan',
      defaultOpen: false,
      contentType: 'markdown',
      getContentProps: (input) => ({
        content: input.plan?.replace(/\\n/g, '\n') || input.plan
      })
    },
    result: {
      type: 'collapsible',
      contentType: 'markdown',
      getContentProps: (result) => {
        try {
          let parsed = result.content;
          if (typeof parsed === 'string') {
            parsed = JSON.parse(parsed);
          }
          return {
            content: parsed.plan?.replace(/\\n/g, '\n') || parsed.plan
          };
        } catch (e) {
          return { content: '' };
        }
      }
    }
  },

  // Also register as ExitPlanMode (the actual tool name used by Claude)
  ExitPlanMode: {
    input: {
      type: 'collapsible',
      title: 'Implementation plan',
      defaultOpen: false,
      contentType: 'markdown',
      getContentProps: (input) => ({
        content: input.plan?.replace(/\\n/g, '\n') || input.plan
      })
    },
    result: {
      type: 'collapsible',
      contentType: 'markdown',
      getContentProps: (result) => {
        try {
          let parsed = result.content;
          if (typeof parsed === 'string') {
            parsed = JSON.parse(parsed);
          }
          return {
            content: parsed.plan?.replace(/\\n/g, '\n') || parsed.plan
          };
        } catch (e) {
          return { content: '' };
        }
      }
    }
  },

  ctx_batch_execute: {
    input: {
      type: 'content',
      title: '',
      defaultOpen: false,
      contentType: 'batch-execute',
      getContentProps: (input, helpers) => ({
        payload: parseBatchExecutePayload(input, helpers?.toolResult),
      })
    },
    result: {
      hidden: true
    }
  },

  ctx_batch_exec: {
    input: {
      type: 'content',
      title: '',
      defaultOpen: false,
      contentType: 'batch-execute',
      getContentProps: (input, helpers) => ({
        payload: parseBatchExecutePayload(input, helpers?.toolResult),
      })
    },
    result: {
      hidden: true
    }
  },

  'mcp__context_mode__:ctx_batch_execute': {
    input: {
      type: 'content',
      title: '',
      defaultOpen: false,
      contentType: 'batch-execute',
      getContentProps: (input, helpers) => ({
        payload: parseBatchExecutePayload(input, helpers?.toolResult),
      })
    },
    result: {
      hidden: true
    }
  },

  'mcp__context_mode__.ctx_batch_execute': {
    input: {
      type: 'content',
      title: '',
      defaultOpen: false,
      contentType: 'batch-execute',
      getContentProps: (input, helpers) => ({
        payload: parseBatchExecutePayload(input, helpers?.toolResult),
      })
    },
    result: {
      hidden: true
    }
  },

  ContextModeFetch: {
    input: {
      type: 'one-line',
      label: '联网',
      getValue: (input) => input?.url || '',
      getSecondary: (input) => input?.source,
      action: 'none',
      colorScheme: {
        primary: 'text-blue-700 dark:text-blue-300',
        secondary: 'text-gray-500 dark:text-gray-400',
        border: 'border-blue-400 dark:border-blue-500',
        icon: 'text-blue-500 dark:text-blue-400'
      }
    },
    result: {
      hidden: true
    }
  },

  ContextModeRead: {
    input: {
      type: 'one-line',
      label: 'Read',
      getValue: (input) => input?.path || input?.source || 'inline content',
      getSecondary: (input) => input?.path ? input?.source : undefined,
      action: 'open-file',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        background: '',
        border: 'border-gray-300 dark:border-gray-600',
        icon: 'text-gray-500 dark:text-gray-400'
      }
    },
    result: {
      hidden: true
    }
  },

  ContextModeExecuteFile: {
    input: {
      type: 'content',
      title: (input) => input?.path || 'file',
      displayToolName: (input) => formatContextTimeoutTitle(input?.timeout),
      defaultOpen: false,
      wrapTitle: true,
      contentType: 'context-command',
      getContentProps: (input, helpers) => ({
        payload: parseContextCommandPayload(input, helpers?.toolResult),
        variant: 'execute-file',
      }),
    },
    result: {
      hidden: true
    },
  },

  ContextModeExecute: {
    input: {
      type: 'content',
      title: (input) => input?.intent || 'Context command',
      displayToolName: (input) => formatContextTimeoutTitle(input?.timeout),
      defaultOpen: false,
      wrapTitle: true,
      contentType: 'context-command',
      getContentProps: (input, helpers) => ({
        payload: parseContextCommandPayload(input, helpers?.toolResult),
        variant: 'execute',
      }),
    },
    result: {
      hidden: true
    },
  },

  ContextModeSearch: {
    input: {
      type: 'content',
      title: 'Search',
      defaultOpen: false,
      contentType: 'context-command',
      getContentProps: (input, helpers) => ({
        payload: parseContextCommandPayload(input, helpers?.toolResult),
        variant: 'search',
      }),
    },
    result: {
      hidden: true
    },
  },

  FileChanges: {
    input: {
      type: 'content',
      title: 'File changes',
      defaultOpen: false,
      contentType: 'file-changes',
      getContentProps: (input) => ({
        payload: parseFileChangesPayload(input),
      })
    },
    result: {
      hidden: true
    }
  },

  ContextModeGeneric: {
    input: {
      type: 'content',
      title: (input) => input?.intent || input?.path || input?.url || input?.source || 'Context command',
      defaultOpen: false,
      contentType: 'context-command',
      getContentProps: (input, helpers) => ({
        payload: parseContextCommandPayload(input, helpers?.toolResult),
      }),
    },
    result: {
      hidden: true
    },
  },

  // ============================================================================
  // DEFAULT FALLBACK
  // ============================================================================

  Default: {
    input: {
      type: 'collapsible',
      title: 'Parameters',
      defaultOpen: false,
      contentType: 'text',
      getContentProps: (input, helpers) => {
        const inputStr = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
        const resultContent = String(helpers?.toolResult?.content || '').trim();
        const combined = resultContent
          ? `${inputStr}\n\n---\n${resultContent}`
          : inputStr;
        return { content: combined, format: 'code' };
      }
    },
    result: {
      hidden: true
    }
  }
};

/**
 * Get configuration for a tool, with fallback to default
 */
export function getToolConfig(toolName: string): ToolDisplayConfig {
  const directConfig = TOOL_CONFIGS[toolName];
  if (directConfig) {
    return directConfig;
  }

  // Case-insensitive fallback: normalize first letter to uppercase
  // (Pi SDK may send lowercase tool names like 'bash', 'read', 'edit')
  if (toolName) {
    const capitalized = toolName.charAt(0).toUpperCase() + toolName.slice(1);
    const caseConfig = TOOL_CONFIGS[capitalized];
    if (caseConfig) {
      return caseConfig;
    }
  }

  const normalizedContextToolName = normalizeContextModeToolName(toolName);
  if (CONTEXT_MODE_BATCH_TOOLS.has(normalizedContextToolName)) {
    return TOOL_CONFIGS.ctx_batch_execute;
  }

  if (CONTEXT_MODE_FETCH_TOOLS.has(normalizedContextToolName)) {
    return TOOL_CONFIGS.ContextModeFetch;
  }

  if (CONTEXT_MODE_READ_TOOLS.has(normalizedContextToolName)) {
    return TOOL_CONFIGS.ContextModeRead;
  }

  if (CONTEXT_MODE_EXECUTE_FILE_TOOLS.has(normalizedContextToolName)) {
    return TOOL_CONFIGS.ContextModeExecuteFile;
  }

  if (CONTEXT_MODE_EXECUTE_TOOLS.has(normalizedContextToolName)) {
    return TOOL_CONFIGS.ContextModeExecute;
  }

  if (CONTEXT_MODE_SEARCH_TOOLS.has(normalizedContextToolName)) {
    return TOOL_CONFIGS.ContextModeSearch;
  }

  if (normalizedContextToolName.startsWith('ctx_')) {
    return TOOL_CONFIGS.ContextModeGeneric;
  }

  return TOOL_CONFIGS.Default;
}

/**
 * Check if a tool result should be hidden
 */
export function shouldHideToolResult(toolName: string, toolResult: any): boolean {
  const config = getToolConfig(toolName);

  if (!config.result) return false;

  // Always hidden
  if (config.result.hidden) return true;

  // Hide on success only
  if (config.result.hideOnSuccess && toolResult && !toolResult.isError) {
    return true;
  }

  return false;
}
