/**
 * PURPOSE: Surface provider 5h/7d quota summaries inside settings instead of the chat page.
 */
import { useTranslation } from 'react-i18next';
import UsageRemainingIndicator from '../../chat/view/subcomponents/UsageRemainingIndicator';
import type { AgentProvider } from '../types/types';

type UsageProviderRowProps = {
  provider: AgentProvider;
  label: string;
  description: string;
  enabled?: boolean;
};

/**
 * Render one provider row with a stable label and usage chips.
 */
function UsageProviderRow({ provider, label, description, enabled = true }: UsageProviderRowProps) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <UsageRemainingIndicator provider={provider} enabled={enabled} />
    </div>
  );
}

/**
 * Render usage quota for one provider next to that provider's account details.
 */
export function UsageProviderQuota({
  provider,
  enabled = true,
}: {
  provider: AgentProvider;
  enabled?: boolean;
}) {
  const { t } = useTranslation('settings');

  return (
    <UsageProviderRow
      provider={provider}
      label={t(`usage.providers.${provider}`)}
      description={t('usage.providerDescription')}
      enabled={enabled}
    />
  );
}

/**
 * Render a provider-wide usage overview when a full settings summary is needed.
 */
export default function UsageOverviewSection() {
  const { t } = useTranslation('settings');

  return (
    <section className="space-y-3 rounded-xl border border-border/60 bg-background/70 p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{t('usage.title')}</h3>
        <p className="text-xs text-muted-foreground">{t('usage.description')}</p>
      </div>

      <div className="space-y-3">
        <UsageProviderQuota provider="codex" />
      </div>
    </section>
  );
}
