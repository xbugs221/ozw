/**
 * 文件目的：展示跨项目 Provider 会话的有界待处理看板。
 * 业务意义：打开会话不会自动确认，只有用户显式处理才移除卡片。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionProvider } from '../../types/app';
import { api } from '../../utils/api';
import SessionProviderLogo from '../llm-logo-provider/SessionProviderLogo';

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

export default function SessionAttentionBoard({ onNavigateToSession }: SessionAttentionBoardProps) {
  /** 业务目的：单次读取最多 100 条，空闲时不轮询后端。 */
  const [items, setItems] = useState<AttentionItem[]>([]);
  const [submittingIds, setSubmittingIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
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

  const markHandled = async (targets: AttentionItem[]) => {
    /** 发送卡片渲染时观察到的版本，不使用请求时的最新值。 */
    if (targets.length === 0 || submittingIds.size > 0) return;
    setSubmittingIds(new Set(targets.map(attentionIdentity)));
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
      setSubmittingIds(new Set());
    }
  };

  if (isLoading) {
    return <div data-testid="session-attention-board" className="flex h-full items-center justify-center text-sm text-muted-foreground">正在读取待处理会话…</div>;
  }

  return (
    <section data-testid="session-attention-board" className="h-full overflow-y-auto px-3 py-5 sm:px-5">
      <div className="w-full">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">待处理会话</h1>
            <p className="mt-1 text-sm text-muted-foreground">打开会话不会自动标记完成</p>
          </div>
          {items.length > 0 && (
            <button type="button" disabled={submittingIds.size > 0} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50" onClick={() => void markHandled(items)}>全部处理完成</button>
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
            {items.map((item) => (
              <div key={attentionIdentity(item)} data-testid={`session-attention-card-${attentionIdentity(item)}`} role="button" tabIndex={0} className="cursor-pointer rounded-xl border border-border bg-card px-4 py-3.5 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onNavigateToSession(item.sessionId, { provider: item.provider, projectPath: item.projectPath })} onKeyDown={(event) => { if (event.key === 'Enter') onNavigateToSession(item.sessionId, { provider: item.provider, projectPath: item.projectPath }); }}>
                <div className="line-clamp-2 w-full break-words text-base font-medium leading-6 text-foreground">
                  {item.title || item.summary}
                </div>
                <div className="mt-3 flex min-w-0 items-center gap-2.5 border-t border-border/60 pt-3">
                  <input data-testid={`session-attention-select-${attentionIdentity(item)}`} aria-label="处理完成" title="处理完成" type="checkbox" checked={submittingIds.has(attentionIdentity(item))} disabled={submittingIds.size > 0} className="h-5 w-5 shrink-0 accent-primary disabled:opacity-60" onClick={(event) => event.stopPropagation()} onChange={(event) => { if (event.target.checked) void markHandled([item]); }} />
                  <span className="shrink-0 text-muted-foreground" title={item.provider}>
                    <SessionProviderLogo provider={item.provider} className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{projectLabel(item.projectPath)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
