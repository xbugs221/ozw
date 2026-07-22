import type { TFunction } from 'i18next';
import { Link } from 'react-router-dom';
import { IS_PLATFORM } from '../../../../constants/config';

type SidebarHeaderProps = {
  isPWA: boolean;
  isMobile: boolean;
  onCollapseSidebar: () => void;
  t: TFunction;
};

const PanelLeftCloseIcon = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" strokeLinecap="round" strokeLinejoin="round"/><line x1="9" y1="3" x2="9" y2="21" strokeLinecap="round" strokeLinejoin="round"/><path d="m16 15-3-3 3-3" strokeLinecap="round" strokeLinejoin="round"/></svg>;

export default function SidebarHeader({
  isPWA,
  isMobile,
  onCollapseSidebar,
  t,
}: SidebarHeaderProps) {
  const LogoBlock = () => (
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="w-7 h-7 bg-primary/90 rounded-lg flex items-center justify-center shadow-sm flex-shrink-0">
        <svg className="w-3.5 h-3.5 text-primary-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 18c2.2-5.4 5.4-8.2 9.6-8.2 1.6 0 3 .3 4.4 1" />
          <path d="M7 8.5 9.2 6.3" />
          <path d="m7 6.3 2.2 2.2" />
          <path d="m18.8 14.3 2.2 2.2" />
          <path d="m18.8 16.5 2.2-2.2" />
          <circle cx="6" cy="17.5" r="1.6" />
          <circle cx="13.5" cy="9" r="1.8" />
          <circle cx="19" cy="17" r="1.7" />
        </svg>
      </div>
      <h1 className="text-sm font-semibold text-foreground tracking-tight truncate">{t('app.title')}</h1>
    </div>
  );

  const HomeLink = ({ mobile = false }: { mobile?: boolean }) => {
    const className = `flex items-center gap-2.5 min-w-0 transition-opacity ${mobile ? 'active:opacity-70' : 'hover:opacity-80'}`;

    if (IS_PLATFORM) {
      return (
        <a
          href="https://ozw.ai/dashboard"
          className={className}
          title={t('tooltips.viewEnvironments')}
        >
          <LogoBlock />
        </a>
      );
    }

    return (
      <Link
        to="/"
        className={className}
        onClick={mobile ? onCollapseSidebar : undefined}
        title={t('app.title')}
      >
        <LogoBlock />
      </Link>
    );
  };

  const CollapseButton = () => (
    <button
      type="button"
      data-testid="collapse-sidebar"
      className="h-8 w-8 flex-shrink-0 rounded-lg text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground active:scale-[0.98]"
      onClick={onCollapseSidebar}
      aria-label={t('tooltips.hideSidebar')}
      title={t('tooltips.hideSidebar')}
    >
      <span className="flex h-full w-full items-center justify-center">
        <PanelLeftCloseIcon />
      </span>
    </button>
  );

  return (
    <div className="flex-shrink-0">
      {/* Desktop header */}
      <div
        className="hidden md:block px-3 pt-3 pb-2"
        style={{}}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <HomeLink />
          </div>

          <CollapseButton />
        </div>
      </div>

      {/* Desktop divider */}
      <div className="hidden md:block nav-divider" />

      {/* Mobile header */}
      <div
        className="md:hidden p-3 pb-2"
        style={isPWA && isMobile ? { paddingTop: '16px' } : {}}
      >
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <HomeLink mobile />
          </div>

          <CollapseButton />
        </div>
      </div>

      {/* Mobile divider */}
      <div className="md:hidden nav-divider" />
    </div>
  );
}
