/**
 * Interactive shell view.
 * Keeps the terminal lifecycle and connection controls aligned with the current project/session context.
 */
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '@xterm/xterm/css/xterm.css';
import type { Project, ProjectSession } from '../../../types/app';
import { useTheme } from '../../../contexts/ThemeContext';
import { SHELL_RESTART_DELAY_MS } from '../constants/constants';
import { useShellRuntime } from '../hooks/useShellRuntime';
import { getSessionDisplayName } from '../utils/auth';
import ShellConnectionOverlay from './subcomponents/ShellConnectionOverlay';
import ShellEmptyState from './subcomponents/ShellEmptyState';
import ShellHeader from './subcomponents/ShellHeader';
import ShellMinimalView from './subcomponents/ShellMinimalView';
import ShellMobileKeyBar from './subcomponents/ShellMobileKeyBar';

type ShellProps = {
  selectedProject?: Project | null;
  selectedSession?: ProjectSession | null;
  provider?: 'codex' | 'pi';
  initialCommand?: string | null;
  isPlainShell?: boolean;
  onProcessComplete?: ((exitCode: number) => void) | null;
  minimal?: boolean;
  autoConnect?: boolean;
  isActive?: boolean;
};

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
    setVirtualCtrlActive,
    sendTerminalInput,
    connectToShell,
    disconnectFromShell,
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
      <ShellMinimalView
        terminalContainerRef={terminalContainerRef}
        authUrl={authUrl}
        authUrlVersion={authUrlVersion}
        initialCommand={initialCommand}
        isConnected={isConnected}
        openAuthUrlInBrowser={openAuthUrlInBrowser}
        copyAuthUrlToClipboard={copyAuthUrlToClipboard}
      />
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
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white dark:bg-gray-900">
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
