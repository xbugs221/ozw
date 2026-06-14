import { useTranslation } from 'react-i18next';
import SessionProviderLogo from '../../../../llm-logo-provider/SessionProviderLogo';
import type { AgentProvider } from '../../../types/types';

type AgentListItemProps = {
  agentId: AgentProvider;
  isSelected: boolean;
  onClick: () => void;
  isMobile?: boolean;
};

type AgentConfig = {
  name: string;
  color: 'blue' | 'gray';
};

const agentConfig: Record<AgentProvider, AgentConfig> = {
  codex: {
    name: 'Codex',
    color: 'gray',
  },
  pi: {
    name: 'Pi',
    color: 'blue',
  },
};

const colorClasses = {
  blue: {
    border: 'border-l-blue-500 md:border-l-blue-500',
    borderBottom: 'border-b-blue-500',
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    dot: 'bg-blue-500',
  },
  gray: {
    border: 'border-l-gray-700 dark:border-l-gray-300',
    borderBottom: 'border-b-gray-700 dark:border-b-gray-300',
    bg: 'bg-gray-100 dark:bg-gray-800/50',
    dot: 'bg-gray-700 dark:bg-gray-300',
  },
} as const;

export default function AgentListItem({
  agentId,
  isSelected,
  onClick,
  isMobile = false,
}: AgentListItemProps) {
  const { t } = useTranslation('settings');
  const config = agentConfig[agentId];
  const colors = colorClasses[config.color];

  if (isMobile) {
    return (
      <button
        onClick={onClick}
        className={`flex-1 text-center py-3 px-2 border-b-2 transition-colors ${isSelected
          ? `${colors.borderBottom} ${colors.bg}`
          : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
      >
        <div className="flex flex-col items-center gap-1">
          <SessionProviderLogo provider={agentId} className="w-5 h-5" />
          <span className="text-xs font-medium text-foreground">{config.name}</span>
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 border-l-4 transition-colors ${isSelected
        ? `${colors.border} ${colors.bg}`
        : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-800'
        }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <SessionProviderLogo provider={agentId} className="w-4 h-4" />
        <span className="font-medium text-foreground">{config.name}</span>
      </div>
      <div className="text-xs text-muted-foreground pl-6">
        {t('agents.runtime.shortStatus')}
      </div>
    </button>
  );
}
