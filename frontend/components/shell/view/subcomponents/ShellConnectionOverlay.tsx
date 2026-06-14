/**
 * Shell connection overlay.
 * Covers loading, connect, and connecting states, including a cancel path for stuck connections.
 */
type ShellConnectionOverlayProps = {
  mode: 'loading' | 'connect' | 'connecting';
  description: string;
  loadingLabel: string;
  connectLabel: string;
  connectTitle: string;
  connectingLabel: string;
  disconnectLabel: string;
  disconnectTitle: string;
  onConnect: () => void;
  onDisconnect: () => void;
};

export default function ShellConnectionOverlay({
  mode,
  description,
  loadingLabel,
  connectLabel,
  connectTitle,
  connectingLabel,
  disconnectLabel,
  disconnectTitle,
  onConnect,
  onDisconnect,
}: ShellConnectionOverlayProps) {
  if (mode === 'loading') {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-white/90 dark:bg-gray-900/90">
        <div className="text-gray-900 dark:text-white">{loadingLabel}</div>
      </div>
    );
  }

  if (mode === 'connect') {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-white/90 p-4 dark:bg-gray-900/90">
        <div className="text-center max-w-sm w-full">
          <button
            onClick={onConnect}
            className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center space-x-2 text-base font-medium w-full sm:w-auto"
            title={connectTitle}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span>{connectLabel}</span>
          </button>
          <p className="text-gray-600 text-sm mt-3 px-2 dark:text-gray-400">{description}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-white/90 p-4 dark:bg-gray-900/90">
      <div className="text-center max-w-sm w-full">
        <div className="flex items-center justify-center space-x-3 text-yellow-400">
          <div className="w-6 h-6 animate-spin rounded-full border-2 border-yellow-400 border-t-transparent"></div>
          <span className="text-base font-medium">{connectingLabel}</span>
        </div>
        <p className="text-gray-600 text-sm mt-3 px-2 dark:text-gray-400">{description}</p>
        <button
          onClick={onDisconnect}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium"
          title={disconnectTitle}
        >
          {disconnectLabel}
        </button>
      </div>
    </div>
  );
}
