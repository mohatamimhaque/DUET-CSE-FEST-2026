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
  const lastDispatchedStateSigRef = useRef<{ sig: string; time: number }>({ sig: '', time: 0 });
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastPolledStateSigRef = useRef<string>('');
  const isDestroyedRef = useRef<boolean>(false);
  const reconnectAttemptsRef = useRef<number>(0);
  const wsDisabledRef = useRef<boolean>(false);
  const wsHandshakeSucceededRef = useRef<boolean>(false);

  const handleIncomingMessage = useCallback((raw: string) => {
    try {
      const data: WebSocketMessage = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!data || !data.type) return;

      // Filter out internal protocol heartbeats and connection handshakes
      if (data.type === 'PONG' || data.type === 'PING' || data.type === 'CONNECTED') {
        setIsConnected(true);
        return;
      }

      // 1. Unique packet ID deduplication
      const key = data.id || `${data.type}_${data.timestamp}_${typeof data.payload === 'object' ? JSON.stringify(data.payload) : data.payload}`;

      if (seenIdsRef.current.has(key)) {
        return;
      }

      // 2. Semantic state deduplication across protocols (WS vs SSE vs Supabase CDC vs Polling)
      // If two different transports deliver the exact same state within 1500ms, ignore redundant re-render
      if (data.type === 'STATE_UPDATED' || data.type === 'DRAW_STATE') {
        const payload = data.payload || {};
        const stateSig = `${payload.status}_${payload.next_serial}_${payload.completed_winners}_${payload.current_candidate?.id || ''}_${payload.last_winner?.id || ''}`;
        const now = Date.now();
        if (
          lastDispatchedStateSigRef.current.sig === stateSig &&
          now - lastDispatchedStateSigRef.current.time < 1500
        ) {
          return;
        }
        lastDispatchedStateSigRef.current = { sig: stateSig, time: now };
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

      // Auto-detect serverless hosting via response headers or JSON payload
      const isServerlessHeader = res.headers.get('x-serverless-mode') === 'true' || Boolean(res.headers.get('x-vercel-id'));
      const isWsDisabledHeader = res.headers.get('x-ws-supported') === 'false';

      const data = await res.json();
      setIsConnected(true);

      if (isServerlessHeader || isWsDisabledHeader || data.ws_supported === false) {
        if (!wsDisabledRef.current) {
          wsDisabledRef.current = true;
          try {
            sessionStorage.setItem('raffle_ws_disabled', '1');
            (window as any).__WS_DISABLED__ = true;
          } catch {}
          if (wsRef.current && wsRef.current.readyState !== WebSocket.OPEN) {
            try {
              wsRef.current.close();
            } catch {}
            wsRef.current = null;
          }
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
          }
        }
      }

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

        // Synthesize stage events for audience ONLY if streaming connection is not active
        if (role === 'audience') {
          const isStreamingActive =
            (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) ||
            (eventSourceRef.current && eventSourceRef.current.readyState === EventSource.OPEN);

          if (!isStreamingActive) {
            if (data.status === 'DRAWING' && data.current_candidate) {
              handleIncomingMessage(
                JSON.stringify({
                  id: `poll_draw_${sig}`,
                  type: 'DRAW_START',
                  payload: {
                    serial: data.next_serial,
                    candidate: data.current_candidate,
                    countdown_seconds: 5,
                    shuffle_passes: 7,
                  },
                  timestamp: new Date().toISOString(),
                })
              );
            } else if (data.status === 'WINNER_CONFIRMED' && data.last_winner) {
              handleIncomingMessage(
                JSON.stringify({
                  id: `poll_win_${sig}`,
                  type: 'WINNER_CONFIRMED',
                  payload: {
                    winner: data.last_winner,
                    completed_winners: data.completed_winners,
                    is_completed: data.status === 'COMPLETED' || data.completed_winners >= (data.total_winners || 10),
                  },
                  timestamp: new Date().toISOString(),
                })
              );
            }
          }
        }
      }
    } catch {
      // Polling network glitch
    }
  }, [role, handleIncomingMessage]);

  const connectWs = useCallback(() => {
    if (typeof window === 'undefined' || isDestroyedRef.current || wsDisabledRef.current) return;

    // Detect serverless deployment domains or sessions where custom WebSockets are unsupported
    const isStoredDisabled = typeof sessionStorage !== 'undefined' && sessionStorage.getItem('raffle_ws_disabled') === '1';
    const hostname = window.location.hostname;
    const isKnownServerlessDomain =
      hostname.includes('vercel.app') ||
      hostname.includes('now.sh') ||
      hostname.includes('lexinovax.app') ||
      Boolean((window as any).__WS_DISABLED__);

    if (isStoredDisabled || isKnownServerlessDomain) {
      wsDisabledRef.current = true;
      return;
    }

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/ws/${role}`;
      wsHandshakeSucceededRef.current = false;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isDestroyedRef.current) {
          ws.close();
          return;
        }
        wsHandshakeSucceededRef.current = true;
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;

        // Periodic application-level heartbeat (8s)
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: 'PING' }));
            } catch {}
          }
        }, 8000);
      };

      ws.onmessage = (event) => {
        handleIncomingMessage(event.data);
      };

      ws.onclose = () => {
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        if (isDestroyedRef.current) return;

        // Handshake failed or server returned non-101 (e.g. Vercel serverless 200/501/426)
        // Permanently trip the circuit breaker so the browser never loops retries
        if (!wsHandshakeSucceededRef.current) {
          wsDisabledRef.current = true;
          try {
            sessionStorage.setItem('raffle_ws_disabled', '1');
            (window as any).__WS_DISABLED__ = true;
          } catch {}
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
          }
          return;
        }

        // Only reconnect if the connection was legitimately established before dropping
        const delay = Math.min(2500, 250 + reconnectAttemptsRef.current * 350);
        reconnectAttemptsRef.current += 1;
        if (reconnectAttemptsRef.current > 5) {
          wsDisabledRef.current = true;
          return;
        }
        
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!isDestroyedRef.current && !wsDisabledRef.current) {
            connectWs();
          }
        }, delay);

        // If SSE is not open, show disconnected
        if (!eventSourceRef.current || eventSourceRef.current.readyState === EventSource.CLOSED) {
          setIsConnected(false);
        }
      };

      ws.onerror = () => {
        if (!wsHandshakeSucceededRef.current) {
          wsDisabledRef.current = true;
          try {
            sessionStorage.setItem('raffle_ws_disabled', '1');
            (window as any).__WS_DISABLED__ = true;
          } catch {}
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
          }
        }
        try {
          ws.close();
        } catch {}
      };
    } catch {
      // WS error fallback
      wsDisabledRef.current = true;
    }
  }, [role, handleIncomingMessage]);

  const connectSse = useCallback(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined' || isDestroyedRef.current) return;

    // Avoid long-lived SSE connections on serverless hosts that timeout or buffer
    const isStoredDisabled = typeof sessionStorage !== 'undefined' && sessionStorage.getItem('raffle_ws_disabled') === '1';
    const hostname = window.location.hostname;
    if (
      wsDisabledRef.current ||
      isStoredDisabled ||
      hostname.includes('vercel.app') ||
      hostname.includes('lexinovax.app') ||
      Boolean((window as any).__WS_DISABLED__)
    ) {
      return;
    }

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

    // 3. Fallback heartbeat polling synchronization with adaptive intervals (6s when streaming, 1.2s on fallback)
    const scheduleNextPoll = () => {
      if (pollIntervalRef.current) clearTimeout(pollIntervalRef.current);
      if (isDestroyedRef.current) return;

      const isLive =
        (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) ||
        (eventSourceRef.current && eventSourceRef.current.readyState === EventSource.OPEN);

      const nextDelay = isLive ? 6000 : 1200;
      pollIntervalRef.current = setTimeout(() => {
        pollState().finally(() => {
          scheduleNextPoll();
        });
      }, nextDelay);
    };

    pollState().finally(() => {
      scheduleNextPoll();
    });

    // 4. Mobile device wake-up / foreground resume listeners
    const handleWakeUp = () => {
      if (document.visibilityState === 'visible') {
        pollState();
        if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
          reconnectAttemptsRef.current = 0;
          connectWs();
        }
      }
    };

    document.addEventListener('visibilitychange', handleWakeUp);
    window.addEventListener('focus', handleWakeUp);
    window.addEventListener('online', handleWakeUp);
    window.addEventListener('pageshow', handleWakeUp);

    return () => {
      isDestroyedRef.current = true;
      unsubscribeSupabase();

      document.removeEventListener('visibilitychange', handleWakeUp);
      window.removeEventListener('focus', handleWakeUp);
      window.removeEventListener('online', handleWakeUp);
      window.removeEventListener('pageshow', handleWakeUp);

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
