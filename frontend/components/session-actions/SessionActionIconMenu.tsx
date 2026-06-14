/**
 * PURPOSE: Share the five icon-and-text session actions used by sidebar rows and
 * project overview cards so both surfaces expose the same behavior.
 */
import { forwardRef, type CSSProperties } from 'react';
const Clock = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>;
const Edit2 = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>;
const EyeOff = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>;
const Star = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26 12,2"/></svg>;
const Trash2 = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>;
import { cn } from '../../lib/utils';

export type SessionActionIconMenuProps = {
  className?: string;
  style?: CSSProperties;
  isFavorite?: boolean;
  isPending?: boolean;
  isHidden?: boolean;
  labels: {
    rename: string;
    favorite: string;
    unfavorite: string;
    pending: string;
    unpending: string;
    hide: string;
    unhide: string;
    delete: string;
  };
  testIds?: {
    rename?: string;
    favorite?: string;
    pending?: string;
    hide?: string;
    delete?: string;
  };
  onRename: () => void;
  onToggleFavorite: () => void;
  onTogglePending: () => void;
  onToggleHidden: () => void;
  onDelete: () => void;
};

function getButtonLabel(label: string): string {
  /**
   * Keep the accessible name, tooltip, and visible menu text in sync.
   */
  return label;
}

const SessionActionIconMenu = forwardRef<HTMLDivElement, SessionActionIconMenuProps>(function SessionActionIconMenu({
  className,
  style,
  isFavorite = false,
  isPending = false,
  isHidden = false,
  labels,
  testIds,
  onRename,
  onToggleFavorite,
  onTogglePending,
  onToggleHidden,
  onDelete,
}, ref) {
  const favoriteLabel = getButtonLabel(isFavorite ? labels.unfavorite : labels.favorite);
  const pendingLabel = getButtonLabel(isPending ? labels.unpending : labels.pending);
  const hiddenLabel = getButtonLabel(isHidden ? labels.unhide : labels.hide);

  return (
    <div
      ref={ref}
      className={cn('fixed z-[80] flex w-fit flex-col gap-1 rounded-md border border-border bg-popover p-1 shadow-lg', className)}
      style={style}
    >
      <button
        type="button"
        className="flex h-9 w-full items-center gap-2 rounded-sm px-2 text-sm hover:bg-accent"
        onClick={onRename}
        title={labels.rename}
        aria-label={labels.rename}
        data-testid={testIds?.rename}
      >
        <Edit2 className="h-4 w-4 shrink-0" />
        <span>{labels.rename}</span>
      </button>
      <button
        type="button"
        className="flex h-9 w-full items-center gap-2 rounded-sm px-2 text-sm hover:bg-accent"
        onClick={onToggleFavorite}
        title={favoriteLabel}
        aria-label={favoriteLabel}
        data-testid={testIds?.favorite}
      >
        <Star
          className={cn(
            'h-4 w-4 shrink-0',
            isFavorite
              ? 'fill-current text-yellow-500 dark:text-yellow-400'
              : 'text-yellow-600/70 dark:text-yellow-500/70',
          )}
        />
        <span>{favoriteLabel}</span>
      </button>
      <button
        type="button"
        className="flex h-9 w-full items-center gap-2 rounded-sm px-2 text-sm hover:bg-accent"
        onClick={onTogglePending}
        title={pendingLabel}
        aria-label={pendingLabel}
        data-testid={testIds?.pending}
      >
        <Clock
          className={cn(
            'h-4 w-4 shrink-0',
            isPending ? 'text-amber-600 dark:text-amber-300' : 'text-muted-foreground',
          )}
        />
        <span>{pendingLabel}</span>
      </button>
      <button
        type="button"
        className="flex h-9 w-full items-center gap-2 rounded-sm px-2 text-sm hover:bg-accent"
        onClick={onToggleHidden}
        title={hiddenLabel}
        aria-label={hiddenLabel}
        data-testid={testIds?.hide}
      >
        <EyeOff
          className={cn(
            'h-4 w-4 shrink-0',
            isHidden ? 'text-muted-foreground' : '',
          )}
        />
        <span>{hiddenLabel}</span>
      </button>
      <button
        type="button"
        className="flex h-9 w-full items-center gap-2 rounded-sm px-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
        onClick={onDelete}
        title={labels.delete}
        aria-label={labels.delete}
        data-testid={testIds?.delete}
      >
        <Trash2 className="h-4 w-4 shrink-0" />
        <span>{labels.delete}</span>
      </button>
    </div>
  );
});

export default SessionActionIconMenu;
