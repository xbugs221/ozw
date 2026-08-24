/**
 * PURPOSE: Render project-scoped, incremental chat-history search from every
 * app surface without tying the dialog to the active chat route.
 */
import Fuse from 'fuse.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Project, SessionProvider } from '../../../types/app';
import { api } from '../../../utils/api';

type ChatSearchResult = {
  resultType?: 'message' | 'session';
  projectName: string;
  projectDisplayName: string;
  projectPath?: string;
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

type HighlightSegment = {
  matched: boolean;
  text: string;
};

type ChatSearchStatus = 'idle' | 'loading' | 'success-empty' | 'success-hit' | 'error';
type ChatSearchMode = 'jsonl' | 'content';

type ChatHistorySearchDialogProps = {
  isOpen: boolean;
  projects: Project[];
  selectedProject?: Project | null;
  onClose: () => void;
  onNavigateToSession?: (
    targetSessionId: string,
    options?: {
      provider?: SessionProvider;
      projectName?: string;
      projectPath?: string;
      routeIndex?: number;
      workflowId?: string;
      workflowRouteIndex?: number;
      workflowStageKey?: string;
      routeSearch?: Record<string, string>;
    },
  ) => void;
};

const SEARCH_DELAY_MS = 200;
const SEARCH_RESULT_LIMIT = 50;
const MIN_QUERY_LENGTH = 2;
const ALL_PROJECTS_SCOPE = '';

/** Return the stable project path used as the search scope identity. */
function getProjectPath(project: Project | null | undefined): string {
  return String(project?.fullPath || project?.path || '');
}

/** Return the display label for supported chat-history providers. */
function getProviderDisplayLabel(provider: SessionProvider): string {
  if (provider === 'codex') return 'Codex';
  if (provider === 'pi') return 'Pi';
  return '';
}

/** Split a result preview into plain and matched segments for readable context highlighting. */
function splitHighlightedText(text: string, query: string): HighlightSegment[] {
  const needle = query.trim();
  if (!needle) return [{ matched: false, text }];
  const normalizedText = text.toLocaleLowerCase();
  const normalizedNeedle = needle.toLocaleLowerCase();
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const matchIndex = normalizedText.indexOf(normalizedNeedle, cursor);
    if (matchIndex < 0) {
      segments.push({ matched: false, text: text.slice(cursor) });
      break;
    }
    if (matchIndex > cursor) {
      segments.push({ matched: false, text: text.slice(cursor, matchIndex) });
    }
    segments.push({ matched: true, text: text.slice(matchIndex, matchIndex + needle.length) });
    cursor = matchIndex + needle.length;
  }
  return segments.length > 0 ? segments : [{ matched: false, text }];
}

/** Return the most useful persisted identifier for distinguishing similar session results. */
function getResultIdentity(result: ChatSearchResult): string {
  return String(result.sessionFileName || result.thread || result.sessionId || '').trim();
}

/** Validate the chat-search response before rendering its result rows. */
async function parseChatSearchResponse(response: Response): Promise<ChatSearchResult[]> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
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
  if (!response.ok) throw new Error(errorMessage || 'Failed to search chat history');
  if (typeof payload !== 'object' || payload === null || !('results' in payload) || !Array.isArray(payload.results)) {
    throw new Error('Search endpoint returned an unexpected payload');
  }
  return payload.results as ChatSearchResult[];
}

export default function ChatHistorySearchDialog({
  isOpen,
  projects,
  selectedProject,
  onClose,
  onNavigateToSession,
}: ChatHistorySearchDialogProps) {
  /** Keep search state local while app-level routing stays owned by the shell. */
  const { t } = useTranslation('chat');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);
  const activeRequestKeyRef = useRef('');
  const selectedProjectPath = getProjectPath(selectedProject);
  const selectedProjectLabel = String(selectedProject?.displayName || selectedProject?.name || '');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ChatSearchResult[]>([]);
  const [status, setStatus] = useState<ChatSearchStatus>('idle');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<ChatSearchMode>('jsonl');
  const [scopePath, setScopePath] = useState(selectedProjectPath);
  const [scopeFilter, setScopeFilter] = useState(selectedProjectLabel);
  const [isScopeOpen, setIsScopeOpen] = useState(false);

  const scopedProject = useMemo(
    () => projects.find((project) => getProjectPath(project) === scopePath) || null,
    [projects, scopePath],
  );
  const projectFuse = useMemo(() => new Fuse(projects, {
    keys: ['displayName', 'name', 'fullPath', 'path'],
    threshold: 0.38,
    ignoreLocation: true,
  }), [projects]);
  const visibleProjects = useMemo(() => {
    const trimmedFilter = scopeFilter.trim();
    if (!trimmedFilter || trimmedFilter === scopedProject?.displayName || trimmedFilter === scopedProject?.name) return projects;
    return projectFuse.search(trimmedFilter, { limit: 12 }).map(({ item }) => item);
  }, [projectFuse, projects, scopeFilter, scopedProject?.displayName, scopedProject?.name]);
  const scopeLabel = scopePath === ALL_PROJECTS_SCOPE
    ? t('search.allProjects')
    : String(scopedProject?.displayName || scopedProject?.name || scopeFilter);

  const cancelPendingSearch = useCallback(() => {
    /** Cancel queued and active work and invalidate any response already resolving. */
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    activeRequestKeyRef.current = '';
    requestSequenceRef.current += 1;
  }, []);

  const runSearch = useCallback(async () => {
    /** Run the current scoped search immediately without allowing duplicate requests. */
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < MIN_QUERY_LENGTH) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = null;
    const projectName = scopedProject?.name || '';
    const requestKey = JSON.stringify([trimmedQuery, mode, scopePath, projectName]);
    if (activeRequestKeyRef.current === requestKey && abortRef.current) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    activeRequestKeyRef.current = requestKey;
    const requestSequence = ++requestSequenceRef.current;
    setResults([]);
    setError('');
    setStatus('loading');

    try {
      const response = await api.chatSearch(trimmedQuery, {
        mode,
        projectPath: scopePath || undefined,
        projectName: projectName || undefined,
        limit: SEARCH_RESULT_LIMIT,
        signal: controller.signal,
      });
      const nextResults = await parseChatSearchResponse(response);
      if (requestSequence !== requestSequenceRef.current) return;
      setResults(nextResults.slice(0, SEARCH_RESULT_LIMIT));
      setStatus(nextResults.length > 0 ? 'success-hit' : 'success-empty');
    } catch (searchError) {
      if (controller.signal.aborted || requestSequence !== requestSequenceRef.current) return;
      console.error('Error searching chat history:', searchError);
      setResults([]);
      setError(searchError instanceof Error ? searchError.message : t('search.failed'));
      setStatus('error');
    } finally {
      if (requestSequence === requestSequenceRef.current) {
        abortRef.current = null;
        activeRequestKeyRef.current = '';
      }
    }
  }, [mode, query, scopePath, scopedProject?.name, t]);

  useEffect(() => {
    if (!isOpen) {
      cancelPendingSearch();
      setResults([]);
      setError('');
      setStatus('idle');
      return;
    }
    setScopePath(selectedProjectPath);
    setScopeFilter(selectedProjectLabel || t('search.allProjects'));
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [cancelPendingSearch, isOpen, selectedProjectLabel, selectedProjectPath, t]);

  useEffect(() => {
    cancelPendingSearch();
    if (!isOpen || query.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      setError('');
      setStatus('idle');
      return;
    }
    setResults([]);
    setError('');
    setStatus('idle');
    debounceRef.current = setTimeout(() => void runSearch(), SEARCH_DELAY_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = null;
    };
  }, [cancelPendingSearch, isOpen, mode, query, runSearch, scopePath]);

  useEffect(() => () => cancelPendingSearch(), [cancelPendingSearch]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancelPendingSearch();
      onClose();
    };
    document.addEventListener('keydown', handleEscape, { capture: true });
    return () => document.removeEventListener('keydown', handleEscape, { capture: true });
  }, [cancelPendingSearch, isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] bg-black/20 backdrop-blur-[1px]">
      <div className="absolute inset-0" onClick={() => { cancelPendingSearch(); onClose(); }} />
      <div className="relative mx-auto mt-16 w-[min(42rem,calc(100vw-1rem))] rounded-lg border border-border bg-background shadow-xl">
        <form className="border-b border-border/50 p-3" onSubmit={(event) => { event.preventDefault(); void runSearch(); }}>
          <div className="mb-3 flex gap-2">
            <div className="flex flex-1 rounded-md border border-border p-1">
              {([
                { value: 'jsonl' as const, label: 'JSONL 文件名/thread' },
                { value: 'content' as const, label: '文件内容' },
              ]).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  data-testid={`chat-history-search-mode-${option.value}`}
                  className={`h-8 flex-1 rounded px-2 text-sm ${mode === option.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/60'}`}
                  onClick={() => { setMode(option.value); inputRef.current?.focus(); }}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div
              className="relative w-[min(15rem,42%)]"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setScopeFilter(scopeLabel);
                  setIsScopeOpen(false);
                }
              }}
            >
              <input
                data-testid="chat-history-search-project-filter"
                role="combobox"
                aria-expanded={isScopeOpen}
                aria-label={t('search.projectScope')}
                value={scopeFilter}
                onFocus={(event) => { event.currentTarget.select(); setIsScopeOpen(true); }}
                onChange={(event) => { setScopeFilter(event.target.value); setIsScopeOpen(true); }}
                placeholder={t('search.filterProjects')}
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              {isScopeOpen ? (
                <div className="absolute right-0 top-11 z-10 max-h-64 w-[min(24rem,80vw)] overflow-y-auto rounded-md border border-border bg-background p-1 shadow-lg">
                  <button
                    type="button"
                    data-testid="chat-history-search-project-all"
                    className={`w-full rounded px-2 py-2 text-left text-sm hover:bg-muted/60 ${scopePath === ALL_PROJECTS_SCOPE ? 'bg-muted' : ''}`}
                    onClick={() => { setScopePath(ALL_PROJECTS_SCOPE); setScopeFilter(t('search.allProjects')); setIsScopeOpen(false); inputRef.current?.focus(); }}
                  >
                    {t('search.allProjects')}
                  </button>
                  {visibleProjects.map((project) => {
                    const projectPath = getProjectPath(project);
                    return (
                      <button
                        key={projectPath || project.name}
                        type="button"
                        data-testid="chat-history-search-project-option"
                        className={`w-full rounded px-2 py-2 text-left hover:bg-muted/60 ${scopePath === projectPath ? 'bg-muted' : ''}`}
                        onClick={() => { setScopePath(projectPath); setScopeFilter(project.displayName || project.name); setIsScopeOpen(false); inputRef.current?.focus(); }}
                      >
                        <span className="block truncate text-sm">{project.displayName || project.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{projectPath}</span>
                      </button>
                    );
                  })}
                  {visibleProjects.length === 0 ? <div className="px-2 py-2 text-sm text-muted-foreground">{t('search.noProjects')}</div> : null}
                </div>
              ) : null}
            </div>
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

        <div data-testid="chat-history-search-results" className="max-h-[min(60vh,28rem)] overflow-y-auto">
          {status === 'idle' ? <div className="px-4 py-4 text-sm text-muted-foreground">{t('search.enterPrompt', { count: MIN_QUERY_LENGTH })}</div> : null}
          {status === 'loading' ? <div data-testid="chat-history-search-loading" className="px-4 py-4 text-sm text-muted-foreground">{t('search.searching')}</div> : null}
          {status === 'success-empty' ? <div data-testid="chat-history-search-empty" className="px-4 py-4 text-sm text-muted-foreground">{mode === 'jsonl' ? t('search.noJsonlMatches') : t('search.noMatches')}</div> : null}
          {status === 'error' ? <div data-testid="chat-history-search-error" className="px-4 py-4 text-sm text-destructive">{error}</div> : null}
          {status === 'success-hit' ? results.map((result) => {
            const resultIdentity = getResultIdentity(result);
            const highlightedSnippet = splitHighlightedText(result.snippet, query);
            return (
            <button
              key={`${result.sessionId}:${result.messageKey || result.sessionFileName || result.thread || 'session'}`}
              type="button"
              data-testid="chat-history-search-result"
              className="group w-full border-b border-border/50 px-4 py-3.5 text-left transition-colors hover:bg-muted/35 last:border-b-0"
              onClick={() => {
                cancelPendingSearch();
                onClose();
                const routeSearch = result.resultType === 'session' || !result.messageKey ? undefined : { chatSearch: query.trim(), messageKey: result.messageKey };
                onNavigateToSession?.(result.sessionId, {
                  projectName: result.projectName,
                  projectPath: result.projectPath,
                  provider: result.provider,
                  routeIndex: result.routeIndex,
                  workflowId: result.workflowId,
                  workflowRouteIndex: result.workflowRouteIndex,
                  workflowStageKey: result.workflowStageKey,
                  routeSearch,
                });
              }}
            >
              <div className="flex min-w-0 items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="shrink-0">{result.projectDisplayName} · {getProviderDisplayLabel(result.provider)}</span>
                {resultIdentity ? (
                  <span className="truncate font-mono" title={resultIdentity}>{resultIdentity}</span>
                ) : null}
              </div>
              <div className="mt-1 truncate text-sm font-semibold text-foreground">{result.sessionSummary}</div>
              <div className="mt-2 rounded-md border border-border/60 border-l-2 border-l-primary/60 bg-muted/25 px-3 py-2.5 text-sm leading-6 text-foreground/85 transition-colors group-hover:bg-background/70">
                {highlightedSnippet.map((segment, segmentIndex) => (
                  segment.matched ? (
                    <mark
                      key={`${segmentIndex}:${segment.text}`}
                      data-testid="chat-history-search-highlight"
                      className="rounded-sm bg-yellow-200 px-0.5 font-semibold text-yellow-950 dark:bg-yellow-400/30 dark:text-yellow-100"
                    >
                      {segment.text}
                    </mark>
                  ) : <span key={`${segmentIndex}:${segment.text}`}>{segment.text}</span>
                ))}
              </div>
            </button>
            );
          }) : null}
        </div>
      </div>
    </div>
  );
}
