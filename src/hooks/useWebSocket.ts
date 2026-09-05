import { useEffect, useRef, useState, useCallback } from 'react';

export interface WebSocketMessage {
  id?: string;
  type: string;
  payload: any;
  timestamp: string;
}

export function useWebSocket(role: 'audience' | 'controller' = 'audience') {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isDestroyedRef = useRef<boolean>(false);
  const reconnectAttemptsRef = useRef<number>(0);

  const handleIncomingMessage = useCallback((raw: string) => {
    try {
      const data: WebSocketMessage = JSON.parse(raw);
      if (!data || !data.type) return;

      // Filter out internal protocol heartbeats
      if (data.type === 'PONG' || data.type === 'PING') {
        setIsConnected(true);
        return;
      }

      // Generate unique deduplication key
      const key = data.id || `${data.type}_${data.timestamp}_${typeof data.payload === 'object' ? JSON.stringify(data.payload) : data.payload}`;

      if (seenIdsRef.current.has(key)) {
        return;
      }

      // Keep recent cache bounded
      if (seenIdsRef.current.size > 200) {
        const first = seenIdsRef.current.values().next().value;
        if (first) seenIdsRef.current.delete(first);
      }
      seenIdsRef.current.add(key);

      setIsConnected(true);
      setLastMessage(data);
    } catch {
      // Ignored malformed messages
    }
  }, []);

  const connectWs = useCallback(() => {
    if (typeof window === 'undefined' || isDestroyedRef.current) return;

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/ws/${role}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isDestroyedRef.current) {
          ws.close();
          return;
        }
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;

        // Periodic application-level heartbeat
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: 'PING' }));
            } catch {}
          }
        }, 20000);
      };

      ws.onmessage = (event) => {
        handleIncomingMessage(event.data);
      };

      ws.onclose = () => {
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        if (isDestroyedRef.current) return;

        // Auto-reconnect with exponential backoff
        const delay = Math.min(5000, 1000 * Math.pow(1.5, reconnectAttemptsRef.current));
        reconnectAttemptsRef.current += 1;
        
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWs();
        }, delay);

        // If SSE is not open, show disconnected
        if (!eventSourceRef.current || eventSourceRef.current.readyState === EventSource.CLOSED) {
          setIsConnected(false);
        }
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch {}
      };
    } catch {
      // WS error fallback to SSE
    }
  }, [role, handleIncomingMessage]);

  const connectSse = useCallback(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined' || isDestroyedRef.current) return;

    try {
      const sseUrl = role === 'controller' ? '/api/controller/events' : '/api/public/events';
      const es = new EventSource(sseUrl);
      eventSourceRef.current = es;

      es.onopen = () => {
        if (!isDestroyedRef.current) {
          setIsConnected(true);
        }
      };

      es.onmessage = (event) => {
        handleIncomingMessage(event.data);
      };

      es.onerror = () => {
        // EventSource will auto-reconnect natively
      };
    } catch {
      // SSE fallback
    }
  }, [role, handleIncomingMessage]);

  useEffect(() => {
    isDestroyedRef.current = false;
    connectWs();
    connectSse();

    return () => {
      isDestroyedRef.current = true;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);

      if (wsRef.current) {
        try {
          wsRef.current.onopen = null;
          wsRef.current.onmessage = null;
          wsRef.current.onclose = null;
          wsRef.current.onerror = null;
          if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
            wsRef.current.close();
          }
        } catch {}
      }

      if (eventSourceRef.current) {
        try {
          eventSourceRef.current.onopen = null;
          eventSourceRef.current.onmessage = null;
          eventSourceRef.current.onerror = null;
          eventSourceRef.current.close();
        } catch {}
      }
    };
  }, [connectWs, connectSse]);

  return { isConnected, lastMessage };
}
