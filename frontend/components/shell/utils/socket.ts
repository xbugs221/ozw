/**
 * PURPOSE: Provide shell websocket URL helpers and low-level message parsing.
 */
import type { ShellIncomingMessage, ShellOutgoingMessage } from '../types/types';

type ShellSocketConnection = {
  url: string;
  protocol: string | null;
};

export function getShellWebSocketUrl(): ShellSocketConnection | null {
  /** Require the same internal session token for local, hosted, and remote shells. */
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = localStorage.getItem('auth-token');

  if (!token) {
    console.error('No authentication token found for Shell WebSocket connection');
    return null;
  }

  return {
    url: `${protocol}//${window.location.host}/shell`,
    protocol: token,
  };
}

export function parseShellMessage(payload: string): ShellIncomingMessage | null {
  try {
    return JSON.parse(payload) as ShellIncomingMessage;
  } catch {
    return null;
  }
}

export function sendSocketMessage(ws: WebSocket | null, message: ShellOutgoingMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
    return;
  }

  console.warn('[Shell] Dropped socket message because websocket is not open:', message.type, ws?.readyState);
}
