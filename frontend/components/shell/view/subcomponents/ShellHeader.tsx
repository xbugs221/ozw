/**
 * Shell header.
 * Shows connection status and provides explicit controls for disconnect/restart actions.
 */
import type { ReactNode } from 'react';

type ShellHeaderProps = {
  isConnected: boolean;
  isConnecting: boolean;
  isInitialized: boolean;
  isRestarting: boolean;
  hasSession: boolean;
  sessionDisplayNameShort: string | null;
  showDisconnect: boolean;
  onDisconnect: () => void;
  onRestart: () => void;
  statusNewSessionText: string;
  statusInitializingText: string;
  statusRestartingText: string;
  disconnectLabel: string;
  disconnectTitle: string;
  restartLabel: string;
  restartTitle: string;
  disableRestart: boolean;
  extraActions?: ReactNode;
};

export default function ShellHeader({
  isConnected,
  isConnecting,
  isInitialized,
  isRestarting,
  hasSession,
  sessionDisplayNameShort,
  showDisconnect,
  onDisconnect,
  onRestart,
  statusNewSessionText,
  statusInitializingText,
  statusRestartingText,
  disconnectLabel,
  disconnectTitle,
  restartLabel,
  restartTitle,
  disableRestart,
  extraActions,
}: ShellHeaderProps) {
  return (
    <div className="flex-shrink-0 border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center space-x-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : isConnecting ? 'bg-yellow-400' : 'bg-red-500'}`} />

          {hasSession && sessionDisplayNameShort && (
            <span className="truncate text-xs text-blue-700 dark:text-blue-300">({sessionDisplayNameShort}...)</span>
          )}

          {!hasSession && <span className="text-xs text-gray-600 dark:text-gray-400">{statusNewSessionText}</span>}

          {!isInitialized && <span className="text-xs text-yellow-600 dark:text-yellow-400">{statusInitializingText}</span>}

          {isRestarting && <span className="text-xs text-blue-600 dark:text-blue-400">{statusRestartingText}</span>}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2">
          {extraActions}

          {showDisconnect && (
            <button
              onClick={onDisconnect}
              className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 flex items-center space-x-1"
              title={disconnectTitle}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              <span>{disconnectLabel}</span>
            </button>
          )}

          <button
            onClick={onRestart}
            disabled={disableRestart}
            className="text-xs text-gray-500 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50 flex items-center space-x-1 dark:text-gray-400 dark:hover:text-white"
            title={restartTitle}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <span>{restartLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
