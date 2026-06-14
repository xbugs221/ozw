/**
 * Shared chat WebSocket state.
 * Maintains connection lifecycle, outbound queuing, and an ordered inbound message history
 * so fast consecutive server events are not lost between React renders.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { IS_PLATFORM } from '../constants/config';

export type SocketMessageEnvelope = {
  sequence: number;
  message: any;
};

type WebSocketContextType = {
  ws: WebSocket | null;
  sendMessage: (message: any) => void;
  latestMessage: any | null;
  messageHistory: SocketMessageEnvelope[];
  isConnected: boolean;
};

const WebSocketContext = createContext<WebSocketContextType | null>(null);

const MAX_QUEUED_MESSAGES = 50;
const MAX_MESSAGE_HISTORY = 200;
const CHAT_RECONNECT_DELAY_MS = 3_000;
const CHAT_HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * Return whether the current browser session is talking to a loopback host.
 */
const isLoopbackBrowserHost = () => {
  const hostname = window.location.hostname.toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
};
const CHAT_HEARTBEAT_TIMEOUT_MS = 45_000;

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

const buildWebSocketUrl = (token: string | null) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (IS_PLATFORM) {
    return `${protocol}//${window.location.host}/ws`; // Platform mode: Use same domain as the page (goes through proxy)
  }
  if (!token && isLoopbackBrowserHost()) return `${protocol}//${window.location.host}/ws`;
  if (!token) return null;
  return `${protocol}//${window.location.host}/ws`;
};

const useWebSocketProviderState = (): WebSocketContextType => {
  const wsRef = useRef<WebSocket | null>(null);
  const unmountedRef = useRef(false); // Track if component is unmounted
  const isConnectingRef = useRef(false);
  const outboundQueueRef = useRef<string[]>([]);
  const messageSequenceRef = useRef(0);
  const heartbeatIntervalRef = useRef<number | null>(null);
  const heartbeatTimeoutRef = useRef<number | null>(null);
  const [latestMessage, setLatestMessage] = useState<any>(null);
  const [messageHistory, setMessageHistory] = useState<SocketMessageEnvelope[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { token } = useAuth();

  /**
   * Reset the websocket heartbeat timers when the socket becomes healthy or closes.
   */
  const clearHeartbeatTimers = useCallback(() => {
    if (heartbeatIntervalRef.current !== null) {
      window.clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }

    if (heartbeatTimeoutRef.current !== null) {
      window.clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = null;
    }
  }, []);

  /**
   * Mark the chat websocket as alive after any inbound activity and reset the watchdog.
   */
  const markSocketAlive = useCallback(() => {
    if (heartbeatTimeoutRef.current !== null) {
      window.clearTimeout(heartbeatTimeoutRef.current);
    }

    heartbeatTimeoutRef.current = window.setTimeout(() => {
      const activeSocket = wsRef.current;
      if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
        return;
      }

      console.warn('[Chat WS] Heartbeat timeout reached, forcing reconnect');
      activeSocket.close();
    }, CHAT_HEARTBEAT_TIMEOUT_MS);
  }, []);

  /**
   * Start an app-level ping/pong heartbeat so stale websocket links can be recovered.
   *
   * @param {WebSocket} socket
   */
  const startHeartbeat = useCallback((socket: WebSocket) => {
    clearHeartbeatTimers();
    markSocketAlive();

    heartbeatIntervalRef.current = window.setInterval(() => {
      if (socket !== wsRef.current || socket.readyState !== WebSocket.OPEN) {
        return;
      }

      try {
        socket.send(JSON.stringify({
          type: 'ping',
          timestamp: Date.now(),
        }));
        markSocketAlive();
      } catch (error) {
        console.error('[Chat WS] Failed to send heartbeat ping:', error);
      }
    }, CHAT_HEARTBEAT_INTERVAL_MS);
  }, [clearHeartbeatTimers, markSocketAlive]);

  /**
   * Flush queued outbound messages after WebSocket connection is opened.
   */
  const flushOutboundQueue = useCallback((socket: WebSocket) => {
    if (socket.readyState !== WebSocket.OPEN || outboundQueueRef.current.length === 0) {
      return;
    }

    const queued = [...outboundQueueRef.current];
    outboundQueueRef.current = [];

    for (const serializedMessage of queued) {
      try {
        socket.send(serializedMessage);
      } catch (error) {
        // Put unsent payloads back to the front if sending fails mid-flush.
        outboundQueueRef.current = [serializedMessage, ...outboundQueueRef.current];
        console.error('Error flushing queued WebSocket message:', error);
        break;
      }
    }
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    connect();
    (window as any).__ozwTestCloseWebSocket = () => {
      wsRef.current?.close();
    };

    return () => {
      unmountedRef.current = true;
      delete (window as any).__ozwTestCloseWebSocket;
      clearHeartbeatTimers();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [token]); // everytime token changes, we reconnect

  const connect = useCallback(() => {
    if (unmountedRef.current) return; // Prevent connection if unmounted
    if (isConnectingRef.current) return;

    const existingSocket = wsRef.current;
    if (existingSocket && (existingSocket.readyState === WebSocket.OPEN || existingSocket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      // Construct WebSocket URL
      const wsUrl = buildWebSocketUrl(token);

      if (!wsUrl) return console.warn('No authentication token found for WebSocket connection');

      isConnectingRef.current = true;
      const websocket = new WebSocket(wsUrl, token ? [token] : undefined);
      wsRef.current = websocket;

      websocket.onopen = () => {
        if (unmountedRef.current) {
          websocket.close();
          return;
        }

        isConnectingRef.current = false;
        setIsConnected(true);
        flushOutboundQueue(websocket);
        startHeartbeat(websocket);
      };

      const handleIncomingMessage = (event: MessageEvent) => {
        if (wsRef.current !== websocket) {
          return;
        }

        try {
          const data = JSON.parse(event.data);
          markSocketAlive();

          if (data?.type === 'pong') {
            return;
          }

          setLatestMessage(data);
          setMessageHistory((previous) => {
            const nextEnvelope: SocketMessageEnvelope = {
              sequence: messageSequenceRef.current + 1,
              message: data,
            };
            messageSequenceRef.current = nextEnvelope.sequence;
            const nextHistory = [...previous, nextEnvelope];
            if (nextHistory.length <= MAX_MESSAGE_HISTORY) {
              return nextHistory;
            }
            return nextHistory.slice(nextHistory.length - MAX_MESSAGE_HISTORY);
          });
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };
      websocket.onmessage = handleIncomingMessage;

      websocket.onclose = () => {
        if (wsRef.current !== websocket) {
          return;
        }

        clearHeartbeatTimers();
        isConnectingRef.current = false;
        setIsConnected(false);
        wsRef.current = null;

        // Attempt to reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          if (unmountedRef.current) return; // Prevent reconnection if unmounted
          connect();
        }, CHAT_RECONNECT_DELAY_MS);
      };

      websocket.onerror = (error) => {
        if (wsRef.current !== websocket) {
          return;
        }

        isConnectingRef.current = false;
        console.warn('WebSocket disconnected before it was ready:', error);
      };

    } catch (error) {
      isConnectingRef.current = false;
      console.error('Error creating WebSocket connection:', error);
    }
  }, [clearHeartbeatTimers, flushOutboundQueue, markSocketAlive, startHeartbeat, token]); // everytime token changes, we reconnect

  const sendMessage = useCallback((message: any) => {
    const serializedMessage = JSON.stringify(message);
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      console.log('[WS sendMessage] Sending:', message?.type, 'readyState:', socket.readyState);
      socket.send(serializedMessage);
    } else {
      console.warn('[WS sendMessage] Socket not ready, queuing:', message?.type,
        'readyState:', socket?.readyState, 'queueLen:', outboundQueueRef.current.length);
      if (outboundQueueRef.current.length >= MAX_QUEUED_MESSAGES) {
        outboundQueueRef.current.shift();
      }
      outboundQueueRef.current.push(serializedMessage);
      connect();
    }
  }, [connect]);

  const value: WebSocketContextType = useMemo(() =>
  ({
    ws: wsRef.current,
    sendMessage,
    latestMessage,
    messageHistory,
    isConnected
  }), [sendMessage, latestMessage, messageHistory, isConnected]);

  return value;
};

export const WebSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const webSocketData = useWebSocketProviderState();

  return (
    <WebSocketContext.Provider value={webSocketData}>
      {children}
    </WebSocketContext.Provider>
  );
};

export default WebSocketContext;
