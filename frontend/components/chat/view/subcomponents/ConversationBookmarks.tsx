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

interface IconProps {
  className?: string;
}

/**
 * Render the compact bookmark entry icon used by the floating controls.
 */
function BookmarkIcon({ className }: IconProps) {
  return (
    <svg
      className={className || 'h-4 w-4'}
      stroke="currentColor"
      strokeWidth="2"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
    </svg>
  );
}

/**
 * Render the compact close icon for bookmark panels.
 */
function XIcon({ className }: IconProps) {
  return (
    <svg
      className={className || 'h-4 w-4'}
      stroke="currentColor"
      strokeWidth="2"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
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
 * Render the current-session bookmark entry beside the workspace tab buttons.
 */
export default function ConversationBookmarks({
  bookmarks,
  onBookmarkSelect,
}: ConversationBookmarksProps) {
  const [isPanelOpen, setIsPanelOpen] = useState(false);

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
            setIsPanelOpen(false);
          }}
        />
      ))}
    </div>
  );

  return (
    <div
      data-testid="chat-message-bookmarks"
      className="relative"
    >
      <button
        type="button"
        data-testid="chat-bookmark-trigger"
        onClick={() => setIsPanelOpen((current) => !current)}
        className={`relative flex h-9 w-9 flex-none touch-manipulation items-center justify-center rounded-md p-0 transition-all duration-150 ${
          isPanelOpen
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        }`}
        aria-label={isPanelOpen ? '隐藏消息书签' : '显示消息书签'}
        aria-expanded={isPanelOpen}
        aria-controls="chat-bookmark-panel"
        title={isPanelOpen ? '隐藏消息书签' : '显示消息书签'}
      >
        <BookmarkIcon className="h-4 w-4" />
      </button>

      {isPanelOpen && (
        <div
          id="chat-bookmark-panel"
          data-testid="chat-bookmark-panel"
          className="absolute right-0 top-11 z-50 max-h-[min(60vh,28rem)] w-[min(18rem,calc(100vw-1rem))] overflow-y-auto rounded-md border border-border bg-background/95 p-3 shadow-xl backdrop-blur"
          aria-label="当前会话消息书签"
        >
          <div className="mb-2 flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
            <span>消息书签</span>
            <button
              type="button"
              data-testid="chat-bookmark-close"
              onClick={() => setIsPanelOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="隐藏消息书签"
              title="隐藏消息书签"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
          {items}
        </div>
      )}

    </div>
  );
}
