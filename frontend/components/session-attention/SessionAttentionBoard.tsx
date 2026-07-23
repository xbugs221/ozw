/**
 * 文件目的：展示跨项目 Provider 会话的有界待处理看板。
 * 业务意义：打开会话不会自动确认，只有用户显式处理才移除卡片。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionProvider } from '../../types/app';
import { api } from '../../utils/api';

type AttentionItem = {
  provider: SessionProvider;
  sessionId: string;
  projectPath: string;
  title: string;
  summary: string;
  lastActivity: string;
  activityRevision: number;
};

type SessionAttentionBoardProps = {
  onNavigateToSession: (
    sessionId: string,
    options?: { provider?: SessionProvider; projectPath?: string },
  ) => void;
  invalidationMessage?: unknown;
};

const PROVIDER_LABELS: Record<SessionProvider, string> = {
  codex: 'Codex',
  claude: 'Claude Code',
  pi: 'Pi',
  hermes: 'Hermes',
};

/**
 * 从路径提取简短项目名，卡片仍保留完整路径供路由解析。
 */
function projectLabel(projectPath: string): string {
  /** 业务目的：跨项目列表在有限宽度内优先显示可识别的目录名。 */
  return String(projectPath || '').split(/[\\/]/).filter(Boolean).at(-1) || '未知项目';
}

/**
 * 返回与数据库主键一致的前端会话身份。
 */
function attentionIdentity(item: Pick<AttentionItem, 'provider' | 'sessionId'>): string {
  /** 业务目的：不同 Provider 的同号会话必须独立选择和处理。 */
  return `${item.provider}:${item.sessionId}`;
}

export default function SessionAttentionBoard({ onNavigateToSession, invalidationMessage }: SessionAttentionBoardProps) {
  /** 业务目的：单次读取最多 100 条，空闲时不轮询后端。 */
  const [items, setItems] = useState<AttentionItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const lastSelectedIndexRef = useRef<number | null>(null);
  const loadPromiseRef = useRef<Promise<void> | null>(null);

  const load = useCallback((): Promise<void> => {
    /** 首屏沿用初始加载态；后台失效刷新保留列表节点与滚动位置。 */
    if (loadPromiseRef.current) return loadPromiseRef.current;
    const request = (async () => {
      setError('');
      try {
        const response = await api.sessionAttention(100);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || '读取待处理会话失败');
        setItems(Array.isArray(payload?.items) ? payload.items : []);
        setSelectedIds(new Set());
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : '读取待处理会话失败');
      } finally {
        setIsLoading(false);
        loadPromiseRef.current = null;
      }
    })();
    loadPromiseRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    /** 看板进入时读取一次，后续刷新由用户或轻量失效事件触发。 */
    void load();
  }, [load]);

  useEffect(() => {
    /** Provider watcher 的轻量失效事件到达后重读一次，不建立轮询定时器。 */
    if ((invalidationMessage as { type?: string } | null)?.type !== 'session_changed') return undefined;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [invalidationMessage, load]);

  const toggleSelection = (index: number, checked: boolean, shiftKey: boolean) => {
    /** Shift 连选仅作用于当前有界列表，不隐式请求更多数据。 */
    setSelectedIds((current) => {
      const next = new Set(current);
      const previousIndex = lastSelectedIndexRef.current;
      const indexes = shiftKey && previousIndex !== null
        ? Array.from({ length: Math.abs(index - previousIndex) + 1 }, (_, offset) => Math.min(index, previousIndex) + offset)
        : [index];
      indexes.forEach((itemIndex) => {
        const item = items[itemIndex];
        if (!item) return;
        const identity = attentionIdentity(item);
        if (checked) next.add(identity);
        else next.delete(identity);
      });
      return next;
    });
    lastSelectedIndexRef.current = index;
  };

  const markHandled = async (targets: AttentionItem[]) => {
    /** 发送卡片渲染时观察到的版本，不使用请求时的最新值。 */
    if (targets.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    setError('');
    try {
      const response = await api.markSessionAttentionHandled(targets.map((item) => ({
        provider: item.provider,
        sessionId: item.sessionId,
        observedRevision: item.activityRevision,
      })));
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || '处理会话失败');
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '处理会话失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return <div data-testid="session-attention-board" className="flex h-full items-center justify-center text-sm text-muted-foreground">正在读取待处理会话…</div>;
  }

  const selectedItems = items.filter((item) => selectedIds.has(attentionIdentity(item)));
  return (
    <section data-testid="session-attention-board" className="h-full overflow-y-auto px-4 py-5 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">待处理会话</h1>
            <p className="mt-1 text-sm text-muted-foreground">打开会话不会自动标记完成</p>
          </div>
          {items.length > 0 && (
            <div className="flex items-center gap-2">
              <button type="button" className="rounded-md border border-border px-3 py-2 text-sm" onClick={() => setSelectedIds(new Set(items.map(attentionIdentity)))}>全选当前列表</button>
              <button type="button" disabled={selectedItems.length === 0 || isSubmitting} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50" onClick={() => void markHandled(selectedItems)}>批量处理完成</button>
            </div>
          )}
        </div>

        {error && (
          <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <span>{error}</span><button type="button" className="underline" onClick={() => void load()}>重试</button>
          </div>
        )}

        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">暂无待处理会话</div>
        ) : (
          <div className="space-y-3">
            {items.map((item, index) => (
              <div key={attentionIdentity(item)} data-testid={`session-attention-card-${attentionIdentity(item)}`} role="button" tabIndex={0} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-4 hover:border-primary/40" onClick={() => onNavigateToSession(item.sessionId, { provider: item.provider, projectPath: item.projectPath })} onKeyDown={(event) => { if (event.key === 'Enter') onNavigateToSession(item.sessionId, { provider: item.provider, projectPath: item.projectPath }); }}>
                <input data-testid={`session-attention-select-${attentionIdentity(item)}`} type="checkbox" checked={selectedIds.has(attentionIdentity(item))} className="mt-1 h-4 w-4" onClick={(event) => event.stopPropagation()} onChange={(event) => toggleSelection(index, event.target.checked, (event.nativeEvent as MouseEvent).shiftKey)} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-foreground">{item.title || item.summary}</span><span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">{PROVIDER_LABELS[item.provider]}</span></div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{projectLabel(item.projectPath)} · {item.sessionId}</div>
                </div>
                <button type="button" disabled={isSubmitting} className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50" onClick={(event) => { event.stopPropagation(); void markHandled([item]); }}>处理完成</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
