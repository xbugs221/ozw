/**
 * PURPOSE: Render responsive current-session message bookmarks and dispatch
 * messageKey-based navigation requests back to the chat container.
 */
import { useState } from 'react';
import type { ConversationBookmark } from '../../utils/conversationBookmarks';

interface ConversationBookmarksProps {
  bookmarks: ConversationBookmark[];
  onBookmarkSelect: (messageKey: string) => void;
}

/**
 * Render one bookmark button with user preview and assistant excerpt.
 */
function BookmarkItem({
  bookmark,
  onBookmarkSelect,
}: {
  bookmark: ConversationBookmark;
  onBookmarkSelect: (messageKey: string) => void;
}) {
  return (
    <button
      type="button"
      data-testid="chat-message-bookmark-item"
      onClick={() => onBookmarkSelect(bookmark.userMessageKey)}
      className="w-full rounded-md border border-border/70 bg-background px-3 py-2 text-left text-xs transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <span className="block truncate font-medium text-foreground">
        {bookmark.userPreview || '用户消息'}
      </span>
      <span
        data-testid="chat-message-bookmark-summary"
        className={bookmark.assistantStatus === 'pending'
          ? 'mt-1 block truncate text-muted-foreground'
          : 'mt-1 block truncate text-muted-foreground'}
      >
        {bookmark.assistantSummary}
      </span>
    </button>
  );
}

/**
 * Render desktop and mobile bookmark entry points from the same bookmark data.
 */
export default function ConversationBookmarks({
  bookmarks,
  onBookmarkSelect,
}: ConversationBookmarksProps) {
  const [isDesktopPanelOpen, setIsDesktopPanelOpen] = useState(false);
  const [isMobilePanelOpen, setIsMobilePanelOpen] = useState(false);

  if (bookmarks.length === 0) {
    return null;
  }

  const items = (
    <div className="space-y-2">
      {bookmarks.map((bookmark) => (
        <BookmarkItem
          key={bookmark.id}
          bookmark={bookmark}
          onBookmarkSelect={(messageKey) => {
            onBookmarkSelect(messageKey);
            setIsDesktopPanelOpen(false);
            setIsMobilePanelOpen(false);
          }}
        />
      ))}
    </div>
  );

  return (
    <div data-testid="chat-message-bookmarks" className="shrink-0">
      <div className="hidden md:flex h-full border-r border-border bg-muted/10">
        {isDesktopPanelOpen ? (
          <aside
            data-testid="chat-bookmark-desktop-list"
            className="h-full w-56 p-3"
            aria-label="当前会话消息书签"
          >
            <div className="mb-2 flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
              <span>消息书签</span>
              <button
                type="button"
                data-testid="chat-bookmark-desktop-trigger"
                onClick={() => setIsDesktopPanelOpen(false)}
                className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="隐藏消息书签"
                aria-expanded={isDesktopPanelOpen}
              >
                隐藏
              </button>
            </div>
            <div className="max-h-full overflow-y-auto pr-1">{items}</div>
          </aside>
        ) : (
          <button
            type="button"
            data-testid="chat-bookmark-desktop-trigger"
            onClick={() => setIsDesktopPanelOpen(true)}
            className="h-full w-10 px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="显示消息书签"
            aria-expanded={isDesktopPanelOpen}
          >
            书签
          </button>
        )}
      </div>

      <button
        type="button"
        data-testid="chat-bookmark-mobile-trigger"
        onClick={() => setIsMobilePanelOpen((current) => !current)}
        className="md:hidden fixed right-4 bottom-24 z-30 rounded-full border border-border bg-background px-3 py-2 text-xs font-medium shadow-lg"
        aria-expanded={isMobilePanelOpen}
        aria-controls="chat-bookmark-mobile-panel"
      >
        书签
      </button>

      {isMobilePanelOpen && (
        <div
          id="chat-bookmark-mobile-panel"
          data-testid="chat-bookmark-mobile-panel"
          className="md:hidden fixed inset-x-3 bottom-36 z-30 max-h-[52vh] overflow-y-auto rounded-lg border border-border bg-background p-3 shadow-xl"
        >
          <div className="mb-2 text-xs font-medium text-muted-foreground">消息书签</div>
          {items}
        </div>
      )}
    </div>
  );
}
