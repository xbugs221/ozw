/**
 * PiLogo: Pi provider brand indicator
 *
 * Visually identical to the Pi span in SessionProviderLogo but extracted as
 * a standalone default-exported React component for reuse across the app.
 */
export default function PiLogo({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <span
      className={`${className} inline-flex items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-[0.65em] font-semibold`}
      aria-label="Pi provider"
    >
      Pi
    </span>
  );
}
