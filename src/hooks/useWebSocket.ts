import { useEffect, useRef, useState, useCallback } from 'react';
import { subscribeToRealtimeRaffle } from '../services/supabaseClient.ts';

export interface WebSocketMessage {
  id?: string;
  type: string;
  payload: any;
  timestamp: string;
}

export function useWebSocket(role: 'audience' | 'controller' = 'audience') {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isSupabaseRealtime, setIsSupabaseRealtime] = useState<boolean>(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastPolledStateSigRef = useRef<string>('');
  const isDestroyedRef = useRef<boolean>(false);
  const reconnectAttemptsRef = useRef<number>(0);
  const wsDisabledRef = useRef<boolean>(false);

  const handleIncomingMessage = useCallback((raw: string) => {
    try {
      const data: WebSocketMessage = typeof raw === 'string' ? JSON.parse(raw) : raw;
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

  const pollState = useCallback(async () => {
    if (isDestroyedRef.current) return;
    try {
      const endpoint = role === 'controller' ? '/api/controller/state' : '/api/public/draw/state';
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('raffle_ctrl_token') : null;
      const headers: Record<string, string> = {};
      if (token && role === 'controller') {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const res = await fetch(endpoint, { headers });
      if (!res.ok) return;
      const data = await res.json();
      setIsConnected(true);

      // Create a deterministic signature based on draw-relevant state
      const sig = `${data.status}_${data.next_serial}_${data.completed_winners}_${data.current_candidate?.id || ''}_${data.last_winner?.id || ''}_${data.is_locked ? 1 : 0}`;
      if (sig !== lastPolledStateSigRef.current) {
        lastPolledStateSigRef.current = sig;
        const msgType = role === 'controller' ? 'STATE_UPDATED' : 'DRAW_STATE';
        handleIncomingMessage(
          JSON.stringify({
            id: `poll_${role}_${sig}`,
            type: msgType,
            payload: data,
            timestamp: new Date().toISOString(),
          })
        );
      }
    } catch {
      // Polling network glitch
    }
  }, [role, handleIncomingMessage]);

  const connectWs = useCallback(() => {
    if (typeof window === 'undefined' || isDestroyedRef.current || wsDisabledRef.current) return;

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

        // Auto-reconnect with exponential backoff (capped to prevent endless errors on serverless)
        if (reconnectAttemptsRef.current < 2) {
          const delay = Math.min(4000, 1000 * Math.pow(1.5, reconnectAttemptsRef.current));
          reconnectAttemptsRef.current += 1;
          
          if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = setTimeout(() => {
            connectWs();
          }, delay);
        } else {
          // Permanently disable WS for this session and rely on HTTP polling sync
          wsDisabledRef.current = true;
        }

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
      // WS error fallback to SSE & polling
      wsDisabledRef.current = true;
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

    // 1. Primary: Supabase Managed Realtime WebSocket Channel
    const unsubscribeSupabase = subscribeToRealtimeRaffle(
      (msg: any) => {
        handleIncomingMessage(typeof msg === 'string' ? msg : JSON.stringify(msg));
      },
      (status) => {
        if (status === 'SUBSCRIBED') {
          setIsConnected(true);
          setIsSupabaseRealtime(true);
        } else if (status === 'ERROR' || status === 'CLOSED') {
          setIsSupabaseRealtime(false);
        }
      }
    );

    // 2. Secondary & Standalone fallback connections
    connectWs();
    connectSse();

    // 3. Fallback heartbeat polling synchronization
    pollState();
    pollIntervalRef.current = setInterval(pollState, 1500);

    return () => {
      isDestroyedRef.current = true;
      unsubscribeSupabase();

      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

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
  }, [connectWs, connectSse, pollState, handleIncomingMessage]);

  return { isConnected, lastMessage, isSupabaseRealtime };
}
