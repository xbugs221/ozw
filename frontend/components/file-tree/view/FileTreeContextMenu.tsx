/**
 * PURPOSE: Render a lightweight scoped context menu for file-tree nodes and
 * blank-space actions without introducing a wider UI dependency.
 */
import { useEffect, useRef } from 'react';
import { Button } from '../../ui/button';
import type { FileTreeContextMenuAction } from '../types/types';

type FileTreeContextMenuProps = {
  actions: FileTreeContextMenuAction[];
  position: { x: number; y: number };
  onClose: () => void;
};

export default function FileTreeContextMenu({
  actions,
  position,
  onClose,
}: FileTreeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  /**
   * Close the floating menu on outside clicks, Escape, or any scroll that invalidates placement.
   */
  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }
      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-40 rounded border border-border bg-background p-1 shadow-lg"
      style={{ left: position.x, top: position.y }}
      role="menu"
    >
      {actions.map((action) => (
        <Button
          key={action.key}
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-full justify-start rounded px-2 text-sm"
          onClick={() => {
            action.onSelect();
            onClose();
          }}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}
