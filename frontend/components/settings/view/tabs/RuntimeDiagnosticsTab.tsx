// PURPOSE: Show external workflow CLI diagnostics resolved by the server process.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../../utils/api';

type RuntimeCommandDiagnostics = {
  name: string;
  available?: boolean;
  authenticated?: boolean | 'unknown' | null;
  command_path?: string;
  commandPath?: string;
  path: string;
  home?: string;
  version?: string | { ok: boolean; output: string; error?: string };
  contract?: { ok: boolean; missing?: string[]; capabilities?: string[]; version?: string; error?: string };
  requiredAction?: string;
  error?: string;
};

type RuntimeDiagnostics = {
  ok?: boolean;
  ready?: boolean;
  commands: Record<string, RuntimeCommandDiagnostics>;
  path: string;
};

type CodexSharedRuntimeDiagnostics = {
  mode?: string;
  ready?: boolean;
  endpoint?: string;
  activeTurnCount?: number;
  reason?: string | null;
  daemonError?: string | null;
  network?: { networkMode?: string; drift?: boolean; restartAction?: string };
};

function StatusPill({ ok }: { ok: boolean }) {
  /**
   * Render a compact status indicator for one runtime diagnostic row.
   */
  const { t } = useTranslation('settings');
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${ok ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'}`}>
      {ok ? t('diagnostics.status.success') : t('diagnostics.status.failed')}
    </span>
  );
}

function RuntimeCommandRow({ command }: { command: RuntimeCommandDiagnostics }) {
  /**
   * Render path, version, and runner contract details for one external CLI.
   */
  const { t } = useTranslation('settings');
  const commandPath = command.commandPath || command.command_path || command.path || '';
  const versionText = typeof command.version === 'string'
    ? command.version || command.error || 'unknown'
    : command.version?.output || command.version?.error || 'unknown';
  const commandOk = command.available ?? (Boolean(commandPath) && (typeof command.version === 'string' || command.version?.ok !== false) && command.contract?.ok !== false);
  const contractText = command.contract
    ? command.contract.ok
      ? `${t('diagnostics.fields.contract')}: ${command.contract.capabilities?.join(', ') || t('diagnostics.status.success')}`
      : `${t('diagnostics.fields.contractMissing')}: ${command.contract.missing?.join(', ') || command.contract.error || t('diagnostics.unknown')}`
    : '';
  return (
    <div className="border border-border rounded-md p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-foreground">{command.name}</div>
        <StatusPill ok={commandOk} />
      </div>
      <div className="text-sm text-muted-foreground break-all">{t('diagnostics.fields.commandPath')}: {commandPath || t('diagnostics.notFound')}</div>
      {command.home && <div className="text-sm text-muted-foreground break-all">{t('diagnostics.fields.home')}: {command.home}</div>}
      <div className="text-sm text-muted-foreground break-all">{t('diagnostics.fields.version')}: {versionText}</div>
      {contractText && <div className="text-sm text-muted-foreground break-all">{contractText}</div>}
      {command.requiredAction && <div className="text-sm text-muted-foreground break-all">{command.requiredAction}</div>}
      {command.error && <div className="text-sm text-destructive break-all">{command.error}</div>}
    </div>
  );
}

export default function RuntimeDiagnosticsTab() {
  /**
   * Fetch server-side runtime dependency diagnostics when the diagnostics tab is
   * opened so operators can verify oz flow resolution without path overrides.
   */
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostics | null>(null);
  const [codexRuntime, setCodexRuntime] = useState<CodexSharedRuntimeDiagnostics | null>(null);
  const [error, setError] = useState('');
  const { t } = useTranslation('settings');

  useEffect(() => {
    let cancelled = false;
    api.diagnostics.runtimeDependencies()
      .then(async (response) => {
        const payload = await response.json();
        if (!cancelled) {
          setDiagnostics(payload);
          setError(response.ok ? '' : payload?.error || t('diagnostics.loadError'));
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : t('diagnostics.loadError'));
        }
      });
    api.diagnostics.codexSharedRuntime()
      .then(async (response) => {
        const payload = await response.json();
        if (!cancelled && response.ok) setCodexRuntime(payload);
      })
      .catch(() => {
        /** oz 诊断仍可独立展示，共享 Codex 诊断失败不覆盖主错误。 */
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-foreground">{t('diagnostics.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('diagnostics.description')}</p>
      </div>
      {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      {diagnostics && (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <span className="text-sm font-medium text-foreground">{t('diagnostics.fields.overall')}</span>
            <StatusPill ok={diagnostics.ready ?? Boolean(diagnostics.ok)} />
          </div>
          {Object.values(diagnostics.commands || {}).map((command) => (
            <RuntimeCommandRow key={command.name} command={command} />
          ))}
          <div className="rounded-md border border-border p-3">
            <div className="text-sm font-medium text-foreground">{t('diagnostics.fields.path')}</div>
            <div className="mt-2 max-h-24 overflow-auto text-xs text-muted-foreground break-all">{diagnostics.path || t('diagnostics.empty')}</div>
          </div>
        </div>
      )}
      {codexRuntime && (
        <div className="space-y-2 rounded-md border border-border p-3" data-testid="codex-runtime-mode">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-foreground">{t('diagnostics.codexShared.title')}</span>
            <StatusPill ok={Boolean(codexRuntime.ready)} />
          </div>
          <div className="text-sm text-muted-foreground">
            {t('diagnostics.codexShared.mode')}: {codexRuntime.mode || t('diagnostics.unknown')}
          </div>
          <div className="break-all text-xs text-muted-foreground">
            {codexRuntime.daemonError || codexRuntime.endpoint || codexRuntime.reason || t('diagnostics.notFound')}
          </div>
          <div className="text-sm text-muted-foreground">
            {t('diagnostics.codexShared.network')}: {codexRuntime.network?.networkMode || t('diagnostics.unknown')}
          </div>
          {codexRuntime.mode === 'shared-daemon'
            && codexRuntime.network?.drift === true
            && codexRuntime.network?.restartAction === 'confirm-after-turn' && (
            <div className="rounded border border-amber-400/50 bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="codex-proxy-restart-warning">
              {t('diagnostics.codexShared.activeTurnWarning', { count: codexRuntime.activeTurnCount })}
            </div>
          )}
        </div>
      )}
      {!diagnostics && !error && <div className="text-sm text-muted-foreground">{t('diagnostics.loading')}</div>}
    </div>
  );
}
