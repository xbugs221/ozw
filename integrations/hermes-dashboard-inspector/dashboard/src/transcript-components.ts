/**
 * 文件目的：使用 OZW 的 turn 分组规则渲染 Hermes 用户消息、思考、工具过程和最终正文。
 * 业务边界：组件只使用 Dashboard 注入的 React；原始记录仅保留为显式开启的只读审计信息。
 */
import type { HermesDisplayEvent, HermesTurn } from '../../../../shared/hermes-transcript-inspector';
import type { ChatMessage } from '../../../../frontend/components/chat/types/types';
import {
  buildTurnDisplayBlocks,
  type TurnNonBodyGroupBlock,
} from '../../../../frontend/components/chat/utils/turnNonBodyCollapse';
import { formatProcessedDuration } from '../../../../frontend/components/chat/utils/turnSummaryFormatting';

type SDK = Record<string, any>;
type ReactRuntime = Record<string, any>;

type OrderedHermesTurn = HermesTurn & { events: HermesDisplayEvent[] };

const MAX_RENDERED_JSON_BYTES = 256 * 1024;
const COMMAND_TOOL_NAMES = new Set([
  'bash',
  'exec',
  'exec_command',
  'functions.exec',
  'functions.exec_command',
  'terminal',
]);

/** 创建使用宿主 React 实例的元素，避免插件打包第二份 React。 */
function element(React: ReactRuntime, type: any, props?: Record<string, any> | null, ...children: any[]): any {
  return React.createElement(type, props, ...children);
}

/** 渲染 OZW disclosure 使用的右向 chevron，展开后由 CSS 旋转。 */
function DisclosureChevron({ React }: { React: ReactRuntime }): any {
  return element(React, 'svg', {
    className: 'hti-detail-chevron',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }, element(React, 'path', { d: 'M9 5l7 7-7 7' }));
}

/** 渲染 OZW 单行 thinking 左侧的灯泡图标。 */
function ThinkingBulb({ React }: { React: ReactRuntime }): any {
  return element(React, 'svg', {
    className: 'hti-thinking-bulb',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }, element(React, 'path', {
    d: 'M9.663 17h4.673M12 3v1m6.364 1.636-.707.707M21 12h-1M4 12H3m3.343-5.657-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547Z',
  }));
}

/** 把任意值安全格式化为有界文本，避免大型工具结果阻塞 Dashboard。 */
function printable(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  try {
    const formatted = JSON.stringify(value, null, 2);
    const bytes = new TextEncoder().encode(formatted).byteLength;
    return bytes <= MAX_RENDERED_JSON_BYTES
      ? formatted
      : `[Hermes value truncated: ${bytes} UTF-8 bytes]`;
  } catch {
    return String(value ?? '');
  }
}

/** 解析可能以 JSON 字符串保存的 Hermes 工具参数。 */
function parsedValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** 读取 Hermes 秒级或毫秒级时间戳。 */
function timestampMs(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'number') {
    const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value;
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }
  if (typeof value === 'string' && value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return timestampMs(numeric);
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** 从原始 turn 中寻找指定位置附近的持久化时间戳。 */
function turnTimestamp(turn: OrderedHermesTurn, index = 0): number {
  const eventTime = turn.events[Math.max(0, index - 1)]?.timestamp;
  const rawTime = turn.raw[Math.min(index, Math.max(0, turn.raw.length - 1))]?.timestamp;
  return index === 0
    ? timestampMs(turn.timestamp) ?? timestampMs(rawTime) ?? timestampMs(eventTime) ?? 0
    : timestampMs(eventTime) ?? timestampMs(rawTime) ?? timestampMs(turn.timestamp) ?? 0;
}

/** 格式化用户气泡中的时间，保持 OZW 的浏览器本地时间表现。 */
function formatMessageTime(turn: OrderedHermesTurn): string {
  const rawUser = turn.raw.find((row) => row.role === 'user');
  const value = timestampMs(rawUser?.timestamp) ?? turnTimestamp(turn);
  return value > 0 ? new Date(value).toLocaleTimeString() : '';
}

/** 仅允许普通网页、邮件、页面锚点和相对路径链接，拒绝可执行协议。 */
function safeLinkHref(value: string): string | null {
  const href = value.trim();
  if (/^(?:https?:|mailto:|#|\/|\.\.?\/)/i.test(href)) return href;
  return /^[^\s:/?#][^\s:]*$/.test(href) ? href : null;
}

/** 把行内代码和 Markdown 链接渲染为安全 React 节点，不解释 raw HTML。 */
function InlineText({ React, text }: { React: ReactRuntime; text: string }): any {
  const chunks = text.split(/(`[^`]+`|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  return element(React, React.Fragment, null, ...chunks.map((chunk, index) => {
    if (chunk.startsWith('`') && chunk.endsWith('`')) {
      return element(React, 'code', { key: index }, chunk.slice(1, -1));
    }
    const link = chunk.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    const href = link ? safeLinkHref(link[2]) : null;
    if (link && href) {
      const external = /^https?:/i.test(href);
      return element(React, 'a', {
        key: index,
        href,
        target: external ? '_blank' : undefined,
        rel: external ? 'noreferrer' : undefined,
      }, link[1]);
    }
    if (chunk.startsWith('**') && chunk.endsWith('**')) {
      return element(React, 'strong', { key: index }, chunk.slice(2, -2));
    }
    if (chunk.startsWith('*') && chunk.endsWith('*')) {
      return element(React, 'em', { key: index }, chunk.slice(1, -1));
    }
    return chunk;
  }));
}

/** 渲染聊天正文与 thinking 共用的轻量 Markdown 结构。 */
function RichText({ React, content }: { React: ReactRuntime; content: string }): any {
  const blocks = content.split(/(```[\s\S]*?```)/g).filter(Boolean);
  return element(React, 'div', { className: 'hti-rich-text' }, ...blocks.flatMap((block, blockIndex) => {
    if (block.startsWith('```')) {
      const match = block.match(/^```([^\n]*)\n?([\s\S]*?)```$/);
      return [element(React, 'div', { className: 'hti-code-block', key: `code-${blockIndex}` },
        match?.[1] ? element(React, 'span', { className: 'hti-code-language' }, match[1]) : null,
        element(React, 'pre', null,
          element(React, 'code', {
            className: match?.[1] ? `language-${match[1].trim().replace(/[^A-Za-z0-9_-]/g, '-')}` : undefined,
          }, match?.[2] || block.slice(3, -3))))];
    }
    return block.trim().split(/\n\s*\n/).filter(Boolean).map((group, groupIndex) => {
      const lines = group.split('\n');
      const heading = lines[0]?.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        return element(React, `h${heading[1].length}`, { key: `heading-${blockIndex}-${groupIndex}` },
          element(React, InlineText, { React, text: heading[2] }));
      }
      if (lines.every(line => /^\s*>\s?/.test(line))) {
        return element(React, 'blockquote', { key: `quote-${blockIndex}-${groupIndex}` },
          element(React, InlineText, { React, text: lines.map(line => line.replace(/^\s*>\s?/, '')).join(' ') }));
      }
      if (lines.every(line => /^\s*[-*]\s+/.test(line))) {
        return element(React, 'ul', { key: `list-${blockIndex}-${groupIndex}` }, ...lines.map((line, lineIndex) =>
          element(React, 'li', { key: lineIndex }, element(React, InlineText, {
            React,
            text: line.replace(/^\s*[-*]\s+/, ''),
          }))));
      }
      if (lines.every(line => /^\s*\d+\.\s+/.test(line))) {
        return element(React, 'ol', { key: `ordered-list-${blockIndex}-${groupIndex}` }, ...lines.map((line, lineIndex) =>
          element(React, 'li', { key: lineIndex }, element(React, InlineText, {
            React,
            text: line.replace(/^\s*\d+\.\s+/, ''),
          }))));
      }
      return element(React, 'p', { key: `paragraph-${blockIndex}-${groupIndex}` }, ...lines.flatMap((line, lineIndex) => [
        lineIndex > 0 ? ' ' : null,
        element(React, InlineText, { key: `line-${lineIndex}`, React, text: line }),
      ]));
    });
  }));
}

/** 为 buildTurnDisplayBlocks 构造窄 ChatMessage 适配，复用 OZW 的分组与默认开闭逻辑。 */
function adaptTurnMessages(turn: OrderedHermesTurn): ChatMessage[] {
  const baseTimestamp = turnTimestamp(turn);
  const messages: ChatMessage[] = turn.user ? [{
    type: 'user',
    content: turn.user,
    timestamp: baseTimestamp,
    messageKey: `${turn.key}:user`,
  }] : [];

  turn.events.forEach((event, index) => {
    const timestamp = timestampMs(event.kind === 'tool' ? event.resultTimestamp ?? event.timestamp : event.timestamp)
      ?? turnTimestamp(turn, index + 1);
    const messageKey = String(event.key || `${turn.key}:event:${index}`);
    if (event.kind === 'reasoning' || (event.kind === 'assistant' && event.phase === 'commentary')) {
      messages.push({
        type: 'reasoning',
        content: String(event.content || ''),
        timestamp,
        messageKey,
        isThinking: true,
        phase: 'commentary',
      });
      return;
    }
    if (event.kind === 'tool') {
      messages.push({
        type: 'command_execution',
        timestamp,
        messageKey,
        isToolUse: true,
        toolName: String(event.name || 'tool'),
        toolInput: event.input ?? {},
        toolResult: event.result === undefined ? null : {
          content: printable(event.result),
          isError: Boolean(event.error),
        },
        toolCallId: String(event.callId || messageKey),
        unmatched: Boolean(event.unmatched),
      });
      return;
    }
    if (event.kind === 'assistant') {
      messages.push({
        type: 'assistant',
        content: String(event.content || ''),
        timestamp,
        messageKey,
        phase: 'final',
      });
    }
  });
  return messages;
}

/** 提取 terminal/exec 工具中真正需要阅读的命令。 */
function commandText(input: unknown): string {
  const parsed = parsedValue(input);
  if (typeof parsed === 'string') return parsed;
  if (!parsed || typeof parsed !== 'object') return '';
  const record = parsed as Record<string, unknown>;
  return String(record.command ?? record.cmd ?? record.code ?? '');
}

/** 从 Hermes 命令结果信封中提取真正 stdout/stderr/error，避免显示整块 JSON。 */
function commandOutputText(value: unknown): string {
  const parsed = parsedValue(value);
  if (typeof parsed === 'string') return parsed.trim();
  if (Array.isArray(parsed)) return parsed.map(commandOutputText).filter(Boolean).join('\n');
  if (!parsed || typeof parsed !== 'object') return printable(parsed);
  const record = parsed as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ['output', 'stdout', 'stderr', 'error', 'message', 'content', 'text']) {
    if (record[key] !== undefined && record[key] !== parsed) {
      const content = commandOutputText(record[key]);
      if (content && !parts.includes(content)) parts.push(content);
    }
  }
  return parts.length > 0 ? parts.join('\n') : printable(parsed);
}

/** 为通用工具生成 OZW 风格的紧凑摘要，而非展示完整 JSON。 */
function genericToolTitle(input: unknown): string {
  const parsed = parsedValue(input);
  if (typeof parsed === 'string') return parsed.split('\n')[0] || 'Parameters';
  if (!parsed || typeof parsed !== 'object') return 'Parameters';
  const record = parsed as Record<string, unknown>;
  const value = record.file_path ?? record.path ?? record.pattern ?? record.query ?? record.url ?? record.command ?? record.cmd;
  return value ? String(value).split('\n')[0] : 'Parameters';
}

/** 将工具名称归入与 OZW CollapsibleDisplay 相同的左边线色彩类别。 */
function toolCategory(name: string): string {
  const normalized = name.toLowerCase();
  if (COMMAND_TOOL_NAMES.has(normalized)) return 'bash';
  if (/edit|write|patch/.test(normalized)) return 'edit';
  if (/grep|glob|search/.test(normalized)) return 'search';
  if (/agent|task/.test(normalized)) return 'agent';
  if (/plan/.test(normalized)) return 'plan';
  if (/question|ask/.test(normalized)) return 'question';
  return 'default';
}

/** 渲染一个默认关闭、只以三角图标呈现入口的命令输出。 */
function CommandOutput({ React, hooks, tool }: { React: ReactRuntime; hooks: SDK['hooks']; tool: ChatMessage }): any {
  const [open, setOpen] = hooks.useState(false);
  const output = commandOutputText(tool.toolResult?.content);
  if (!output) return null;
  return element(React, 'details', {
    className: `hti-command-output${tool.toolResult?.isError ? ' is-error' : ''}`,
    id: `tool-result-${String(tool.toolCallId || tool.messageKey).replace(/[^A-Za-z0-9_-]/g, '-')}`,
    open,
    onToggle: (event: any) => setOpen(event.currentTarget.open),
  },
  element(React, 'summary', {
    'aria-label': open ? 'Hide output' : 'Show output',
    'aria-expanded': open,
  }, element(React, 'span', { 'aria-hidden': true }, open ? '▾' : '▸')),
  open ? element(React, 'pre', null, output) : null);
}

/** 渲染 terminal/exec_command：命令始终可见，输出在同卡片内独立折叠。 */
function CommandToolCard({ React, hooks, tool }: { React: ReactRuntime; hooks: SDK['hooks']; tool: ChatMessage }): any {
  const [copied, setCopied] = hooks.useState(false);
  const command = commandText(tool.toolInput);

  /** 复制真实命令，并用短暂状态反馈替换按钮标签。 */
  const handleCopy = async () => {
    let didCopy = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(command);
        didCopy = true;
      }
    } catch {
      didCopy = false;
    }
    if (!didCopy) {
      const textarea = document.createElement('textarea');
      textarea.value = command;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      didCopy = document.execCommand('copy');
      textarea.remove();
    }
    setCopied(didCopy);
    if (didCopy) {
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  return element(React, 'div', {
    className: 'hti-command-card',
    'data-component': 'ToolCallCard',
    'data-tool-name': tool.toolName,
    'data-tool-status': tool.toolResult?.isError ? '错误' : tool.toolResult ? '完成' : '无结果',
  },
  element(React, 'pre', { className: 'hti-command-code' }, command),
  element(React, 'button', {
    type: 'button',
    className: 'hti-command-copy',
    onClick: handleCopy,
    'aria-label': copied ? 'Command copied' : 'Copy command',
    title: copied ? 'Copied' : 'Copy command',
  }, copied ? '✓' : '⧉'),
  element(React, CommandOutput, { React, hooks, tool }));
}

/** 统一工具别名，避免 provider/MCP 前缀让已知工具退化为 JSON fallback。 */
function normalizedToolName(name: unknown): string {
  const raw = String(name || '').toLowerCase();
  const leaf = raw.split(/[.:/]/).at(-1) || raw;
  return leaf.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** 读取已知工具参数的对象形态。 */
function toolInputRecord(input: unknown): Record<string, unknown> {
  const parsed = parsedValue(input);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

/** 从若干 provider 字段中读取第一个非空字符串。 */
function firstToolString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/** 将已知工具结果压成可读文本，避免重新显示完整 JSON 信封。 */
function semanticResultText(value: unknown): string {
  const parsed = parsedValue(value);
  if (typeof parsed === 'string') return parsed.trim();
  if (Array.isArray(parsed)) return parsed.map(semanticResultText).filter(Boolean).join('\n');
  if (!parsed || typeof parsed !== 'object') return String(parsed ?? '');
  const record = parsed as Record<string, unknown>;
  for (const key of ['output', 'stdout', 'stderr', 'error', 'message', 'content', 'text', 'result', 'files', 'filenames', 'changes']) {
    if (record[key] !== undefined && record[key] !== parsed) {
      const content = semanticResultText(record[key]);
      if (content) return content;
    }
  }
  return Object.entries(record)
    .filter(([, entry]) => ['string', 'number', 'boolean'].includes(typeof entry))
    .map(([key, entry]) => `${key}: ${String(entry)}`)
    .join('\n');
}

/** 渲染已知工具的独立 Output；成功和错误均默认关闭。 */
function SemanticOutput({ React, tool }: { React: ReactRuntime; tool: ChatMessage }): any {
  const content = semanticResultText(tool.toolResult?.content);
  if (!content) return null;
  return element(React, 'details', {
    className: `hti-semantic-output${tool.toolResult?.isError ? ' is-error' : ''}`,
    id: `tool-result-${String(tool.toolCallId || tool.messageKey).replace(/[^A-Za-z0-9_-]/g, '-')}`,
  },
    element(React, 'summary', null, 'Output'),
    element(React, 'div', { className: 'hti-semantic-output-body' },
      tool.toolResult?.isError ? element(React, 'div', { className: 'hti-error-label' }, '× Error') : null,
      element(React, 'pre', null, content)));
}

/** 渲染 Read：路径是摘要，文件内容在同一 details 内检查。 */
function ReadToolCard({ React, tool }: { React: ReactRuntime; tool: ChatMessage }): any {
  const input = toolInputRecord(tool.toolInput);
  const path = firstToolString(input, ['file_path', 'path', 'filename']) || 'file';
  const content = semanticResultText(tool.toolResult?.content);
  return element(React, 'div', {
    className: 'hti-semantic-tool hti-tool-read-card',
    'data-component': 'ToolCallCard',
    'data-tool-renderer': 'read',
    'data-tool-name': tool.toolName,
  },
    element(React, 'details', { className: 'hti-tool-input' },
      element(React, 'summary', null,
        element(React, DisclosureChevron, { React }),
        element(React, 'span', { className: 'hti-tool-name' }, String(tool.toolName || 'Read')),
        element(React, 'span', { className: 'hti-tool-separator' }, '/'),
        element(React, 'span', { className: 'hti-tool-title' }, path)),
      !tool.toolResult?.isError && content ? element(React, 'pre', { className: 'hti-semantic-content' }, content) : null),
    tool.toolResult?.isError ? element(React, SemanticOutput, { React, tool }) : null);
}

/** 渲染 Write/Edit/ApplyPatch：只展示动作与目标路径，隐藏成功信封。 */
function MutationToolCard({ React, tool, family }: { React: ReactRuntime; tool: ChatMessage; family: 'write' | 'edit' }): any {
  const input = toolInputRecord(tool.toolInput);
  const path = firstToolString(input, ['file_path', 'path', 'filename']) || 'file';
  const label = family === 'write' ? 'Write' : normalizedToolName(tool.toolName).includes('patch') ? 'Patch' : 'Edit';
  return element(React, 'div', {
    className: `hti-semantic-tool hti-tool-mutation-card hti-tool-${family}`,
    'data-component': 'ToolCallCard',
    'data-tool-renderer': family,
    'data-tool-name': tool.toolName,
  },
    element(React, 'div', { className: 'hti-file-action' },
      element(React, 'span', { className: 'hti-tool-name' }, label),
      element(React, 'span', { className: 'hti-tool-separator' }, '/'),
      element(React, 'code', null, path)),
    tool.toolResult?.isError ? element(React, SemanticOutput, { React, tool }) : null);
}

/** 渲染 Grep/Glob/Search：查询条件作为摘要，结果在内部按行阅读。 */
function SearchToolCard({ React, tool }: { React: ReactRuntime; tool: ChatMessage }): any {
  const input = toolInputRecord(tool.toolInput);
  const query = firstToolString(input, ['pattern', 'query', 'search_term', 'url']) || 'search';
  const path = firstToolString(input, ['path', 'directory', 'cwd']);
  const result = semanticResultText(tool.toolResult?.content);
  return element(React, 'div', {
    className: 'hti-semantic-tool hti-tool-search-card',
    'data-component': 'ToolCallCard',
    'data-tool-renderer': 'search',
    'data-tool-name': tool.toolName,
  },
    element(React, 'details', { className: 'hti-tool-input' },
      element(React, 'summary', null,
        element(React, DisclosureChevron, { React }),
        element(React, 'span', { className: 'hti-tool-name' }, String(tool.toolName || 'Search')),
        element(React, 'span', { className: 'hti-tool-separator' }, '/'),
        element(React, 'span', { className: 'hti-tool-title' }, path ? `${query} in ${path}` : query)),
      !tool.toolResult?.isError && result ? element(React, 'pre', { className: 'hti-semantic-content' }, result) : null),
    tool.toolResult?.isError ? element(React, SemanticOutput, { React, tool }) : null);
}

/** 将 update_plan/exit_plan_mode 参数渲染为说明与步骤，而不是 JSON。 */
function PlanToolCard({ React, tool }: { React: ReactRuntime; tool: ChatMessage }): any {
  const input = toolInputRecord(tool.toolInput);
  const explanation = firstToolString(input, ['explanation', 'plan', 'description']);
  const steps = Array.isArray(input.plan) ? input.plan : Array.isArray(input.steps) ? input.steps : [];
  const stepNodes = steps.map((step: any, index: number) => element(React, 'li', {
    key: `${String(step?.step || step?.content || index)}-${index}`,
  },
    element(React, 'span', {
      className: `hti-plan-state is-${String(step?.status || 'pending')}`,
      'aria-hidden': true,
    }, step?.status === 'completed' ? '✓' : '○'),
    element(React, 'span', null, String(step?.step || step?.content || step))));
  const countLabel = `${stepNodes.length} steps`;
  return element(React, 'section', {
    className: 'hti-semantic-tool hti-tool-plan-card',
    'data-component': 'ToolCallCard',
    'data-tool-renderer': 'plan',
    'data-tool-name': tool.toolName,
  },
    element(React, 'details', { className: 'hti-tool-input' },
      element(React, 'summary', null,
        element(React, DisclosureChevron, { React }),
        element(React, 'span', { className: 'hti-tool-name' }, String(tool.toolName || 'Plan')),
        element(React, 'span', { className: 'hti-tool-separator' }, '/'),
        element(React, 'span', { className: 'hti-tool-title' }, countLabel)),
      element(React, 'div', { className: 'hti-plan-body' },
        explanation ? element(React, RichText, { React, content: explanation }) : null,
        stepNodes.length > 0 ? element(React, 'ol', { className: 'hti-plan-steps' }, ...stepNodes) : null)),
    tool.toolResult?.isError ? element(React, SemanticOutput, { React, tool }) : null);
}

/** 渲染未匹配结果边界：摘要说明 tool/call id，output 仍保持独立关闭。 */
function UnmatchedToolCard({ React, tool }: { React: ReactRuntime; tool: ChatMessage }): any {
  return element(React, 'div', {
    className: 'hti-unmatched-tool',
    'data-tool-unmatched': 'true',
    'data-tool-name': tool.toolName,
  },
    element(React, 'details', { className: 'hti-unmatched-boundary' },
      element(React, 'summary', null,
        element(React, DisclosureChevron, { React }),
        element(React, 'span', { className: 'hti-boundary-label' }, '未匹配'),
        element(React, 'span', { className: 'hti-tool-separator' }, '/'),
        element(React, 'span', { className: 'hti-tool-title' }, `${String(tool.toolName || 'tool')} · ${String(tool.toolCallId || 'missing call id')}`)),
      element(React, 'div', { className: 'hti-boundary-warning', role: 'status' },
        element(React, 'span', { 'aria-hidden': true }, '⚠'),
        element(React, 'span', null, '未找到对应 tool call；结果保留在原始事件位置。'))),
    element(React, SemanticOutput, { React, tool }));
}

/** 渲染 subagent：任务摘要和 prompt 在卡内，result 使用独立 Output。 */
function SubagentToolCard({ React, tool }: { React: ReactRuntime; tool: ChatMessage }): any {
  const input = toolInputRecord(tool.toolInput);
  const type = firstToolString(input, ['agent_type', 'subagent_type', 'type', 'name']) || 'agent';
  const description = firstToolString(input, ['description', 'task', 'task_name', 'title']) || 'delegated task';
  const prompt = firstToolString(input, ['prompt', 'message', 'instructions']);
  return element(React, 'div', {
    className: 'hti-semantic-tool hti-tool-subagent-card',
    'data-component': 'ToolCallCard',
    'data-tool-renderer': 'subagent',
    'data-tool-name': tool.toolName,
  },
    element(React, 'details', { className: 'hti-tool-input' },
      element(React, 'summary', null,
        element(React, DisclosureChevron, { React }),
        element(React, 'span', { className: 'hti-tool-name' }, 'Subagent'),
        element(React, 'span', { className: 'hti-tool-separator' }, '/'),
        element(React, 'span', { className: 'hti-tool-title' }, `${type}: ${description}`)),
      prompt ? element(React, 'div', { className: 'hti-subagent-prompt' }, element(React, RichText, { React, content: prompt })) : null),
    element(React, SemanticOutput, { React, tool }));
}

/** 渲染通用工具：低对比摘要卡与独立结果 disclosure。 */
function GenericToolCard({ React, tool }: { React: ReactRuntime; tool: ChatMessage }): any {
  const result = printable(tool.toolResult?.content);
  const category = toolCategory(String(tool.toolName || 'tool'));
  return element(React, 'div', {
    className: `hti-generic-tool hti-tool-${category}`,
    'data-component': 'ToolCallCard',
    'data-tool-name': tool.toolName,
    'data-tool-status': tool.toolResult?.isError ? '错误' : tool.toolResult ? '完成' : '无结果',
  },
  element(React, 'details', { className: 'hti-tool-input' },
      element(React, 'summary', null,
      element(React, DisclosureChevron, { React }),
      element(React, 'span', { className: 'hti-tool-name' }, tool.toolName || 'tool'),
      element(React, 'span', { className: 'hti-tool-separator' }, '/'),
      element(React, 'span', { className: 'hti-tool-title' }, genericToolTitle(tool.toolInput))),
    element(React, 'pre', { className: 'hti-tool-value' }, printable(parsedValue(tool.toolInput)))),
  result ? element(React, 'details', {
    className: `hti-generic-output${tool.toolResult?.isError ? ' is-error' : ''}`,
    id: `tool-result-${String(tool.toolCallId || tool.messageKey).replace(/[^A-Za-z0-9_-]/g, '-')}`,
  },
    element(React, 'summary', null, 'Output'),
    element(React, 'div', { className: 'hti-generic-output-body' },
      tool.toolResult?.isError ? element(React, 'div', { className: 'hti-error-label' }, '× Error') : null,
      element(React, 'pre', null, result))) : null);
}

/** 识别 OZW 已有的工具族；返回 null 时才允许 generic JSON fallback。 */
function knownToolFamily(name: unknown): 'command' | 'read' | 'write' | 'edit' | 'search' | 'plan' | 'subagent' | null {
  const normalized = normalizedToolName(name);
  if (COMMAND_TOOL_NAMES.has(normalized)) return 'command';
  if (['read', 'read_file', 'view_image'].includes(normalized)) return 'read';
  if (['write', 'write_file'].includes(normalized)) return 'write';
  if (['edit', 'edit_file', 'apply_patch', 'applypatch'].includes(normalized)) return 'edit';
  if (['grep', 'glob', 'search', 'web_search', 'websearch'].includes(normalized)) return 'search';
  if (['update_plan', 'exit_plan_mode', 'exitplanmode', 'plan'].includes(normalized)) return 'plan';
  if (['agent', 'task', 'subagent', 'spawn_agent', 'spawn_subagent', 'delegate_to_agent'].includes(normalized)) return 'subagent';
  return null;
}

/** 按工具类型选择 OZW 窄语义 renderer，并显式保留 unmatched 边界。 */
function ToolMessage({ React, hooks, message }: { React: ReactRuntime; hooks: SDK['hooks']; message: ChatMessage }): any {
  if (message.unmatched) return element(React, UnmatchedToolCard, { React, tool: message });
  const family = knownToolFamily(message.toolName);
  const card = family === 'command'
    ? element(React, CommandToolCard, { React, hooks, tool: message })
    : family === 'read'
      ? element(React, ReadToolCard, { React, tool: message })
      : family === 'write' || family === 'edit'
        ? element(React, MutationToolCard, { React, tool: message, family })
        : family === 'search'
          ? element(React, SearchToolCard, { React, tool: message })
          : family === 'plan'
            ? element(React, PlanToolCard, { React, tool: message })
            : family === 'subagent'
              ? element(React, SubagentToolCard, { React, tool: message })
              : element(React, GenericToolCard, { React, tool: message });
  return card;
}

/** 渲染独立 thinking：单行直显，多行以最后一行作为默认关闭摘要。 */
function ThinkingMessage({ React, hooks, message }: { React: ReactRuntime; hooks: SDK['hooks']; message: ChatMessage }): any {
  const content = String(message.content || '');
  const lines = content.split('\n').filter((line) => line.trim());
  const lastLine = lines[lines.length - 1] || '';
  const [open, setOpen] = hooks.useState(false);
  if (lines.length === 0) return null;
  if (lines.length === 1) {
    return element(React, 'div', { className: 'hti-thinking-single', 'data-component': 'ReasoningCard' },
      element(React, ThinkingBulb, { React }),
      element(React, RichText, { React, content: lastLine }));
  }
  return element(React, 'details', {
    className: 'hti-thinking-details',
    open,
    onToggle: (event: any) => setOpen(event.currentTarget.open),
    'data-component': 'ReasoningCard',
  },
    element(React, 'summary', null,
      element(React, DisclosureChevron, { React }),
      element(React, 'span', { className: 'hti-thinking-label' }, 'Thinking'),
      element(React, 'span', { className: 'hti-tool-separator' }, '/'),
      element(React, 'span', { className: 'hti-thinking-preview' }, lastLine)),
    open ? element(React, 'div', { className: 'hti-thinking-body' }, element(React, RichText, { React, content })) : null);
}

/** 渲染 buildTurnDisplayBlocks 产出的一个默认关闭过程组。 */
function ProcessGroup({ React, hooks, block }: { React: ReactRuntime; hooks: SDK['hooks']; block: TurnNonBodyGroupBlock }): any {
  const [open, setOpen] = hooks.useState(block.defaultOpen);
  hooks.useEffect(() => setOpen(block.defaultOpen), [block.defaultOpen, block.turnKey]);
  const duration = block.processedDurationMs === undefined ? null : formatProcessedDuration(block.processedDurationMs);
  const toolOnly = block.items.every((item) => item.kind === 'tool-group');
  const toolCount = block.items.reduce((count, item) => count + (item.kind === 'tool-group' ? item.commandCount : 0), 0);
  const toolLabel = toolCount === 1 ? '一次工具调用' : `${toolCount}次工具调用`;
  const processChildren = toolOnly
    ? [element(React, 'details', { className: 'hti-tool-group', 'data-testid': 'turn-tool-list', key: 'tool-list' },
      element(React, 'summary', null, toolLabel),
      element(React, 'div', { className: 'hti-tool-list' }, ...block.items.flatMap((item) => item.messages).map((message, index) =>
        element(React, ToolMessage, {
          React,
          hooks,
          message,
          key: String(message.toolCallId || message.messageKey || index),
        }))))]
    : block.items.map((item) => {
      if (item.kind === 'thinking-group') {
        return element(React, 'div', { className: 'hti-thinking-group', key: item.groupKey }, ...item.messages.map((message, index) =>
          element(React, ThinkingMessage, {
            React,
            hooks,
            message,
            key: String(message.messageKey || index),
          })));
      }
      const label = item.commandCount === 1 ? '一次工具调用' : `${item.commandCount}次工具调用`;
      return element(React, 'details', { className: 'hti-tool-group', 'data-testid': 'turn-tool-group', key: item.groupKey },
        element(React, 'summary', null, label),
        element(React, 'div', { className: 'hti-tool-list' }, ...item.messages.map((message, index) =>
          element(React, ToolMessage, {
            React,
            hooks,
            message,
            key: String(message.toolCallId || message.messageKey || index),
          }))));
    });
  return element(React, 'details', {
    className: `hti-process-group${toolOnly ? ' hti-tool-only-group' : ''}`,
    open,
    'data-testid': toolOnly ? 'turn-tool-list-group' : 'turn-non-body-group',
  },
    element(React, 'summary', {
      'data-testid': toolOnly ? 'turn-tool-list-toggle' : 'turn-non-body-toggle',
      'aria-expanded': open,
      onClick: (event: any) => {
        event.preventDefault();
        setOpen((current: boolean) => !current);
      },
    },
      element(React, DisclosureChevron, { React }),
      duration ? element(React, 'span', null, `耗时 ${duration}`) : null),
    open ? element(React, 'div', { className: 'hti-process-body' }, ...processChildren) : null);
}

/** 渲染与 OZW 相同的右侧绿色用户气泡。 */
function UserMessage({ React, turn }: { React: ReactRuntime; turn: OrderedHermesTurn }): any {
  return element(React, 'section', {
    className: 'hti-user-row',
    'data-component': 'MessageBubble',
    'data-role': 'user',
  },
    element(React, 'div', { className: 'hti-user-bubble' },
      element(React, 'div', { className: 'hti-user-content' }, turn.user),
      element(React, 'time', null, formatMessageTime(turn))),
    element(React, 'div', { className: 'hti-user-avatar', 'aria-hidden': true }, 'U'));
}

/** 渲染与当前 OZW grouped transcript 相同的左侧无气泡最终 Markdown 正文。 */
function AssistantMessage({ React, message }: { React: ReactRuntime; message: ChatMessage }): any {
  return element(React, 'section', {
    className: 'hti-assistant-message',
    'data-component': 'MessageBubble',
    'data-role': 'assistant',
  }, element(React, RichText, { React, content: String(message.content || '') }));
}

/** 渲染单个 turn，展示用户、过程 disclosure 与最终正文。 */
function TranscriptTurn({ React, hooks, turn, rawOpen, index }: {
  React: ReactRuntime;
  hooks: SDK['hooks'];
  turn: HermesTurn;
  rawOpen: boolean;
  index: number;
}): any {
  const orderedTurn = turn as OrderedHermesTurn;
  const blocks = hooks.useMemo(() => buildTurnDisplayBlocks(adaptTurnMessages(orderedTurn)), [turn]);
  return element(React, 'article', {
    className: 'hti-turn',
    'data-component': 'TranscriptTurn',
    'data-turn-index': index,
  },
    orderedTurn.user ? element(React, UserMessage, { React, turn: orderedTurn }) : null,
    ...blocks.flatMap((block: ReturnType<typeof buildTurnDisplayBlocks>[number], blockIndex: number) => {
      if (block.kind === 'turn-non-body-group') {
        return [element(React, ProcessGroup, { React, hooks, block, key: `${block.turnKey}:process` })];
      }
      if (block.kind === 'assistant-body') {
        return [element(React, AssistantMessage, { React, message: block.message, key: block.message.messageKey || blockIndex })];
      }
      return [];
    }),
    rawOpen ? element(React, 'details', {
      className: 'hti-raw-panel',
      open: true,
      'data-component': 'RawRecordPanel',
    }, element(React, 'summary', null, '原始记录'), element(React, 'pre', null, printable(orderedTurn.raw))) : null);
}

/** 创建绑定 Dashboard React 与 hooks 的 transcript 组件集合。 */
export function createTranscriptComponents(sdk: SDK): { TranscriptTimeline: (props: { turns: HermesTurn[]; rawOpen: boolean }) => any } {
  const React = sdk.React;
  const hooks = sdk.hooks;

  /** 渲染连续会话时间线，并让长历史逐 turn 隔离布局计算。 */
  function TranscriptTimeline({ turns, rawOpen }: { turns: HermesTurn[]; rawOpen: boolean }): any {
    return element(React, 'div', {
      className: 'hti-timeline',
      'data-testid': 'hermes-inspector-timeline',
      'data-component': 'TranscriptTimeline',
    }, ...turns.map((turn, index) => element(React, TranscriptTurn, {
      React,
      hooks,
      turn,
      rawOpen,
      index,
      key: turn.key,
    })));
  }

  return { TranscriptTimeline };
}
