import React from 'react';
const Check = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>;
const ChevronDown = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>;
import { useTranslation } from 'react-i18next';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import type { ProjectSession, SessionProvider } from '../../../../types/app';

interface ProviderSelectionEmptyStateProps {
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: SessionProvider;
  setProvider: (next: SessionProvider) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  codexModel: string;
  setCodexModel: (model: string) => void;
  codexModelOptions: Array<{ value: string; label: string }>;
  codexReasoningEffort: string;
  setCodexReasoningEffort: (effort: string) => void;
  codexReasoningOptions: Array<{ value: string; label: string; description?: string }>;
  setInput: React.Dispatch<React.SetStateAction<string>>;
}

type ProviderDef = {
  id: SessionProvider;
  name: string;
  infoKey: string;
  accent: string;
  ring: string;
  check: string;
};

const PROVIDERS: ProviderDef[] = [
  {
    id: 'codex',
    name: 'Codex',
    infoKey: 'providerSelection.providerInfo.openai',
    accent: 'border-emerald-600 dark:border-emerald-400',
    ring: 'ring-emerald-600/15',
    check: 'bg-emerald-600 dark:bg-emerald-500 text-white',
  },
  {
    id: 'pi',
    name: 'Pi',
    infoKey: 'providerSelection.providerInfo.pi',
    accent: 'border-violet-600 dark:border-violet-400',
    ring: 'ring-violet-600/15',
    check: 'bg-violet-600 dark:bg-violet-500 text-white',
  },
];

function getModelOptions(
  provider: SessionProvider,
  codexModelOptions: Array<{ value: string; label: string }>,
) {
  if (provider === 'codex') {
    return codexModelOptions;
  }

  return codexModelOptions;
}

function getModelValue(p: SessionProvider, co: string) {
  if (p === 'codex') return co;
  return co;
}

export default function ProviderSelectionEmptyState({
  selectedSession,
  currentSessionId,
  provider,
  setProvider,
  textareaRef,
  codexModel,
  setCodexModel,
  codexModelOptions,
  codexReasoningEffort,
  setCodexReasoningEffort,
  codexReasoningOptions,
  setInput,
}: ProviderSelectionEmptyStateProps) {
  const { t } = useTranslation('chat');

  const selectProvider = (next: SessionProvider) => {
    setProvider(next);
    localStorage.setItem('selected-provider', next);
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const handleModelChange = (value: string) => {
    if (provider === 'codex') { setCodexModel(value); localStorage.setItem('codex-model', value); }
  };

  const handleReasoningChange = (value: string) => {
    if (provider !== 'codex') {
      return;
    }

    setCodexReasoningEffort(value);
    localStorage.setItem('codex-reasoning-effort', value);
  };

  const modelOptions = getModelOptions(provider, codexModelOptions);
  const currentModel = getModelValue(provider, codexModel);

  /* ── New session — provider picker ── */
  if (!selectedSession && !currentSessionId) {
    return (
      <div className="flex items-center justify-center h-full px-4">
        <div className="w-full max-w-md">
          {/* Heading */}
          <div className="text-center mb-8">
            <h2 className="text-lg sm:text-xl font-semibold text-foreground tracking-tight">
              {t('providerSelection.title')}
            </h2>
            <p className="text-[13px] text-muted-foreground mt-1">
              {t('providerSelection.description')}
            </p>
          </div>

          {/* Provider cards — horizontal row, equal width */}
          <div className="grid grid-cols-2 gap-2 sm:gap-2.5 mb-6">
            {PROVIDERS.map((p) => {
              const active = provider === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => selectProvider(p.id)}
                  className={`
                    relative flex flex-col items-center gap-2.5 pt-5 pb-4 px-2
                    rounded-xl border-[1.5px] transition-all duration-150
                    active:scale-[0.97]
                    ${active
                      ? `${p.accent} ${p.ring} ring-2 bg-card shadow-sm`
                      : 'border-border bg-card/60 hover:bg-card hover:border-border/80'
                    }
                  `}
                >
                  <SessionProviderLogo
                    provider={p.id}
                    className={`w-9 h-9 transition-transform duration-150 ${active ? 'scale-110' : ''}`}
                  />
                  <div className="text-center">
                    <p className="text-[13px] font-semibold text-foreground leading-none">{p.name}</p>
                    <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{t(p.infoKey)}</p>
                  </div>
                  {/* Check badge */}
                  {active && (
                    <div className={`absolute -top-1 -right-1 w-[18px] h-[18px] rounded-full ${p.check} flex items-center justify-center shadow-sm`}>
                      <Check className="w-2.5 h-2.5" strokeWidth={3} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Model picker — appears after provider is chosen */}
          <div className={`transition-all duration-200 ${provider ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1 pointer-events-none'}`}>
            <div className="flex items-center justify-center gap-2 mb-5">
              <span className="text-sm text-muted-foreground">{t('providerSelection.selectModel')}</span>
              <div className="relative">
                <select
                  value={currentModel}
                  onChange={(e) => handleModelChange(e.target.value)}
                  tabIndex={-1}
                  className="appearance-none pl-3 pr-7 py-1.5 text-sm font-medium bg-muted/50 border border-border/60 rounded-lg text-foreground cursor-pointer hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {modelOptions.map(({ value, label }: { value: string; label: string }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            {provider === 'codex' && codexReasoningOptions.length > 0 && (
              <div className="flex items-center justify-center gap-2 mb-5">
                <span className="text-sm text-muted-foreground">{t('providerSelection.selectReasoning')}</span>
                <div className="relative">
                  <select
                    value={codexReasoningEffort}
                    onChange={(e) => handleReasoningChange(e.target.value)}
                    tabIndex={-1}
                    className="appearance-none pl-3 pr-7 py-1.5 text-sm font-medium bg-muted/50 border border-border/60 rounded-lg text-foreground cursor-pointer hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    {codexReasoningOptions.map(({ value, label }) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                </div>
              </div>
            )}

            <p className="text-center text-sm text-muted-foreground/70">
              {provider === 'pi'
                  ? t('providerSelection.readyPrompt.pi')
                  : t('providerSelection.readyPrompt.codex', {
                    model: codexModel,
                    effort: codexReasoningEffort,
                  })}
            </p>
          </div>

          {/* Task banner */}
        </div>
      </div>
    );
  }

  /* ── Existing session — continue prompt ── */
  if (selectedSession) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="chat-empty-session-state">
        <div className="text-center px-6 max-w-md">
          <p className="text-lg font-semibold text-foreground mb-1.5">{t('session.continue.title')}</p>
          <p className="text-sm text-muted-foreground leading-relaxed">{t('session.continue.description')}</p>
        </div>
      </div>
    );
  }

  return null;
}
