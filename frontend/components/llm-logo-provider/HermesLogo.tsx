/**
 * 文件目的：提供 Hermes 的可复用信使之翼矢量标志。
 * 业务意义：用 Hermes 的神话意象替代字母占位图标。
 */
type HermesLogoProps = {
  className?: string;
};

export default function HermesLogo({ className = 'w-5 h-5' }: HermesLogoProps) {
  /** 对称羽翼与中央信使杖在小尺寸下仍保持清晰。 */
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="Hermes"
      role="img"
    >
      <path d="M12 4v16M8.5 7.25C6.4 5.2 4.35 5.1 2.75 5.45c1.1 2.65 2.9 4.15 5.45 4.45M15.5 7.25c2.1-2.05 4.15-2.15 5.75-1.8-1.1 2.65-2.9 4.15-5.45 4.45" strokeWidth="1.8" />
      <path d="M9.15 10.8c0 1.4 1.2 2.05 2.85 2.65 1.65.6 2.85 1.25 2.85 2.65 0 1.15-1.05 2.1-2.85 2.1s-2.85-.95-2.85-2.1c0-.9.62-1.48 1.55-1.95M14.85 10.8c0-1.15-1.05-2.1-2.85-2.1s-2.85.95-2.85 2.1" strokeWidth="1.8" />
      <circle cx="12" cy="3.25" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}
