/**
 * PURPOSE: Render the global chat-history search dialog independently of the
 * active chat route so sidebar search works from every app surface.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionProvider } from '../../../types/app';
import { api } from '../../../utils/api';

type ChatSearchResult = {
  resultType?: 'message' | 'session';
  projectName: string;
  projectDisplayName: string;
  provider: SessionProvider;
  sessionId: string;
  routeIndex?: number;
  workflowId?: string;
  workflowRouteIndex?: number;
  workflowStageKey?: string;
  sessionSummary: string;
  messageKey?: string;
  snippet: string;
  thread?: string;
  sessionFileName?: string;
};

type ChatSearchStatus = 'idle' | 'loading' | 'success-empty' | 'success-hit' | 'error';
type ChatSearchMode = 'jsonl' | 'content';

type ChatHistorySearchDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToSession?: (
    targetSessionId: string,
    options?: {
      provider?: SessionProvider;
      projectName?: string;
      routeIndex?: number;
      workflowId?: string;
      workflowRouteIndex?: number;
      workflowStageKey?: string;
      routeSearch?: Record<string, string>;
    },
  ) => void;
};

/**
 * Return the display label for supported chat-history providers.
 */
function getProviderDisplayLabel(provider: SessionProvider): string {
  if (provider === 'codex') return 'Codex';
  if (provider === 'pi') return 'Pi';
  return '';
}

/**
 * Validate the chat-search API contract so malformed server responses surface
 * as actionable errors instead of empty search results.
 */
async function parseChatSearchResponse(response: Response): Promise<ChatSearchResult[]> {
  const contentType = response.headers.get('content-type') || '';
  const isJsonResponse = contentType.toLowerCase().includes('application/json');

  if (!isJsonResponse) {
    throw new Error('Search endpoint returned HTML instead of JSON');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Search endpoint returned invalid JSON');
  }

  const errorMessage = typeof payload === 'object' && payload !== null && 'error' in payload
    && typeof payload.error === 'string' && payload.error
    ? payload.error
    : null;

  if (!response.ok) {
    throw new Error(errorMessage || 'Failed to search chat history');
  }

  if (
    typeof payload !== 'object'
    || payload === null
    || !('results' in payload)
    || !Array.isArray(payload.results)
  ) {
    throw new Error('Search endpoint returned an unexpected payload');
  }

  return payload.results as ChatSearchResult[];
}

export default function ChatHistorySearchDialog({
  isOpen,
  onClose,
  onNavigateToSession,
}: ChatHistorySearchDialogProps) {
  /**
   * PURPOSE: Keep query state and API status inside the dialog while app-level
   * routing stays owned by the shell.
   */
  const { t } = useTranslation('chat');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ChatSearchResult[]>([]);
  const [status, setStatus] = useState<ChatSearchStatus>('idle');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<ChatSearchMode>('jsonl');

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      onClose();
    };

    document.addEventListener('keydown', handleEscape, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleEscape, { capture: true });
    };
  }, [isOpen, onClose]);

  const runSearch = useCallback(async () => {
    /**
     * PURPOSE: Search all persisted chat transcripts and reflect loading,
     * empty, hit, and error states explicitly.
     */
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setResults([]);
      setError('');
      setStatus('idle');
      return;
    }

    setResults([]);
    setError('');
    setStatus('loading');
    try {
      const response = await api.chatSearch(trimmedQuery, mode);
      const nextResults = await parseChatSearchResponse(response);
      setResults(nextResults);
      setStatus(nextResults.length > 0 ? 'success-hit' : 'success-empty');
    } catch (searchError) {
      console.error('Error searching chat history:', searchError);
      setResults([]);
      setError(searchError instanceof Error ? searchError.message : 'Failed to search chat history');
      setStatus('error');
    }
  }, [mode, query]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[110] bg-black/20 backdrop-blur-[1px]">
      <div
        className="absolute inset-0"
        onClick={onClose}
      />
      <div className="relative mx-auto mt-16 w-[min(42rem,calc(100vw-1rem))] rounded-lg border border-border bg-background shadow-xl">
        <form
          className="border-b border-border/50 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void runSearch();
          }}
        >
          <div className="mb-3 flex rounded-md border border-border p-1">
            {[
              { value: 'jsonl' as const, label: 'JSONL 文件名/thread' },
              { value: 'content' as const, label: '文件内容' },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                data-testid={`chat-history-search-mode-${option.value}`}
                className={[
                  'h-8 flex-1 rounded px-2 text-sm',
                  mode === option.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/60',
                ].join(' ')}
                onClick={() => {
                  setMode(option.value);
                  setResults([]);
                  setError('');
                  setStatus(query.trim() ? 'idle' : 'idle');
                  inputRef.current?.focus();
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <input
            ref={inputRef}
            data-testid="chat-history-search-input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={mode === 'jsonl' ? '搜索 JSONL 文件名或 thread' : t('search.placeholder')}
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </form>

        <div
          data-testid="chat-history-search-results"
          className="max-h-[min(60vh,28rem)] overflow-y-auto"
        >
          {status === 'idle' && (
            <div className="px-4 py-4 text-sm text-muted-foreground">
              {t('search.enterPrompt')}
            </div>
          )}

          {status === 'loading' && (
            <div
              data-testid="chat-history-search-loading"
              className="px-4 py-4 text-sm text-muted-foreground"
            >
              {t('search.searching')}
            </div>
          )}

          {status === 'success-empty' && (
            <div
              data-testid="chat-history-search-empty"
              className="px-4 py-4 text-sm text-muted-foreground"
            >
              {mode === 'jsonl' ? '没有匹配的 JSONL 文件名或 thread。' : t('search.noMatches')}
            </div>
          )}

          {status === 'error' && (
            <div
              data-testid="chat-history-search-error"
              className="px-4 py-4 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          {status === 'success-hit' && results.map((result) => (
            <button
              key={`${result.sessionId}:${result.messageKey || result.sessionFileName || result.thread || 'session'}`}
              type="button"
              data-testid="chat-history-search-result"
              className="w-full border-b border-border/40 px-4 py-3 text-left transition-colors hover:bg-muted/40 last:border-b-0"
              onClick={() => {
                onClose();
                const routeSearch = result.resultType === 'session' || !result.messageKey
                  ? undefined
                  : {
                      chatSearch: query.trim(),
                      messageKey: result.messageKey,
                    };
                onNavigateToSession?.(result.sessionId, {
                  projectName: result.projectName,
                  provider: result.provider,
                  routeIndex: result.routeIndex,
                  workflowId: result.workflowId,
                  workflowRouteIndex: result.workflowRouteIndex,
                  workflowStageKey: result.workflowStageKey,
                  routeSearch,
                });
              }}
            >
              <div className="text-xs text-muted-foreground">
                {result.projectDisplayName} · {getProviderDisplayLabel(result.provider)}
              </div>
              <div className="text-sm font-medium">{result.sessionSummary}</div>
              {result.resultType === 'session' && result.thread && (
                <div className="font-mono text-xs text-muted-foreground">thread: {result.thread}</div>
              )}
              <div className="text-sm text-muted-foreground">{result.snippet}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
