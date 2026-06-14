// PURPOSE: Render real account/auth/model diagnostics for one agent provider.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SessionProviderLogo from '../../../../../../llm-logo-provider/SessionProviderLogo';
import { api } from '../../../../../../../utils/api';
import type { AgentProvider } from '../../../../../types/types';

type AccountContentProps = {
  agent: AgentProvider;
  usageEnabled?: boolean;
};

type AgentVisualConfig = {
  name: string;
  bgClass: string;
  borderClass: string;
  textClass: string;
  subtextClass: string;
};

const agentConfig: Record<AgentProvider, AgentVisualConfig> = {
  codex: {
    name: 'Codex',
    bgClass: 'bg-gray-100 dark:bg-gray-800/50',
    borderClass: 'border-gray-300 dark:border-gray-600',
    textClass: 'text-gray-900 dark:text-gray-100',
    subtextClass: 'text-gray-700 dark:text-gray-300',
  },
  pi: {
    name: 'Pi',
    bgClass: 'bg-violet-50 dark:bg-violet-900/20',
    borderClass: 'border-violet-200 dark:border-violet-800',
    textClass: 'text-violet-900 dark:text-violet-100',
    subtextClass: 'text-violet-700 dark:text-violet-300',
  },
};

type AgentStatus = {
  authenticated: boolean;
  defaultModel: string;
  modelSource?: string;
  apiKeySet?: boolean;
  cliAvailable?: boolean;
  defaultProvider?: string;
  providers?: string[];
  email?: string;
  loginMethod?: 'oauth' | 'api_key' | null;
};

type AgentsStatusResponse = {
  codex: AgentStatus;
  pi: AgentStatus;
};

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-green-500' : 'bg-red-400'}`} />
      <span className="text-sm">{label}</span>
    </div>
  );
}

function StatusField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-medium ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

/**
 * Render the selected provider's real-time account auth, API key status, and default model.
 */
export default function AccountContent({
  agent,
  usageEnabled = true,
}: AccountContentProps) {
  const { t } = useTranslation('settings');
  const config = agentConfig[agent];
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.agents.status()
      .then(async (res) => {
        const data: AgentsStatusResponse = await res.json();
        if (!cancelled) {
          setStatus((data as Record<string, AgentStatus>)[agent] || null);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [agent]);

  const providerLabel = (name: string) => {
    const labels: Record<string, string> = { deepseek: 'DeepSeek', 'kimi-coding': 'Kimi' };
    return labels[name] || name;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-4">
        <SessionProviderLogo provider={agent} className="w-6 h-6" />
        <div>
          <h3 className="text-lg font-medium text-foreground">{config.name}</h3>
          <p className="text-sm text-muted-foreground">
            {agent === 'pi'
              ? t('agents.account.pi.description')
              : t('agents.account.codex.description')}
          </p>
        </div>
      </div>

      <div className={`${config.bgClass} border ${config.borderClass} rounded-lg p-4`}>
        <div className="mb-4 rounded border border-border bg-background/60 px-3 py-2">
          <div className="text-sm font-medium text-foreground">
            {t('agents.account.shared.noCliDependencyTitle')}
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {t('agents.account.shared.noCliDependencyDescription')}
          </p>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-block w-3 h-3 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
            {t('diagnostics.loading')}
          </div>
        )}

        {!loading && status && (
          <div className="space-y-4">
            {/* Auth status */}
            <div className="flex items-center justify-between">
              <span className={`text-sm font-medium ${config.textClass}`}>
                {t('agents.status.authentication')}
              </span>
              <StatusDot
                ok={status.authenticated}
                label={status.authenticated ? t('agents.status.authenticated') : t('agents.status.notAuthenticated')}
              />
            </div>

            {/* Codex login / API details */}
            {agent === 'codex' && (
              <div className="border-t border-gray-200 dark:border-gray-700 pt-3 space-y-1">
                {status.email && status.email !== 'API Key Auth' && (
                  <StatusField
                    label={t('agents.status.accountEmail')}
                    value={status.email}
                  />
                )}
                {status.loginMethod && (
                  <StatusField
                    label={t('agents.status.loginMethod')}
                    value={status.loginMethod === 'oauth'
                      ? t('agents.status.loginOAuth')
                      : status.loginMethod === 'api_key'
                        ? t('agents.status.loginApiKey')
                        : t('agents.status.unknown')}
                  />
                )}
                {status.cliAvailable !== undefined && (
                  <StatusField
                    label={t('agents.status.cliAvailable')}
                    value={status.cliAvailable ? t('agents.status.available') : t('agents.status.unavailable')}
                  />
                )}
              </div>
            )}

            {/* Pi providers */}
            {agent === 'pi' && status.providers && status.providers.length > 0 && (
              <div className="border-t border-gray-200 dark:border-gray-700 pt-3 space-y-1">
                <StatusField
                  label={t('agents.status.defaultProvider')}
                  value={providerLabel(status.defaultProvider || '') || status.defaultProvider || '—'}
                />
                <div className="flex items-center justify-between gap-2 py-1">
                  <span className="text-xs text-muted-foreground">{t('agents.status.configuredProviders')}</span>
                  <span className="text-xs font-medium">
                    {status.providers.map(providerLabel).join(', ')}
                  </span>
                </div>
              </div>
            )}

            {/* Default model */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-3 space-y-1">
              <StatusField
                label={t('agents.status.defaultModel')}
                value={status.defaultModel || (agent === 'codex' ? 'gpt-5' : '—')}
                mono
              />
              {agent === 'codex' && status.modelSource && (
                <StatusField
                  label={t('agents.status.modelSource')}
                  value={status.modelSource}
                />
              )}
            </div>
          </div>
        )}

        {!loading && !status && (
          <div className="text-sm text-muted-foreground">{t('agents.status.unavailable')}</div>
        )}
      </div>
    </div>
  );
}
