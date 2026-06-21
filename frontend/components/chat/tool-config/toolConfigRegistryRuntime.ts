/**
 * PURPOSE: Centralize tool display rules and map structured tool payloads to compact UI renderers.
 */
import {
  parsePlanPayload,
  parseBatchExecutePayload,
  parseContextCommandPayload,
  parseFileChangesPayload,
} from '../tools/components/ContentRenderers';
import {
  createImageOpenFileToolConfig,
  getOpenFileToolPath,
} from '../tools/configs/openFileToolConfig';
import {
  isSubagentToolName,
  summarizeSubagentToolInput,
} from '../../../../shared/subagent-tool-utils.js';

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
    getValue?: (input: ToolPayload) => string;
    getSecondary?: (input: ToolPayload) => string | undefined;
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
    title?: string | ((input: ToolPayload) => string);
    displayToolName?: string | ((input: ToolPayload) => string);
    defaultOpen?: boolean;
    wrapTitle?: boolean;
    contentType?: 'diff' | 'markdown' | 'file-list' | 'todo-list' | 'text' | 'task' | 'question-answer' | 'plan' | 'batch-execute' | 'context-command' | 'file-changes';
    getContentProps?: (input: ToolPayload, helpers?: ToolPayload) => ToolPayload;
    actionButton?: 'file-button' | 'none';
    getOpenFilePath?: (input: ToolPayload, contentProps?: ToolPayload) => string | undefined;
    getOpenFileDiffInfo?: (input: ToolPayload, contentProps?: ToolPayload) => ToolPayload;
  };
  result?: {
    hidden?: boolean;
    hideOnSuccess?: boolean;
    type?: 'one-line' | 'collapsible' | 'special';
    title?: string | ((result: ToolPayload) => string);
    displayToolName?: string | ((result: ToolPayload) => string);
    defaultOpen?: boolean;
    // Special result handlers
    contentType?: 'markdown' | 'file-list' | 'todo-list' | 'text' | 'success-message' | 'task' | 'question-answer' | 'plan' | 'batch-execute' | 'context-command' | 'file-changes';
    getMessage?: (result: ToolPayload) => string;
    getContentProps?: (result: ToolPayload) => ToolPayload;
  };
}

type ToolPayloadRecord = Record<string, unknown>;
type ToolPayload = ToolPayloadRecord;

function asToolPayloadRecord(payload: unknown): ToolPayloadRecord {
  /** Narrow an arbitrary provider payload before reading structured fields. */
  return payload && typeof payload === 'object' ? payload as ToolPayloadRecord : {};
}

function getStringField(payload: unknown, key: string): string {
  /** Read a string-like field from an unknown tool payload. */
  const value = asToolPayloadRecord(payload)[key];
  return typeof value === 'string' ? value : '';
}

function getArrayField(payload: unknown, key: string): unknown[] {
  /** Read an array field from an unknown tool payload. */
  const value = asToolPayloadRecord(payload)[key];
  return Array.isArray(value) ? value : [];
}

/**
 * Build the shared title for Codex, Pi, and legacy subagent tools.
 */
function getSubagentToolTitle(input: unknown): string {
  /** Normalize provider-specific subagent argument names for display. */
  const summary = summarizeSubagentToolInput(input);
  return `Subagent / ${summary.subagentType}: ${summary.description}`;
}

/**
 * Build markdown body content for subagent tool inputs.
 */
function getSubagentInputContentProps(input: unknown): ToolPayload {
  /** Prefer the delegated prompt/task while keeping useful routing metadata. */
  const summary = summarizeSubagentToolInput(input);
  const payload = summary.payload;
  const parts: string[] = [];

  if (summary.prompt) {
    parts.push(summary.prompt);
  } else if (summary.description) {
    parts.push(summary.description);
  }

  const model = getStringField(payload, 'model');
  const resume = getStringField(payload, 'resume');
  const agentScope = getStringField(payload, 'agentScope') || getStringField(payload, 'agent_scope');
  if (model) parts.push(`**Model:** ${model}`);
  if (agentScope) parts.push(`**Scope:** ${agentScope}`);
  if (resume) parts.push(`**Resuming from:** ${resume}`);

  if (parts.length > 0) {
    return { content: parts.join('\n\n') };
  }

  return {
    content: Object.keys(payload).length > 0
      ? JSON.stringify(payload, null, 2)
      : 'Running task',
  };
}

/**
 * Build markdown body content for subagent results.
 */
function getSubagentResultContentProps(result: unknown): ToolPayload {
  /** Agent results may arrive as strings, text-block arrays, or wrapper records. */
  const record = asToolPayloadRecord(result);
  if (record.content !== undefined) {
    let content = record.content;
    if (typeof content === 'string') {
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          content = parsed;
        } else {
          return { content };
        }
      } catch {
        return { content };
      }
    }
    if (Array.isArray(content)) {
      const textContent = content
        .filter((item: unknown) => asToolPayloadRecord(item).type === 'text')
        .map((item: unknown) => getStringField(item, 'text'))
        .filter(Boolean)
        .join('\n\n');
      return { content: textContent || 'No response text' };
    }
    return { content: String(content) };
  }
  return { content: String(result || 'No response') };
}

const SUBAGENT_TOOL_INPUT_CONFIG: ToolDisplayConfig['input'] = {
  type: 'collapsible',
  title: getSubagentToolTitle,
  defaultOpen: false,
  contentType: 'markdown',
  getContentProps: getSubagentInputContentProps,
  colorScheme: {
    border: 'border-purple-500 dark:border-purple-400',
    icon: 'text-purple-500 dark:text-purple-400'
  }
};

const SUBAGENT_TOOL_RESULT_CONFIG: NonNullable<ToolDisplayConfig['result']> = {
  type: 'collapsible',
  title: 'Subagent result',
  defaultOpen: false,
  contentType: 'markdown',
  getContentProps: getSubagentResultContentProps
};

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

export function getExecResultContent(result: unknown): string {
  const raw = normalizeExecResultPayload(result);
  return stripExecCommandEnvelope(raw);
}

function getShellCommandInput(input: unknown): string {
  const command = typeof input === 'string'
    ? input
    : getStringField(input, 'command') || getStringField(input, 'cmd');
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

function getShellCommandPayload(input: unknown, result?: unknown) {
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

function getFileOperationPath(input: unknown): string {
  return getOpenFileToolPath(input);
}

function createFileMutationOpenConfig(label: string, getOldString: (input: unknown) => string, getNewString: (input: unknown) => string): ToolDisplayConfig['input'] {
  /**
   * Render file mutation tools as the same bare one-line file opener as other
   * compact tools while preserving old/new snapshots for the editor diff view.
   */
  return {
    type: 'one-line',
    label,
    getValue: (input) => getFileOperationPath(input) || 'file',
    action: 'open-file',
    colorScheme: {
      primary: 'text-gray-700 dark:text-gray-300',
      background: '',
      border: label === 'Write' ? 'border-green-500 dark:border-green-400' : 'border-amber-500 dark:border-amber-400',
      icon: 'text-gray-500 dark:text-gray-400',
    },
    getOpenFileDiffInfo: (input) => ({
      old_string: getOldString(input),
      new_string: getNewString(input),
    }),
  };
}

function getWriteStdinLabel(input: unknown): string {
  /**
   * Keep stdin events readable in the transcript without exposing the raw JSON
   * envelope.
   */
  const record = asToolPayloadRecord(input);
  const sessionId = record.session_id ?? record.sessionId;
  return sessionId ? `stdin -> session ${sessionId}` : 'stdin';
}

function getWriteStdinPreview(input: unknown): string | undefined {
  /**
   * Summarize the forwarded stdin chunk so polling events and typed input are
   * easy to distinguish in one line.
   */
  const chars = getStringField(input, 'chars');
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
    input: createFileMutationOpenConfig('Edit', (input) => getStringField(input, 'old_string'), (input) => getStringField(input, 'new_string')),
    result: {
      hideOnSuccess: true
    }
  },

  'Edit file': {
    input: createFileMutationOpenConfig('Edit', (input) => getStringField(input, 'old_string'), (input) => getStringField(input, 'new_string')),
    result: {
      hideOnSuccess: true
    }
  },

  Write: {
    input: createFileMutationOpenConfig('Write', () => '', (input) => getStringField(input, 'content')),
    result: {
      hideOnSuccess: true
    }
  },

  ApplyPatch: {
    input: createFileMutationOpenConfig('Patch', (input) => getStringField(input, 'old_string'), (input) => getStringField(input, 'new_string')),
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
        const p = getStringField(input, 'pattern');
        const dir = getStringField(input, 'path');
        return dir ? `${p} in ${dir}` : p || 'search';
      },
      displayToolName: 'Grep',
      defaultOpen: false,
      wrapTitle: true,
      contentType: 'file-list',
      getContentProps: (input, helpers) => {
        const toolResult = asToolPayloadRecord(helpers?.toolResult);
        const toolData = asToolPayloadRecord(toolResult.toolUseResult);
        return { files: getArrayField(toolData, 'filenames') };
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
        const p = getStringField(input, 'pattern');
        const dir = getStringField(input, 'path');
        return dir ? `${p} in ${dir}` : p || 'glob';
      },
      displayToolName: 'Glob',
      defaultOpen: false,
      wrapTitle: true,
      contentType: 'file-list',
      getContentProps: (input, helpers) => {
        const toolResult = asToolPayloadRecord(helpers?.toolResult);
        const toolData = asToolPayloadRecord(toolResult.toolUseResult);
        return { files: getArrayField(toolData, 'filenames') };
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
      title: (input) => getStringField(input, 'subject') || 'Creating task',
      displayToolName: 'Task',
      defaultOpen: false,
      wrapTitle: true,
      contentType: 'text',
      getContentProps: (input) => {
        const parts = [];
        const subject = getStringField(input, 'subject');
        const description = getStringField(input, 'description');
        const status = getStringField(input, 'status');
        if (subject) parts.push(`**Subject:** ${subject}`);
        if (description) parts.push(`**Description:** ${description}`);
        if (status) parts.push(`**Status:** ${status}`);
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
        const taskId = getStringField(input, 'taskId');
        const status = getStringField(input, 'status');
        const subject = getStringField(input, 'subject');
        if (taskId) parts.push(`#${taskId}`);
        if (status) parts.push(status);
        if (subject) parts.push(`"${subject}"`);
        return parts.join(' → ') || 'updating';
      },
      displayToolName: 'Task',
      defaultOpen: false,
      wrapTitle: true,
      contentType: 'text',
      getContentProps: (input) => {
        const parts = [];
        const subject = getStringField(input, 'subject');
        const description = getStringField(input, 'description');
        const status = getStringField(input, 'status');
        if (subject) parts.push(`**Subject:** ${subject}`);
        if (description) parts.push(`**Description:** ${description}`);
        if (status) parts.push(`**Status:** ${status}`);
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
        content: getStringField(helpers?.toolResult, 'content')
      }),
    },
    result: {
      hidden: true
    }
  },

  TaskGet: {
    input: {
      type: 'collapsible',
      title: (input) => getStringField(input, 'taskId') ? `Task #${getStringField(input, 'taskId')}` : 'Task details',
      displayToolName: 'Task',
      defaultOpen: false,
      contentType: 'task',
      getContentProps: (input, helpers) => ({
        content: getStringField(helpers?.toolResult, 'content')
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
    input: SUBAGENT_TOOL_INPUT_CONFIG,
    result: SUBAGENT_TOOL_RESULT_CONFIG
  },

  Task: {
    input: SUBAGENT_TOOL_INPUT_CONFIG,
    result: SUBAGENT_TOOL_RESULT_CONFIG
  },

  Subagent: {
    input: SUBAGENT_TOOL_INPUT_CONFIG,
    result: SUBAGENT_TOOL_RESULT_CONFIG
  },

  // ============================================================================
  // INTERACTIVE TOOLS
  // ============================================================================

  AskUserQuestion: {
    input: {
      type: 'collapsible',
      title: (input) => {
        const record = asToolPayloadRecord(input);
        const questions = getArrayField(input, 'questions');
        const answers = asToolPayloadRecord(record.answers);
        const count = questions.length;
        const hasAnswers = Object.keys(answers).length > 0;
        if (count === 1) {
          const header = getStringField(questions[0], 'header') || 'Question';
          return hasAnswers ? `${header} — answered` : header;
        }
        return hasAnswers ? `${count} questions — answered` : `${count} questions`;
      },
      defaultOpen: false,
      contentType: 'question-answer',
      getContentProps: (input) => ({
        questions: getArrayField(input, 'questions'),
        answers: asToolPayloadRecord(asToolPayloadRecord(input).answers)
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
        content: getStringField(input, 'plan').replace(/\\n/g, '\n')
      })
    },
    result: {
      type: 'collapsible',
      contentType: 'markdown',
      getContentProps: (result) => {
        try {
          let parsed: unknown = asToolPayloadRecord(result).content;
          if (typeof parsed === 'string') {
            parsed = JSON.parse(parsed);
          }
          const parsedRecord = asToolPayloadRecord(parsed);
          const plan = getStringField(parsedRecord, 'plan');
          return {
            content: plan.replace(/\\n/g, '\n')
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
        content: getStringField(input, 'plan').replace(/\\n/g, '\n')
      })
    },
    result: {
      type: 'collapsible',
      contentType: 'markdown',
      getContentProps: (result) => {
        try {
          let parsed: unknown = asToolPayloadRecord(result).content;
          if (typeof parsed === 'string') {
            parsed = JSON.parse(parsed);
          }
          const parsedRecord = asToolPayloadRecord(parsed);
          const plan = getStringField(parsedRecord, 'plan');
          return {
            content: plan.replace(/\\n/g, '\n')
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
      getValue: (input) => getStringField(input, 'url'),
      getSecondary: (input) => getStringField(input, 'source') || undefined,
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
      getValue: (input) => getStringField(input, 'path') || getStringField(input, 'source') || 'inline content',
      getSecondary: (input) => getStringField(input, 'path') ? getStringField(input, 'source') : undefined,
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
      title: (input) => getStringField(input, 'path') || 'file',
      displayToolName: (input) => formatContextTimeoutTitle(asToolPayloadRecord(input).timeout),
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
      title: (input) => getStringField(input, 'intent') || 'Context command',
      displayToolName: (input) => formatContextTimeoutTitle(asToolPayloadRecord(input).timeout),
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
      title: (input) => getStringField(input, 'intent') || getStringField(input, 'path') || getStringField(input, 'url') || getStringField(input, 'source') || 'Context command',
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
        const resultContent = getStringField(helpers?.toolResult, 'content').trim();
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

  if (isSubagentToolName(toolName)) {
    return TOOL_CONFIGS.Subagent;
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
export function shouldHideToolResult(toolName: string, toolResult: ToolPayload): boolean {
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
