/**
 * PURPOSE: Coordinate expensive project-list refreshes across browser windows
 * so one visible owner runs the REST read and followers reuse its snapshot.
 */

type WindowRefreshTransport = {
  postMessage: (message: WindowRefreshMessage) => void;
  subscribe: (handler: (message: WindowRefreshMessage) => void) => () => void;
};

type WindowRefreshCoordinatorOptions = {
  windowId?: string;
  transport?: WindowRefreshTransport;
  isVisible?: () => boolean;
  now?: () => number;
  ownerTtlMs?: number;
  heartbeatMs?: number;
  electionDelayMs?: number;
  snapshotWaitMs?: number;
};

type ProjectInvalidation = {
  type?: string;
  scope?: string;
  version?: string;
  reason?: string;
  [key: string]: unknown;
};

type ProjectRefreshDecision = {
  shouldRun: boolean;
  ownerWindowId: string;
  scope: string;
  reason?: string;
};

type WindowRefreshMessage = {
  type: 'owner-claim' | 'projects-snapshot';
  scope: string;
  ownerWindowId?: string;
  windowId?: string;
  expiresAt?: number;
  snapshot?: Record<string, unknown>;
  sourceWindowId?: string;
  [key: string]: unknown;
};

const DEFAULT_SCOPE = 'projects:list';
const STORAGE_KEY = 'ozw-project-refresh-message';

/**
 * Build the default BroadcastChannel transport when the browser supports it.
 */
function createDefaultTransport(): WindowRefreshTransport | null {
  /**
   * PURPOSE: Keep coordinator construction safe in SSR, tests, and older
   * browsers where BroadcastChannel is unavailable.
   */
  if (typeof BroadcastChannel === 'undefined') {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }
    return {
      postMessage(message) {
        const payload = JSON.stringify({ ...message, nonce: Math.random(), storedAt: Date.now() });
        window.localStorage.setItem(STORAGE_KEY, payload);
        window.localStorage.removeItem(STORAGE_KEY);
      },
      subscribe(handler) {
        const listener = (event: StorageEvent) => {
          if (event.key !== STORAGE_KEY || !event.newValue) {
            return;
          }
          try {
            handler(JSON.parse(event.newValue) as WindowRefreshMessage);
          } catch {
            // Ignore malformed storage messages from unrelated tabs or extensions.
          }
        };
        window.addEventListener('storage', listener);
        return () => window.removeEventListener('storage', listener);
      },
    };
  }
  const channel = new BroadcastChannel('ozw-project-refresh');
  return {
    postMessage(message) {
      channel.postMessage(message);
    },
    subscribe(handler) {
      const listener = (event: MessageEvent<WindowRefreshMessage>) => handler(event.data);
      channel.addEventListener('message', listener);
      return () => {
        channel.removeEventListener('message', listener);
        channel.close();
      };
    },
  };
}

/**
 * Create a browser-window project refresh coordinator.
 */
export function createWindowRefreshCoordinator(options: WindowRefreshCoordinatorOptions = {}) {
  /**
   * PURPOSE: Select a visible owner for each invalidation scope and keep the
   * last owner-published project snapshot available to follower windows.
   */
  const windowId = options.windowId || `window-${Math.random().toString(36).slice(2)}`;
  const transport = options.transport || createDefaultTransport();
  const isVisible = options.isVisible || (() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const now = options.now || (() => Date.now());
  const ownerTtlMs = options.ownerTtlMs ?? 3000;
  const heartbeatMs = Math.max(250, options.heartbeatMs ?? Math.floor(ownerTtlMs / 2));
  const electionDelayMs = options.electionDelayMs ?? 25;
  const snapshotWaitMs = options.snapshotWaitMs ?? 1500;
  const owners = new Map<string, { windowId: string; expiresAt: number }>();
  const ownerCandidates = new Map<string, Map<string, { windowId: string; expiresAt: number }>>();
  const invalidationVersions = new Map<string, string>();
  const snapshots = new Map<string, Record<string, unknown>>();
  const snapshotWaiters = new Map<string, Set<(snapshot: Record<string, unknown>) => void>>();
  let unsubscribe: (() => void) | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const trackOwner = (scope: string, owner: { windowId: string; expiresAt: number }) => {
    /**
     * PURPOSE: Remember all active owner claims for a scope so concurrent
     * visible windows can elect one deterministic owner after broadcasts arrive.
     */
    owners.set(scope, owner);
    const candidates = ownerCandidates.get(scope) || new Map<string, { windowId: string; expiresAt: number }>();
    candidates.set(owner.windowId, owner);
    ownerCandidates.set(scope, candidates);
  };

  const chooseOwner = (scope: string, currentTime: number) => {
    /**
     * PURPOSE: Pick a stable owner from non-expired candidates for the same
     * scope/version instead of accepting whichever claim arrived last.
     */
    const candidates = ownerCandidates.get(scope);
    if (!candidates) {
      return owners.get(scope) || null;
    }
    const activeOwners = [...candidates.values()]
      .filter((owner) => owner.expiresAt > currentTime)
      .sort((left, right) => left.windowId.localeCompare(right.windowId));
    if (activeOwners.length === 0) {
      ownerCandidates.delete(scope);
      owners.delete(scope);
      return null;
    }
    const electedOwner = activeOwners[0];
    trackOwner(scope, electedOwner);
    return electedOwner;
  };

  const rememberSnapshot = (scope: string, snapshot: Record<string, unknown>) => {
    /**
     * PURPOSE: Store a valid owner snapshot and notify follower windows that
     * are waiting for the owner REST read to finish.
     */
    snapshots.set(scope, snapshot);
    const waiters = snapshotWaiters.get(scope);
    if (!waiters) {
      return;
    }
    for (const resolve of waiters) {
      resolve(snapshot);
    }
    snapshotWaiters.delete(scope);
  };

  const snapshotMatchesVersion = (
    scope: string,
    snapshot: Record<string, unknown> | null | undefined,
    expectedVersion?: string,
  ) => {
    /**
     * PURPOSE: Ensure followers only reuse a snapshot that belongs to the
     * current invalidation version for this scope.
     */
    if (!snapshot) {
      return false;
    }
    const requiredVersion = expectedVersion ?? invalidationVersions.get(scope);
    if (!requiredVersion) {
      return true;
    }
    return String(snapshot.version || '') === requiredVersion;
  };

  const publishOwnerClaim = (scope: string) => {
    /**
     * PURPOSE: Claim or renew ownership for the scope while this visible window
     * is responsible for expensive refreshes.
     */
    const owner = { windowId, expiresAt: now() + ownerTtlMs };
    trackOwner(scope, owner);
    transport?.postMessage({
      type: 'owner-claim',
      scope,
      ownerWindowId: windowId,
      windowId,
      expiresAt: owner.expiresAt,
    });
    return owner;
  };

  const handleMessage = (message: WindowRefreshMessage) => {
    /**
     * PURPOSE: Track owner claims and project snapshots published by sibling
     * windows through the shared transport.
     */
    if (!message || message.sourceWindowId === windowId || message.windowId === windowId) {
      return;
    }
    if (message.type === 'owner-claim' && message.ownerWindowId && message.expiresAt) {
      trackOwner(message.scope || DEFAULT_SCOPE, {
        windowId: message.ownerWindowId,
        expiresAt: Number(message.expiresAt),
      });
    }
    if (message.type === 'projects-snapshot' && message.snapshot) {
      const scope = message.scope || DEFAULT_SCOPE;
      const expectedVersion = invalidationVersions.get(scope);
      const snapshotVersion = String(message.snapshot.version || '');
      if (!expectedVersion || !snapshotVersion || snapshotVersion === expectedVersion) {
        rememberSnapshot(scope, message.snapshot);
      }
    }
  };

  return {
    async start() {
      /**
       * PURPOSE: Subscribe once to cross-window owner and snapshot messages.
       */
      if (!transport || unsubscribe) {
        return;
      }
      unsubscribe = transport.subscribe(handleMessage);
      heartbeatTimer = setInterval(() => {
        /**
         * PURPOSE: Keep visible-window owner claims fresh so hidden followers do
         * not duplicate work while the owner tab is still alive.
         */
        if (!isVisible()) {
          return;
        }
        for (const [scope, owner] of owners.entries()) {
          if (owner.windowId === windowId) {
            publishOwnerClaim(scope);
          }
        }
      }, heartbeatMs);
    },

    async requestProjectRefresh(invalidation: ProjectInvalidation = {}): Promise<ProjectRefreshDecision> {
      /**
       * PURPOSE: Decide whether this window should execute the heavy project
       * refresh for the invalidated scope.
       */
      const scope = String(invalidation.scope || DEFAULT_SCOPE);
      const version = String(invalidation.version || '');
      if (version) {
        invalidationVersions.set(scope, version);
      }
      const currentTime = now();
      const existingOwner = chooseOwner(scope, currentTime);
      if (existingOwner && existingOwner.expiresAt > currentTime) {
        return {
          shouldRun: existingOwner.windowId === windowId,
          ownerWindowId: existingOwner.windowId,
          scope,
          reason: String(invalidation.reason || ''),
        };
      }

      if (!isVisible()) {
        return {
          shouldRun: false,
          ownerWindowId: '',
          scope,
          reason: String(invalidation.reason || ''),
        };
      }

      publishOwnerClaim(scope);
      if (electionDelayMs > 0) {
        await delay(electionDelayMs);
      }
      const electedOwner = chooseOwner(scope, now());
      return {
        shouldRun: electedOwner?.windowId === windowId,
        ownerWindowId: electedOwner?.windowId || windowId,
        scope,
        reason: String(invalidation.reason || ''),
      };
    },

    async publishProjectsSnapshot(snapshot: Record<string, unknown>) {
      /**
       * PURPOSE: Share the freshly fetched lightweight project list with
       * follower windows after the owner completes its REST read.
       */
      const scope = String(snapshot.scope || DEFAULT_SCOPE);
      const expectedVersion = invalidationVersions.get(scope);
      const snapshotVersion = String(snapshot.version || '');
      if (expectedVersion && snapshotVersion && snapshotVersion !== expectedVersion) {
        return;
      }
      const publishedSnapshot = { ...snapshot, sourceWindowId: snapshot.sourceWindowId || windowId };
      rememberSnapshot(scope, publishedSnapshot);
      transport?.postMessage({
        type: 'projects-snapshot',
        scope,
        windowId,
        snapshot: publishedSnapshot,
      });
    },

    getProjectsSnapshot(scope = DEFAULT_SCOPE, expectedVersion?: string) {
      /**
       * PURPOSE: Return the owner-published snapshot for the current
       * invalidation version so followers do not apply stale scope data.
       */
      const snapshot = snapshots.get(scope) || null;
      return snapshotMatchesVersion(scope, snapshot, expectedVersion) ? snapshot : null;
    },

    async waitForProjectsSnapshot(scope = DEFAULT_SCOPE, timeoutMs = snapshotWaitMs, expectedVersion?: string) {
      /**
       * PURPOSE: Let non-owner windows reuse an owner snapshot that arrives
       * shortly after their invalidation handler runs.
       */
      const existingSnapshot = snapshots.get(scope);
      if (snapshotMatchesVersion(scope, existingSnapshot, expectedVersion) || timeoutMs <= 0) {
        return snapshotMatchesVersion(scope, existingSnapshot, expectedVersion) ? existingSnapshot || null : null;
      }
      return new Promise<Record<string, unknown> | null>((resolve) => {
        const waiters = snapshotWaiters.get(scope) || new Set<(snapshot: Record<string, unknown>) => void>();
        let settled = false;
        const finish = (snapshot: Record<string, unknown> | null) => {
          if (settled) {
            return;
          }
          settled = true;
          waiters.delete(onSnapshot);
          if (waiters.size === 0) {
            snapshotWaiters.delete(scope);
          }
          resolve(snapshot);
        };
        const onSnapshot = (snapshot: Record<string, unknown>) => {
          if (snapshotMatchesVersion(scope, snapshot, expectedVersion)) {
            finish(snapshot);
          }
        };
        waiters.add(onSnapshot);
        snapshotWaiters.set(scope, waiters);
        setTimeout(() => finish(null), timeoutMs);
      });
    },

    async dispose() {
      /**
       * PURPOSE: Release the cross-window subscription when the app unmounts.
       */
      unsubscribe?.();
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      unsubscribe = null;
    },
  };
}
