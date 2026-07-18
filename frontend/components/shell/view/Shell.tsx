/**
 * Interactive shell view.
 * Keeps the terminal lifecycle and connection controls aligned with the current project/session context.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import '@xterm/xterm/css/xterm.css';
import type { Project, ProjectSession } from '../../../types/app';
import { useTheme } from '../../../contexts/ThemeContext';
import { Button } from '../../ui/button';
import { SHELL_RESTART_DELAY_MS } from '../constants/constants';
import { useShellRuntime } from '../hooks/useShellRuntime';
import { getSessionDisplayName } from '../utils/auth';
import ShellConnectionOverlay from './subcomponents/ShellConnectionOverlay';
import ShellEmptyState from './subcomponents/ShellEmptyState';
import ShellHeader from './subcomponents/ShellHeader';
import ShellMinimalView from './subcomponents/ShellMinimalView';
import ShellMobileKeyBar from './subcomponents/ShellMobileKeyBar';
import { PROVIDER_RUNTIME_POLICY } from '../../../utils/providerRuntimePolicy';

type ShellProps = {
  selectedProject?: Project | null;
  selectedSession?: ProjectSession | null;
  provider?: 'codex' | 'pi' | 'claude';
  initialCommand?: string | null;
  isPlainShell?: boolean;
  onProcessComplete?: ((exitCode: number) => void) | null;
  minimal?: boolean;
  autoConnect?: boolean;
  isActive?: boolean;
  headerActions?: ReactNode;
  onTerminalInputReady?: (sendInput: ((data: string) => boolean) | null) => void;
  onTerminalTerminateReady?: (terminate: (() => boolean) | null) => void;
};

/** 按后端警告原因选择用户文案，避免把状态未知误报为正在运行。 */
function getHandoffWarningKey(reason: string): string {
  if (reason === 'external-active-session-not-shared') {
    return 'shell.handoff.activeWarning';
  }
  return 'shell.handoff.unknownWarning';
}

export default function Shell({
  selectedProject = null,
  selectedSession = null,
  provider,
  initialCommand = null,
  isPlainShell = false,
  onProcessComplete = null,
  minimal = false,
  autoConnect = false,
  isActive,
  headerActions,
  onTerminalInputReady,
  onTerminalTerminateReady,
}: ShellProps) {
  const { t } = useTranslation('chat');
  const { isDarkMode } = useTheme();
  const [isRestarting, setIsRestarting] = useState(false);

  // Keep the public API stable for existing callers that still pass `isActive`.
  void isActive;

  const {
    terminalContainerRef,
    isConnected,
    isInitialized,
    isConnecting,
    isVirtualCtrlActive,
    authUrl,
    authUrlVersion,
    handoffBlockedReason,
    canForceHandoff,
    isForceHandoffPending,
    providerRisk,
    setVirtualCtrlActive,
    sendTerminalInput,
    terminateShell,
    connectToShell,
    disconnectFromShell,
    forceCodexHandoff,
    confirmProviderRisk,
    cancelProviderRisk,
    openAuthUrlInBrowser,
    copyAuthUrlToClipboard,
  } = useShellRuntime({
    selectedProject,
    selectedSession,
    provider,
    initialCommand,
    isPlainShell,
    isDarkMode,
    minimal,
    autoConnect,
    isRestarting,
    onProcessComplete,
  });

  const sessionDisplayName = useMemo(() => getSessionDisplayName(selectedSession), [selectedSession]);
  const sessionDisplayNameShort = useMemo(
    () => (sessionDisplayName ? sessionDisplayName.slice(0, 30) : null),
    [sessionDisplayName],
  );
  const sessionDisplayNameLong = useMemo(
    () => (sessionDisplayName ? sessionDisplayName.slice(0, 50) : null),
    [sessionDisplayName],
  );
  const handoffWarningMessage = useMemo(
    () => t(getHandoffWarningKey(handoffBlockedReason)),
    [handoffBlockedReason, t],
  );

  /** 明确确认旧式活动会话可能仍在原终端运行，再发送一次性强制接管请求。 */
  const handleForceCodexHandoff = useCallback(() => {
    if (!window.confirm(t('shell.handoff.forceConfirm'))) {
      return;
    }
    forceCodexHandoff();
  }, [forceCodexHandoff, t]);

  /** 外部 Claude/Pi 状态异常时，显式继续才进入 tmux TUI。 */
  const handleProviderRiskConfirmation = useCallback(() => {
    if (!providerRisk) return;
    confirmProviderRisk();
  }, [confirmProviderRisk, providerRisk]);

  const handoffWarningBanner = handoffBlockedReason ? (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-400/50 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-100" data-testid="unsafe-codex-handoff-warning">
      <span>{handoffWarningMessage}</span>
      {canForceHandoff && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isForceHandoffPending}
          data-testid="force-codex-handoff"
          onClick={handleForceCodexHandoff}
        >
          {isForceHandoffPending ? t('shell.handoff.forcing') : t('shell.handoff.forceAction')}
        </Button>
      )}
    </div>
  ) : null;

  const providerRiskBanner = providerRisk ? (
    <div className="space-y-2 border-b border-amber-400/50 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-100" data-testid="provider-risk-confirmation">
      <div>{providerRisk.provider === 'claude' ? 'Claude Code' : 'Pi'} 状态无法安全确认；默认不会启动终端。失败探测：{providerRisk.failures.join('、') || providerRisk.reason}。OZW 不提供运行时、守护进程或自动修复。</div>
      <div>安装：{PROVIDER_RUNTIME_POLICY[providerRisk.provider].install.command}；认证：{PROVIDER_RUNTIME_POLICY[providerRisk.provider].authentication.command}</div>
      <div className="flex flex-wrap gap-2">
        {PROVIDER_RUNTIME_POLICY[providerRisk.provider].officialDocs.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="underline">官方诊断</a>)}
        <Button type="button" variant="outline" size="sm" data-testid="provider-risk-cancel" onClick={cancelProviderRisk}>取消</Button>
        <Button type="button" variant="outline" size="sm" data-testid="provider-risk-confirm" onClick={handleProviderRiskConfirmation}>继续并自行承担风险</Button>
      </div>
    </div>
  ) : null;

  useEffect(() => {
    /**
     * PURPOSE: Let a parent toolbar insert text into the active PTY without
     * reaching into xterm internals.
     */
    if (!onTerminalInputReady) {
      return undefined;
    }

    onTerminalInputReady(sendTerminalInput);
    return () => onTerminalInputReady(null);
  }, [onTerminalInputReady, sendTerminalInput]);

  useEffect(() => {
    /**
     * PURPOSE: Let parent terminal tab controls explicitly end the persistent
     * tmux session before unmounting this shell view.
     */
    if (!onTerminalTerminateReady) {
      return undefined;
    }

    onTerminalTerminateReady(terminateShell);
    return () => onTerminalTerminateReady(null);
  }, [onTerminalTerminateReady, terminateShell]);

  const handleRestartShell = useCallback(() => {
    setIsRestarting(true);
    window.setTimeout(() => {
      setIsRestarting(false);
    }, SHELL_RESTART_DELAY_MS);
  }, []);

  if (!selectedProject) {
    return (
      <ShellEmptyState
        title={t('shell.selectProject.title')}
        description={t('shell.selectProject.description')}
      />
    );
  }

  if (minimal) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {handoffWarningBanner}
        {providerRiskBanner}
        <div className="min-h-0 flex-1">
          <ShellMinimalView
            terminalContainerRef={terminalContainerRef}
            authUrl={authUrl}
            authUrlVersion={authUrlVersion}
            initialCommand={initialCommand}
            isConnected={isConnected}
            openAuthUrlInBrowser={openAuthUrlInBrowser}
            copyAuthUrlToClipboard={copyAuthUrlToClipboard}
          />
        </div>
      </div>
    );
  }

  const readyDescription = isPlainShell
    ? t('shell.runCommand', {
        command: initialCommand || t('shell.defaultCommand'),
        projectName: selectedProject.displayName,
      })
    : selectedSession
      ? t('shell.resumeSession', { displayName: sessionDisplayNameLong })
      : t('shell.startSession');

  const connectingDescription = isPlainShell
    ? t('shell.runCommand', {
        command: initialCommand || t('shell.defaultCommand'),
        projectName: selectedProject.displayName,
      })
    : t('shell.startCli', { projectName: selectedProject.displayName });

  const overlayMode = !isInitialized ? 'loading' : isConnecting ? 'connecting' : !isConnected ? 'connect' : null;
  const overlayDescription = overlayMode === 'connecting' ? connectingDescription : readyDescription;
  const showDisconnect = isConnected || isConnecting;

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900 w-full">
      <ShellHeader
        isConnected={isConnected}
        isConnecting={isConnecting}
        isInitialized={isInitialized}
        isRestarting={isRestarting}
        hasSession={Boolean(selectedSession)}
        sessionDisplayNameShort={sessionDisplayNameShort}
        showDisconnect={showDisconnect}
        onDisconnect={disconnectFromShell}
        onRestart={handleRestartShell}
        statusNewSessionText={t('shell.status.newSession')}
        statusInitializingText={t('shell.status.initializing')}
        statusRestartingText={t('shell.status.restarting')}
        disconnectLabel={t('shell.actions.disconnect')}
        disconnectTitle={t('shell.actions.disconnectTitle')}
        restartLabel={t('shell.actions.restart')}
        restartTitle={t('shell.actions.restartTitle')}
        disableRestart={isRestarting || isConnected}
        extraActions={headerActions}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white dark:bg-gray-900">
        {!isPlainShell && provider === 'codex' && selectedSession && (
          <div className="sr-only" data-testid="codex-terminal-runtime-mode">remote</div>
        )}
        {handoffWarningBanner}
        {providerRiskBanner}
        <div className="relative min-h-0 flex-1 p-2">
          <div
            ref={terminalContainerRef}
            className="h-full w-full bg-white focus:outline-none dark:bg-gray-900"
            style={{ outline: 'none' }}
          />

          {overlayMode && (
            <ShellConnectionOverlay
              mode={overlayMode}
              description={overlayDescription}
              loadingLabel={t('shell.loading')}
              connectLabel={t('shell.actions.connect')}
              connectTitle={t('shell.actions.connectTitle')}
              connectingLabel={t('shell.connecting')}
              disconnectLabel={t('shell.actions.disconnect')}
              disconnectTitle={t('shell.actions.disconnectTitle')}
              onConnect={connectToShell}
              onDisconnect={disconnectFromShell}
            />
          )}
        </div>

        <ShellMobileKeyBar
          ctrlActive={isVirtualCtrlActive}
          onCtrlActiveChange={setVirtualCtrlActive}
          onInput={sendTerminalInput}
        />
      </div>
    </div>
  );
}
