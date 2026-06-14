const X = ({ className: cls }: { className?: string }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
import StandaloneShell from '../standalone-shell/view/StandaloneShell';
import { IS_PLATFORM } from '../../constants/config';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  provider?: string;
  project?: unknown;
  onComplete: (exitCode?: number) => void;
  customCommand?: string;
  isAuthenticated?: boolean;
  isOnboarding?: boolean;
}

function LoginModal({
  isOpen,
  onClose,
  provider = 'codex',
  project,
  onComplete,
  customCommand,
  isAuthenticated = false,
  isOnboarding = false
}: LoginModalProps) {
  if (!isOpen) return null;

  const getCommand = () => {
    if (customCommand) return customCommand;

    switch (provider) {
      case 'codex':
        return IS_PLATFORM ? 'codex login --device-auth' : 'codex login';
      default:
        return IS_PLATFORM ? 'codex login --device-auth' : 'codex login';
    }
  };

  const getTitle = () => {
    switch (provider) {
      case 'codex':
        return 'Codex CLI Login';
      default:
        return 'CLI Login';
    }
  };

  const handleComplete = (exitCode?: number) => {
    if (onComplete) {
      onComplete(exitCode);
    }
    // Keep modal open so users can read login output and close explicitly.
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] max-md:items-stretch max-md:justify-stretch">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl h-3/4 flex flex-col md:max-w-4xl md:h-3/4 md:rounded-lg md:m-4 max-md:max-w-none max-md:h-full max-md:rounded-none max-md:m-0">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {getTitle()}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="Close login modal"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <StandaloneShell
            project={project as any}
            command={getCommand()}
            onComplete={handleComplete}
            minimal={true}
          />
        </div>
      </div>
    </div>
  );
}

export default LoginModal;
