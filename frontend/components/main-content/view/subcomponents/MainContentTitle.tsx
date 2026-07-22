/**
 * PURPOSE: Render the main content header title for project and chat views.
 * The session provider icon is intentionally omitted here because it drifts
 * from the real provider state during session creation and first message send.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppTab, Project, ProjectSession, ProjectWorkflow } from '../../../../types/app';
import { api } from '../../../../utils/api';
import { copyTextToClipboard } from '../../../../utils/clipboard';
import { getProviderCapabilities, normalizeSessionProvider } from '../../../../utils/providerCapabilities';

const Check = ({ className: cls }: { className?: string }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>;
const Edit3 = ({ className: cls }: { className?: string }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>;

function pickSessionDisplayText(value: unknown): string {
  /**
   * PURPOSE: Prevent non-text payloads from leaking into React children and
   * causing "Objects are not valid as a React child".
   */
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return '';
}

function getFirstSessionDisplayText(fallback: string, ...candidates: unknown[]): string {
  const match = candidates
    .map((candidate) => pickSessionDisplayText(candidate).trim())
    .find((text) => text.length > 0);

  return match || fallback;
}

type MainContentTitleProps = {
  activeTab: AppTab;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  selectedWorkflow?: ProjectWorkflow | null;
  onRefresh?: () => Promise<void> | void;
};

function getTabTitle(activeTab: AppTab, t: (key: string) => string) {
  if (activeTab === 'overview') {
    return t('tabs.overview');
  }

  if (activeTab === 'files') {
    return t('mainContent.projectFiles');
  }

  return 'Project';
}

function getSessionTitle(session: ProjectSession): string {
  if (session.__provider === 'codex') {
    return getFirstSessionDisplayText(
      'Codex Session',
      session.routeTitle,
      session.title,
      session.summary,
      session.name,
    );
  }

  return getFirstSessionDisplayText(
    'New Session',
    session.routeTitle,
    session.title,
    session.summary,
    session.name,
  );
}

function isTemporaryOrRouteSessionId(sessionId: string): boolean {
  /**
   * Reject ozw-only session identifiers that cannot be passed to provider resume commands.
   */
  return /^(c\d+|new-session-)/.test(sessionId);
}

function hasProviderResumeIdentity(session: ProjectSession): boolean {
  /**
   * Only provider-backed sessions should render a resume identifier in the title.
   */
  return session.__provider === 'codex'
    || session.provider === 'codex';
}

function getSessionResumeId(session: ProjectSession | null): string {
  /**
   * Return the provider resume id without provider CLI prefixes or flags.
   */
  if (!session) {
    return '';
  }

  const providerSessionId = typeof session.providerSessionId === 'string' ? session.providerSessionId.trim() : '';
  if (providerSessionId) {
    return providerSessionId;
  }

  const directSessionId = typeof session.id === 'string' ? session.id.trim() : '';
  if (!directSessionId || isTemporaryOrRouteSessionId(directSessionId) || !hasProviderResumeIdentity(session)) {
    return '';
  }

  return directSessionId;
}

export default function MainContentTitle({
  activeTab,
  selectedProject,
  selectedSession,
  selectedWorkflow,
  onRefresh,
}: MainContentTitleProps) {
  const { t } = useTranslation();
  const showMessagePlaceholder = activeTab === 'chat' && !selectedSession && !selectedWorkflow;
  const resumeId = getSessionResumeId(selectedSession);
  const sessionTitle = selectedSession ? getSessionTitle(selectedSession) : '';
  const routeProvider = typeof window === 'undefined'
    ? null
    : normalizeSessionProvider(new URLSearchParams(window.location.search).get('provider'));
  const effectiveSessionProvider = routeProvider || selectedSession?.__provider || selectedSession?.provider;
  const canRenameSession = Boolean(getProviderCapabilities(effectiveSessionProvider)?.renameSession);
  const [sessionIdCopied, setSessionIdCopied] = useState(false);
  const [overrideSessionTitle, setOverrideSessionTitle] = useState('');
  const [isRenamingSession, setIsRenamingSession] = useState(false);
  const resetCopyFeedbackTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setOverrideSessionTitle('');
  }, [selectedSession?.id, sessionTitle]);

  useEffect(() => {
    return () => {
      if (resetCopyFeedbackTimerRef.current !== null) {
        window.clearTimeout(resetCopyFeedbackTimerRef.current);
      }
    };
  }, []);

  const copySessionResumeId = async () => {
    /**
     * Copy the provider resume id so users can paste it into support notes or
     * provider resume commands without keeping the id as a permanent header row.
     */
    const copied = await copyTextToClipboard(resumeId);
    if (!copied) {
      return;
    }

    setSessionIdCopied(true);
    if (resetCopyFeedbackTimerRef.current !== null) {
      window.clearTimeout(resetCopyFeedbackTimerRef.current);
    }
    resetCopyFeedbackTimerRef.current = window.setTimeout(() => {
      setSessionIdCopied(false);
      resetCopyFeedbackTimerRef.current = null;
    }, 1400);
  };

  const renameCurrentSession = async () => {
    /**
     * Rename the currently open provider session without leaving the chat view.
     */
    if (!selectedProject || !selectedSession || isRenamingSession || !canRenameSession) {
      return;
    }

    const currentTitle = (overrideSessionTitle || sessionTitle).trim();
    const nextTitle = window.prompt('请输入新的会话名称', currentTitle);
    if (nextTitle == null) {
      return;
    }

    const trimmedTitle = nextTitle.trim();
    if (!trimmedTitle || trimmedTitle === currentTitle) {
      return;
    }

    setIsRenamingSession(true);
    try {
      const projectPath = selectedSession.projectPath || selectedProject.fullPath || selectedProject.path || '';
      const response = await api.renameCodexSession(selectedSession.id, trimmedTitle, projectPath);
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || `Failed to rename session: ${response.status}`);
      }

      setOverrideSessionTitle(trimmedTitle);
      await onRefresh?.();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '会话改名失败，请重试。');
    } finally {
      setIsRenamingSession(false);
    }
  };

  return (
    <div className="min-w-0 flex items-center gap-2 flex-1 overflow-x-auto scrollbar-hide" data-testid="main-content-title">
      <div className="min-w-0 flex-1">
        {activeTab === 'chat' && selectedSession ? (
          <>
            <div className="flex min-w-0 items-center gap-1.5">
              <h2 className="min-w-0 text-sm font-semibold text-foreground whitespace-nowrap overflow-x-auto scrollbar-hide leading-tight">
                {overrideSessionTitle || sessionTitle}
              </h2>
              {selectedProject && canRenameSession && (
                <button
                  type="button"
                  className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent/70 hover:text-foreground disabled:opacity-40"
                  onClick={() => void renameCurrentSession()}
                  disabled={isRenamingSession}
                  aria-label="重命名当前会话"
                  title="重命名当前会话"
                  data-testid="session-rename-button"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {selectedProject && (
              <div className="mt-1 flex min-w-0 items-center gap-2 text-xs leading-tight text-muted-foreground">
                <span className="min-w-0 overflow-x-auto whitespace-nowrap scrollbar-hide">
                  {selectedProject.displayName || selectedProject.name}
                </span>
                {resumeId && (
                  <button
                    type="button"
                    className="inline-flex h-5 min-w-[5.25rem] flex-shrink-0 items-center justify-center rounded px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground hover:bg-accent/70 hover:text-foreground"
                    onClick={() => void copySessionResumeId()}
                    aria-label={sessionIdCopied ? '已复制会话编号' : '复制会话编号'}
                    title="复制会话编号"
                  >
                    {sessionIdCopied ? <Check className="h-3.5 w-3.5" /> : '复制会话编号'}
                  </button>
                )}
              </div>
            )}
          </>
        ) : activeTab === 'chat' && selectedWorkflow ? (
          <div className="text-sm font-semibold text-foreground whitespace-nowrap overflow-x-auto scrollbar-hide leading-tight">
            {selectedWorkflow.title || t('tabs.chat')}
          </div>
        ) : showMessagePlaceholder ? (
          <h2 className="text-base font-semibold text-foreground leading-tight">{t('tabs.chat')}</h2>
        ) : (
          <h2 className="text-sm font-semibold text-foreground leading-tight">
            {getTabTitle(activeTab, t)}
          </h2>
        )}
      </div>
    </div>
  );
}
