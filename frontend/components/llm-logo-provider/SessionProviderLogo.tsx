/**
 * 文件目的：将会话 Provider 映射为统一尺寸的品牌矢量标志。
 * 业务意义：项目导航和会话卡片共享同一套可识别的 Provider 视觉语言。
 */
import type { SessionProvider } from '../../types/app';
import ChatGptLogo from './ChatGptLogo';
import ClaudeLogo from './ClaudeLogo';
import HermesLogo from './HermesLogo';
import KimiLogo from './KimiLogo';
import PiLogo from './PiLogo';

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
  /** 已知 Provider 返回品牌标志，模型标志仅作为未知 Provider 的后备。 */
  if (provider === 'codex') {
    return <ChatGptLogo className={className} />;
  }

  if (provider === 'claude') {
    return <ClaudeLogo className={className} />;
  }

  if (provider === 'pi') {
    return <PiLogo className={className} />;
  }

  if (provider === 'hermes') {
    return <HermesLogo className={className} />;
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
