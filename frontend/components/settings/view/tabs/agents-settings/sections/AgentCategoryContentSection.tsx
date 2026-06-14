import AccountContent from './content/AccountContent';
import type { AgentCategoryContentSectionProps } from '../types';

export default function AgentCategoryContentSection({
  usageEnabled = true,
  selectedAgent,
}: AgentCategoryContentSectionProps) {
  return (
    <div className="flex-1 overflow-y-auto p-3 md:p-4">
      <AccountContent
        agent={selectedAgent}
        usageEnabled={usageEnabled}
      />
    </div>
  );
}
