import type {
  AgentProvider,
} from '../../../types/types';

export type AgentsSettingsTabProps = {
  usageEnabled?: boolean;
};

export type AgentSelectorSectionProps = {
  selectedAgent: AgentProvider;
  onSelectAgent: (agent: AgentProvider) => void;
};

export type AgentCategoryContentSectionProps = {
  usageEnabled?: boolean;
  selectedAgent: AgentProvider;
};
