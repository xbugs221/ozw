import { useEffect, useRef } from 'react';

type CommandMenuCommand = {
  name: string;
  description?: string;
  namespace?: string;
  path?: string;
  type?: string;
  metadata?: { type?: string; [key: string]: unknown };
  [key: string]: unknown;
};

type CommandMenuProps = {
  commands?: CommandMenuCommand[];
  selectedIndex?: number;
  onSelect?: (command: CommandMenuCommand, index: number, isHover: boolean) => void;
  onClose: () => void;
  isOpen?: boolean;
  frequentCommands?: CommandMenuCommand[];
};

const namespaceLabels: Record<string, string> = {
  builtin: 'Built-in Commands',
  alias: 'Quick Aliases',
  other: 'Other Commands',
};

const namespaceIcons: Record<string, string> = {
  builtin: '[B]',
  alias: '//',
  other: '[O]',
};
const ALIAS_TRIGGER_PREFIX = '//';

const getCommandKey = (command: CommandMenuCommand) =>
  `${command.name}::${command.namespace || command.type || 'other'}::${command.path || ''}`;

const getNamespace = (command: CommandMenuCommand) => command.namespace || command.type || 'other';
const getDisplayedCommandName = (commandName: string) =>
  commandName.startsWith('/') ? `${ALIAS_TRIGGER_PREFIX}${commandName.slice(1)}` : commandName;

export default function CommandMenu({
  commands = [],
  selectedIndex = -1,
  onSelect,
  onClose,
  isOpen = false,
  frequentCommands = [],
}: CommandMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selectedItemRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (!menuRef.current || !(event.target instanceof Node)) {
        return;
      }
      if (!menuRef.current.contains(event.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!selectedItemRef.current || !menuRef.current) {
      return;
    }
    const menuRect = menuRef.current.getBoundingClientRect();
    const itemRect = selectedItemRef.current.getBoundingClientRect();
    if (itemRect.bottom > menuRect.bottom || itemRect.top < menuRect.top) {
      selectedItemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  if (!isOpen) {
    return null;
  }

  const groupedCommands = commands.reduce<Record<string, CommandMenuCommand[]>>((groups, command) => {
    const namespace = getNamespace(command);
    if (!groups[namespace]) {
      groups[namespace] = [];
    }
    groups[namespace].push(command);
    return groups;
  }, {});

  const preferredOrder = ['alias', 'other'];
  const extraNamespaces = Object.keys(groupedCommands).filter((namespace) => !preferredOrder.includes(namespace));
  const orderedNamespaces = [...preferredOrder, ...extraNamespaces].filter((namespace) => groupedCommands[namespace]);

  const commandIndexByKey = new Map<string, number>();
  commands.forEach((command, index) => {
    const key = getCommandKey(command);
    if (!commandIndexByKey.has(key)) {
      commandIndexByKey.set(key, index);
    }
  });

  if (commands.length === 0) {
    return (
      <div
        ref={menuRef}
        className="command-menu absolute bottom-full left-0 right-0 z-50 mb-2 rounded-xl border border-border/50 bg-card/95 p-5 text-center text-muted-foreground shadow-lg backdrop-blur-md"
      >
        No quick aliases available
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      role="listbox"
      aria-label="Available quick aliases"
      className="command-menu absolute bottom-full left-0 right-0 z-50 mb-2 max-h-48 overflow-y-auto rounded-xl border border-border/50 bg-card/95 p-2 shadow-lg backdrop-blur-md"
    >
      {orderedNamespaces.map((namespace) => (
        <div key={namespace} className="command-group">
          {orderedNamespaces.length > 1 && (
            <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {namespaceLabels[namespace] || namespace}
            </div>
          )}

          {(groupedCommands[namespace] || []).map((command) => {
            const commandKey = getCommandKey(command);
            const commandIndex = commandIndexByKey.get(commandKey) ?? -1;
            const isSelected = commandIndex === selectedIndex;
            return (
              <div
                key={`${namespace}-${command.name}-${command.path || ''}`}
                ref={isSelected ? selectedItemRef : null}
                role="option"
                aria-selected={isSelected}
                className={`command-item mb-0.5 flex cursor-pointer items-start rounded-md px-3 py-2.5 transition-colors ${
                  isSelected ? 'bg-blue-50 dark:bg-blue-900' : 'bg-transparent'
                }`}
                onMouseEnter={() => onSelect && commandIndex >= 0 && onSelect(command, commandIndex, true)}
                onClick={() => onSelect && commandIndex >= 0 && onSelect(command, commandIndex, false)}
                onMouseDown={(event) => event.preventDefault()}
              >
                <div className="min-w-0 flex-1">
                  <div className={`flex items-center gap-2 ${command.description ? 'mb-1' : 'mb-0'}`}>
                    <span className="shrink-0 text-xs text-gray-500 dark:text-gray-300">{namespaceIcons[namespace] || namespaceIcons.other}</span>
                    <span className="font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {getDisplayedCommandName(command.name)}
                    </span>
                    {command.metadata?.type && (
                      <span className="command-metadata-badge rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                        {command.metadata.type}
                      </span>
                    )}
                  </div>
                  {command.description && (
                    <div className="ml-6 truncate whitespace-nowrap text-[13px] text-gray-500 dark:text-gray-300">
                      {command.description}
                    </div>
                  )}
                </div>
                {isSelected && <span className="ml-2 text-xs font-semibold text-blue-500 dark:text-blue-300">{'<-'}</span>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
