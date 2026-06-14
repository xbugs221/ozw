/**
 * PURPOSE: Render provider-specific 5h/7d remaining usage next to chat mode controls.
 * This keeps the provider quota chips visible while omitting the old ctx indicator.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../../utils/api';
import type { Provider } from '../../types/types';
import type { SessionProvider } from '../../../../types/app';

type UsageRemainingValue = {
  value: number | null;
  unit: 'percent';
};

type UsageRemainingPayload = {
  provider: SessionProvider;
  status: 'ok' | 'unavailable';
  source: string;
  updatedAt: string | null;
  reason: string | null;
  fiveHourRemaining: UsageRemainingValue;
  sevenDayRemaining: UsageRemainingValue;
};

type UsageRemainingIndicatorProps = {
  provider: Provider | string;
  className?: string;
  enabled?: boolean;
};

const REFRESH_INTERVAL_MS = 60_000;

type RemainingPercentChipProps = {
  label: '5h' | '7d';
  value: number | null;
};

/**
 * Normalize provider value to the usage endpoint supported providers.
 */
function normalizeUsageProvider(provider: Provider | string): SessionProvider | null {
  if (provider === 'codex') {
    return 'codex';
  }

  return null;
}

/**
 * Format a percentage value for compact remaining display.
 */
function formatRemainingPercent(value: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '--';
  }

  return `${Math.round(Math.max(0, Math.min(100, value)))}%`;
}

/**
 * Render one compact statusline-like remaining percent chip.
 */
function RemainingPercentChip({ label, value }: RemainingPercentChipProps) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] leading-none text-muted-foreground">
      <span className="font-medium text-foreground/80">{label}</span>
      <span>{formatRemainingPercent(value)}</span>
    </span>
  );
}

/**
 * Render provider-aware remaining usage text with graceful fallback.
 */
export default function UsageRemainingIndicator({
  provider,
  className = '',
  enabled = true,
}: UsageRemainingIndicatorProps) {
  const normalizedProvider = normalizeUsageProvider(provider);
  const [payload, setPayload] = useState<UsageRemainingPayload | null>(null);

  const fetchUsageRemaining = useCallback(async () => {
    if (!enabled) {
      setPayload(null);
      return;
    }

    if (!normalizedProvider) {
      setPayload(null);
      return;
    }

    try {
      const response = await api.usageRemaining(normalizedProvider);
      if (!response.ok) {
        setPayload(null);
        return;
      }

      const data = (await response.json()) as UsageRemainingPayload;
      setPayload(data);
    } catch (error) {
      console.error('Failed to fetch usage remaining:', error);
      setPayload(null);
    }
  }, [enabled, normalizedProvider]);

  useEffect(() => {
    if (!enabled) {
      setPayload(null);
      return;
    }

    void fetchUsageRemaining();

    if (!normalizedProvider) {
      return;
    }

    const timer = window.setInterval(() => {
      void fetchUsageRemaining();
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [enabled, fetchUsageRemaining, normalizedProvider]);

  const fiveHourValue = useMemo(() => payload?.fiveHourRemaining?.value ?? null, [payload?.fiveHourRemaining?.value]);
  const sevenDayValue = useMemo(() => payload?.sevenDayRemaining?.value ?? null, [payload?.sevenDayRemaining?.value]);

  if (!normalizedProvider) {
    return null;
  }

  return (
    <div
      className={`inline-flex items-center gap-1 flex-wrap ${className}`.trim()}
      title={payload?.source ? `source: ${payload.source}` : undefined}
      aria-label="remaining usage percentage"
    >
      <RemainingPercentChip label="5h" value={fiveHourValue} />
      <RemainingPercentChip label="7d" value={sevenDayValue} />
    </div>
  );
}
