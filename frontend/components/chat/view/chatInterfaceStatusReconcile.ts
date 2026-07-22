/**
 * PURPOSE: Build and deduplicate chat session status reconciliation requests.
 */
import { useEffect } from 'react';
import type { MutableRefObject } from 'react';

import { isTemporarySessionId, type PendingViewSession } from '../session/sessionIdentity';
import { isHermesScopedSessionId } from '../../../utils/providerCapabilities';

type StatusProvider = 'codex' | 'pi';

type UseChatStatusReconcileArgs = {
  canAbortSession: boolean;
  currentSessionId: string | null;
  effectiveProvider: string;
  isLoading: boolean;
  pendingViewSessionRef: MutableRefObject<PendingViewSession | null>;
  selectedProjectPath?: string;
  selectedSessionId?: string | null;
  selectedSessionProjectPath?: string;
  selectedSessionProviderScope?: string | null;
  selectedSessionRouteIndex?: number | string | null;
  statusReconcileKeyRef: MutableRefObject<string | null>;
  sendMessage: (message: Record<string, unknown>) => void;
};

function getRouteSessionId(routeIndex?: number | string | null): string | null {
  /** Convert a route index into the canonical cN session id used by the backend. */
  return Number.isInteger(Number(routeIndex)) ? `c${Number(routeIndex)}` : null;
}

function buildReconcileKey(
  provider: StatusProvider,
  sessionId: string,
  routeSessionId: string | null,
  projectPath: string,
): string {
  /** Build the stable key that prevents repeated status probes for the same view. */
  return [provider, sessionId, routeSessionId || '', projectPath].join('|');
}

export function useChatStatusReconcile({
  canAbortSession,
  currentSessionId,
  effectiveProvider,
  isLoading,
  pendingViewSessionRef,
  selectedProjectPath = '',
  selectedSessionId,
  selectedSessionProjectPath = '',
  selectedSessionProviderScope = null,
  selectedSessionRouteIndex,
  statusReconcileKeyRef,
  sendMessage,
}: UseChatStatusReconcileArgs): void {
  /** Send one scoped status check whenever the active route-backed session changes. */
  useEffect(() => {
    const activeViewSessionId = selectedSessionId || currentSessionId || pendingViewSessionRef.current?.sessionId || null;
    const activeRouteSessionId = getRouteSessionId(selectedSessionRouteIndex);
    const statusSessionId = activeRouteSessionId || activeViewSessionId;

    if (!statusSessionId || (isTemporarySessionId(statusSessionId) && !activeRouteSessionId)) {
      return;
    }

    if (isHermesScopedSessionId(statusSessionId)) return;

    if (effectiveProvider === 'claude' || effectiveProvider === 'hermes' || selectedSessionProviderScope) {
      /** Claude 由 tmux TUI 承载，不存在 OZW native runtime 状态可协调。 */
      return;
    }

    const statusProvider: StatusProvider = effectiveProvider === 'pi' ? 'pi' : 'codex';
    const statusProjectPath = selectedSessionProjectPath || selectedProjectPath;
    const reconcileKey = buildReconcileKey(statusProvider, statusSessionId, activeRouteSessionId, statusProjectPath);

    if (statusReconcileKeyRef.current === reconcileKey && !isLoading) {
      return;
    }
    if (canAbortSession && statusReconcileKeyRef.current === reconcileKey) {
      return;
    }

    statusReconcileKeyRef.current = reconcileKey;
    sendMessage({
      type: 'check-session-status',
      sessionId: statusSessionId,
      ozwSessionId: activeRouteSessionId,
      ozw_session_id: activeRouteSessionId,
      provider: statusProvider,
      projectPath: statusProjectPath,
    });
  }, [
    canAbortSession,
    currentSessionId,
    effectiveProvider,
    isLoading,
    pendingViewSessionRef,
    selectedProjectPath,
    selectedSessionId,
    selectedSessionProjectPath,
    selectedSessionProviderScope,
    selectedSessionRouteIndex,
    sendMessage,
    statusReconcileKeyRef,
  ]);
}
