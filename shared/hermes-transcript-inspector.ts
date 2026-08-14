/**
 * 文件目的：提供 ozw 与 Hermes Dashboard Inspector 共用的纯会话归一化规则。
 * 业务边界：只转换 REST/SQLite 投影，不执行 IO，也不依赖 React 或任一宿主运行时。
 */

export type HermesRecord = Record<string, any>;

export type HermesEventTimestamp = string | number;

export type HermesToolEvent = {
  kind: 'tool';
  key: string;
  callId: string;
  name: string;
  input: unknown;
  result?: string;
  error: boolean;
  unmatched: boolean;
  rowId: string | number;
  timestamp?: HermesEventTimestamp;
  resultRowId?: string | number;
  resultTimestamp?: HermesEventTimestamp;
  raw: HermesRecord[];
};

export type HermesDisplayEvent = HermesToolEvent | {
  kind: 'reasoning';
  key: string;
  content: string;
  rowId: string | number;
  timestamp?: HermesEventTimestamp;
  raw: HermesRecord[];
} | {
  kind: 'assistant';
  key: string;
  content: string;
  phase: 'commentary' | 'final';
  rowId: string | number;
  timestamp?: HermesEventTimestamp;
  raw: HermesRecord[];
};

export type HermesTurn = {
  key: string;
  user: string;
  timestamp?: HermesEventTimestamp;
  events: HermesDisplayEvent[];
  raw: HermesRecord[];
};

const MAX_FIELD_BYTES = 48 * 1024;

/** 解码 Hermes 的结构化文本信封，并为不可展示媒体留下明确占位。 */
export function decodeHermesStructuredContent(content: unknown): string {
  if (typeof content !== 'string') return '';
  if (!content.startsWith('\0json:')) return content;
  try {
    const parts = JSON.parse(content.slice(6));
    if (!Array.isArray(parts)) return '';
    return parts.map((part) => {
      if (typeof part === 'string') return part;
      if (part?.type === 'text' && typeof part.text === 'string') return part.text;
      return String(part?.type || '').match(/image|file|media/) ? '[Hermes media omitted]' : '';
    }).filter(Boolean).join('\n');
  } catch {
    return '[Invalid structured Hermes content]';
  }
}

/** 安全解析 Hermes 可能保存为 JSON 字符串的对象或数组字段。 */
export function parseHermesJSON(value: unknown, fallback: unknown): any {
  if (typeof value !== 'string') return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/** 判断子会话是否是 compression continuation，而不是 branch/delegate。 */
export function isHermesCompressionContinuation(child: HermesRecord, parent?: HermesRecord): boolean {
  if (!parent || parent.end_reason !== 'compression' || child.source === 'tool') return false;
  const modelConfig = parseHermesJSON(child.model_config, {});
  return !modelConfig?._delegate_from && !modelConfig?._branched_from;
}

/** 从 tip 向上收集连续 compression lineage，并按父到子排序。 */
export function hermesLineageIds(rows: HermesRecord[], tipId: string): string[] {
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const result: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(tipId);
  while (current && !seen.has(String(current.id))) {
    const id = String(current.id);
    result.unshift(id);
    seen.add(id);
    const parent = current.parent_session_id ? byId.get(String(current.parent_session_id)) : undefined;
    current = isHermesCompressionContinuation(current, parent) ? parent : undefined;
  }
  return result;
}

/** 判断相邻 lineage 节点边界上的 user 消息是否为 compression echo。 */
export function isHermesCompressionUserEcho(older: HermesRecord, newer: HermesRecord, sessionIds: string[]): boolean {
  if (older.role !== 'user' || newer.role !== 'user') return false;
  const olderIndex = sessionIds.indexOf(String(older.session_id));
  const newerIndex = sessionIds.indexOf(String(newer.session_id));
  return olderIndex >= 0
    && newerIndex === olderIndex + 1
    && Boolean(decodeHermesStructuredContent(older.content).trim())
    && decodeHermesStructuredContent(older.content).trim() === decodeHermesStructuredContent(newer.content).trim();
}

/** 限制浏览器中单字段体积，同时明确标出截断边界。 */
function boundedText(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value : String(value ?? '');
  const bytes = new TextEncoder().encode(text).byteLength;
  return bytes <= MAX_FIELD_BYTES ? text : `[Hermes ${label} truncated: ${bytes} UTF-8 bytes]`;
}

/** 对结构化值执行同一字段预算，超限时返回可见边界对象。 */
function boundedValue(value: unknown, label: string): unknown {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = String(value ?? '');
  }
  const bytes = new TextEncoder().encode(serialized).byteLength;
  return bytes <= MAX_FIELD_BYTES
    ? value
    : { truncated: true, message: `[Hermes ${label} truncated: ${bytes} UTF-8 bytes]` };
}

/** 从 provider 的 reasoning_details 对象/数组中提取可展示文本。 */
function reasoningDetailTexts(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === 'string') {
    const parsed = parseHermesJSON(value, value);
    return parsed === value ? (value.trim() ? [value] : []) : reasoningDetailTexts(parsed, seen);
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) return value.flatMap(entry => reasoningDetailTexts(entry, seen));
  const record = value as HermesRecord;
  if (/redacted/i.test(String(record.type || ''))) return [];
  return ['thinking', 'text', 'summary', 'content', 'reasoning']
    .flatMap(key => reasoningDetailTexts(record[key], seen));
}

/** 合并三种 Hermes reasoning 字段，并按可见文本去重。 */
function reasoningTexts(row: HermesRecord): string[] {
  const values = [row.reasoning, row.reasoning_content]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));
  values.push(...reasoningDetailTexts(row.reasoning_details));
  return values.filter((value, index, all) => all.indexOf(value) === index);
}

/** 从持久化结果字段判断工具失败；Hermes 当前未单列通用 is_error 列。 */
function isToolResultError(row: HermesRecord, content: string): boolean {
  if (row.error === true || row.is_error === true || row.effect_disposition === 'unknown') return true;
  if (/^(?:error executing tool|\[?tool execution cancelled|\[orphan recovery:)/i.test(content.trim())) return true;
  const parsed = parseHermesJSON(content, null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  return Boolean((parsed as HermesRecord).error)
    || (parsed as HermesRecord).success === false
    || (parsed as HermesRecord).ok === false;
}

/** 将工具参数解析为结构化值，解析失败时保留原文。 */
function toolInput(call: HermesRecord): unknown {
  const value = call?.function?.arguments ?? call?.arguments ?? {};
  if (typeof value !== 'string') return boundedValue(value, 'tool input');
  try {
    return boundedValue(JSON.parse(value), 'tool input');
  } catch {
    return boundedValue(value, 'tool input');
  }
}

/** 保留 Hermes 可序列化时间戳，拒绝不稳定的对象值。 */
function eventTimestamp(row: HermesRecord): HermesEventTimestamp | undefined {
  if (typeof row.timestamp === 'string') return row.timestamp;
  return typeof row.timestamp === 'number' && Number.isFinite(row.timestamp) ? row.timestamp : undefined;
}

/** 返回跨 session 仍稳定的消息行身份。 */
function rowIdentity(row: HermesRecord, fallbackIndex: number): string {
  const sessionId = String(row.session_id || 'session');
  const rowId = row.id ?? `index-${fallbackIndex}`;
  return `${sessionId}-${String(rowId)}`;
}

/** 返回事件对外暴露的原始行 ID，旧记录缺失 ID 时使用稳定输入序号。 */
function eventRowId(row: HermesRecord, fallbackIndex: number): string | number {
  return typeof row.id === 'string' || typeof row.id === 'number'
    ? row.id
    : `index-${fallbackIndex}`;
}

/** 新建一个与首条用户消息绑定的稳定 turn。 */
function createTurn(row: HermesRecord, user = '', fallbackIndex = 0): HermesTurn {
  return {
    key: `hermes-turn-${rowIdentity(row, fallbackIndex)}`,
    user,
    timestamp: eventTimestamp(row),
    events: [],
    raw: [],
  };
}

/** 以 lineage 顺序为主、session 内插入 ID 为辅，稳定排列父子消息。 */
function orderedHermesRows(rows: HermesRecord[], sessionIds: string[]): Array<{ row: HermesRecord; inputIndex: number }> {
  const lineageRank = new Map(sessionIds.map((sessionId, index) => [String(sessionId), index]));
  return rows.map((row, inputIndex) => ({ row, inputIndex })).sort((left, right) => {
    const leftRank = lineageRank.get(String(left.row.session_id)) ?? sessionIds.length;
    const rightRank = lineageRank.get(String(right.row.session_id)) ?? sessionIds.length;
    if (leftRank !== rightRank) return leftRank - rightRank;
    const leftId = Number(left.row.id);
    const rightId = Number(right.row.id);
    if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) return leftId - rightId;
    return left.inputIndex - right.inputIndex;
  });
}

/** 为当前 turn/session 的未完成工具调用生成配对作用域。 */
function toolScope(row: HermesRecord, callId: string): string {
  return `${String(row.session_id || 'session')}\0${callId}`;
}

/**
 * 把父子 lineage 的原始消息归一化为保持真实执行顺序的 turn 事件。
 * 同一 assistant 行缺少 provider 原始块序时，对齐 OZW read model，稳定回退为 reasoning → tool_calls → content。
 */
export function normalizeHermesTranscript(rows: HermesRecord[], sessionIds: string[]): HermesTurn[] {
  const ordered = orderedHermesRows(rows, sessionIds);
  const turns: HermesTurn[] = [];
  const openTools = new Map<string, HermesToolEvent[]>();
  let current: HermesTurn | undefined;
  let previous: HermesRecord | undefined;

  for (const { row, inputIndex } of ordered) {
    const content = boundedText(decodeHermesStructuredContent(row.content), `${String(row.role || 'message')} content`);
    if (row.role === 'user') {
      if (previous && isHermesCompressionUserEcho(previous, row, sessionIds)) {
        current?.raw.push(row);
        previous = row;
        continue;
      }
      current = createTurn(row, content, inputIndex);
      openTools.clear();
      current.raw.push(row);
      turns.push(current);
    } else {
      if (!current) {
        current = createTurn(row, '', inputIndex);
        turns.push(current);
      }
      current.raw.push(row);
      if (row.role === 'assistant') {
        const reasoning = reasoningTexts(row);
        const identity = rowIdentity(row, inputIndex);
        const rowId = eventRowId(row, inputIndex);
        const timestamp = eventTimestamp(row);
        for (let reasoningIndex = 0; reasoningIndex < reasoning.length; reasoningIndex += 1) {
          const value = reasoning[reasoningIndex];
          const bounded = boundedText(value, 'reasoning');
          current.events.push({
            kind: 'reasoning',
            key: `hermes-event-${identity}-reasoning-${reasoningIndex}`,
            content: bounded,
            rowId,
            timestamp,
            raw: [row],
          });
        }
        const calls = parseHermesJSON(row.tool_calls, []);
        const parsedCalls = Array.isArray(calls) ? calls : [];
        if (parsedCalls.length > 0) {
          for (let index = 0; index < parsedCalls.length; index += 1) {
            const call = parsedCalls[index];
            const callId = String(call?.id || `missing-call-${identity}-${index}`);
            const event: HermesToolEvent = {
              kind: 'tool',
              key: `hermes-event-${identity}-tool-${index}`,
              callId,
              name: String(call?.function?.name || call?.name || 'tool'),
              input: toolInput(call),
              error: false,
              unmatched: false,
              rowId,
              timestamp,
              raw: [row],
            };
            current.events.push(event);
            const scope = toolScope(row, callId);
            openTools.set(scope, [...(openTools.get(scope) || []), event]);
          }
        }
        if (content) {
          current.events.push({
            kind: 'assistant',
            key: `hermes-event-${identity}-assistant`,
            content,
            phase: parsedCalls.length > 0 || row.finish_reason === 'tool_calls' ? 'commentary' : 'final',
            rowId,
            timestamp,
            raw: [row],
          });
        }
      } else if (row.role === 'tool') {
        const identity = rowIdentity(row, inputIndex);
        const rowId = eventRowId(row, inputIndex);
        const timestamp = eventTimestamp(row);
        const persistedCallId = String(row.tool_call_id || '');
        const callId = persistedCallId
          || `unmatched-${identity}`;
        const scope = toolScope(row, callId);
        const candidates = persistedCallId ? openTools.get(scope) : undefined;
        const matched = candidates?.shift();
        if (matched) {
          matched.result = content;
          matched.error = isToolResultError(row, content);
          matched.resultRowId = rowId;
          matched.resultTimestamp = timestamp;
          matched.raw.push(row);
          if (candidates?.length === 0) openTools.delete(scope);
        } else {
          current.events.push({
            kind: 'tool',
            key: `hermes-event-${identity}-unmatched-tool-result`,
            callId,
            name: String(row.tool_name || 'tool'),
            input: {},
            result: content,
            error: isToolResultError(row, content),
            unmatched: true,
            rowId,
            timestamp,
            resultRowId: rowId,
            resultTimestamp: timestamp,
            raw: [row],
          });
        }
      }
    }
    previous = row;
  }
  return turns;
}
