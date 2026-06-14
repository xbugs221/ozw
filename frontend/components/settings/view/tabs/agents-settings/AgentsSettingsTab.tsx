// PURPOSE: Render provider-specific agent account and connection settings.
import { useState } from 'react';
import type { AgentProvider } from '../../../types/types';
import AgentCategoryContentSection from './sections/AgentCategoryContentSection';
import AgentSelectorSection from './sections/AgentSelectorSection';
import type { AgentsSettingsTabProps } from './types';

/**
 * Keep agent/provider category navigation isolated from each provider detail panel.
 */
export default function AgentsSettingsTab({
  usageEnabled = true,
}: AgentsSettingsTabProps) {
  const [selectedAgent, setSelectedAgent] = useState<AgentProvider>('codex');

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row h-full min-h-[400px] md:min-h-[500px]">
        <AgentSelectorSection
          selectedAgent={selectedAgent}
          onSelectAgent={setSelectedAgent}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          <AgentCategoryContentSection
            usageEnabled={usageEnabled}
            selectedAgent={selectedAgent}
          />
        </div>
      </div>
    </div>
  );
}
