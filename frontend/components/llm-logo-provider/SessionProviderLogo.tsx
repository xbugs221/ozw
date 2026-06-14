import type { SessionProvider } from '../../types/app';
import ChatGptLogo from './ChatGptLogo';
import KimiLogo from './KimiLogo';

type SessionProviderLogoProps = {
  provider?: SessionProvider | string | null;
  model?: string | null;
  className?: string;
};

export default function SessionProviderLogo({
  provider = 'codex',
  model = null,
  className = 'w-5 h-5',
}: SessionProviderLogoProps) {
  if (provider === 'codex') {
    return <ChatGptLogo className={className} />;
  }

  if (provider === 'pi') {
    return (
      <span
        className={`${className} inline-flex items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-[0.65em] font-semibold`}
        aria-label="Pi provider"
      >
        Pi
      </span>
    );
  }

  const modelLabel = (model || '').toLowerCase();
  if (modelLabel.includes('kimi')) {
    return <KimiLogo className={className} />;
  }

  return (
    <span
      className={`${className} inline-flex items-center justify-center rounded-full bg-muted text-[0.65em] font-semibold text-muted-foreground`}
      aria-label="Unknown provider"
    >
      AI
    </span>
  );
}
