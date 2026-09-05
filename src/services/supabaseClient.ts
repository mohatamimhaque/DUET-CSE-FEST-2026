import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

export interface SupabasePublicConfig {
  url: string;
  anon_key: string;
  is_configured: boolean;
}

// Fallback configuration matching deployment environment
const DEFAULT_SUPABASE_URL = 'https://toyocrdimcvkmiidposk.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRveW9jcmRpbWN2a21paWRwb3NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNzMwNDAsImV4cCI6MjA5Mzc0OTA0MH0.tcrMtLApEH13VotkJTsNqg2c0FbTwFhoUSIwzxfNF3U';

let browserClient: SupabaseClient | null = null;
let activeChannel: RealtimeChannel | null = null;
let resolvedConfig: SupabasePublicConfig | null = null;
let initPromise: Promise<SupabaseClient | null> | null = null;

/**
 * Fetch and resolve public Supabase configuration
 */
export async function getPublicSupabaseConfig(): Promise<SupabasePublicConfig> {
  if (resolvedConfig) return resolvedConfig;

  // 1. Check Vite env variables if injected at build time
  const envUrl = (import.meta as any).env?.VITE_SUPABASE_URL;
  const envKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || (import.meta as any).env?.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (envUrl && envKey) {
    resolvedConfig = {
      url: envUrl,
      anon_key: envKey,
      is_configured: true,
    };
    return resolvedConfig;
  }

  // 2. Fetch from backend API /api/public/event
  try {
    const res = await fetch('/api/public/event');
    if (res.ok) {
      const data = await res.json();
      if (data.supabase?.url && data.supabase?.anon_key) {
        resolvedConfig = {
          url: data.supabase.url,
          anon_key: data.supabase.anon_key,
          is_configured: Boolean(data.supabase.is_configured),
        };
        return resolvedConfig;
      }
    }
  } catch {
    // Backend fetch failed, proceed to fallback
  }

  // 3. Fallback to default credentials
  resolvedConfig = {
    url: DEFAULT_SUPABASE_URL,
    anon_key: DEFAULT_SUPABASE_ANON_KEY,
    is_configured: true,
  };

  return resolvedConfig;
}

/**
 * Initialize or retrieve the singleton browser Supabase client
 */
export async function initBrowserSupabase(): Promise<SupabaseClient | null> {
  if (browserClient) return browserClient;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const cfg = await getPublicSupabaseConfig();
      if (!cfg.url || !cfg.anon_key) return null;

      browserClient = createClient(cfg.url, cfg.anon_key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
        realtime: {
          params: {
            eventsPerSecond: 10,
          },
        },
      });

      return browserClient;
    } catch (err: any) {
      console.warn('[Supabase Realtime] Client initialization notice:', err.message);
      return null;
    }
  })();

  return initPromise;
}

export function getBrowserSupabase(): SupabaseClient | null {
  return browserClient;
}

/**
 * Subscribes to the live Raffle Realtime Channel (both Broadcast events and Postgres CDC changes)
 */
export function subscribeToRealtimeRaffle(
  onMessage: (msg: any) => void,
  onStatusChange?: (status: 'CONNECTING' | 'SUBSCRIBED' | 'ERROR' | 'CLOSED') => void
): () => void {
  let isSubscribed = true;
  let channel: RealtimeChannel | null = null;

  initBrowserSupabase().then((client) => {
    if (!client || !isSubscribed) return;

    onStatusChange?.('CONNECTING');

    // Subscribe to unified raffle events channel
    channel = client.channel('cse_fest_raffle_events', {
      config: {
        broadcast: { ack: false, self: false },
      },
    });
    activeChannel = channel;

    // 1. Listen to broadcast events (DRAW_START, CANDIDATE_SELECTED, WINNER_CONFIRMED, RESET, etc.)
    channel.on('broadcast', { event: '*' }, (packet: any) => {
      if (!isSubscribed) return;
      if (packet?.payload) {
        onMessage(packet.payload);
      } else if (packet?.event && packet) {
        onMessage({
          type: packet.event,
          payload: packet,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // 2. Listen to Postgres table changes (CDC) on the session state
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'cse_fest_2026_session' },
      (payload: any) => {
        if (!isSubscribed) return;
        onMessage({
          id: `cdc_session_${Date.now()}`,
          type: 'STATE_UPDATED',
          payload: payload.new || payload.old,
          timestamp: new Date().toISOString(),
        });
      }
    );

    // 3. Listen to Postgres table changes (CDC) on winners table
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'cse_fest_2026_winners' },
      (payload: any) => {
        if (!isSubscribed) return;
        onMessage({
          id: `cdc_winner_${Date.now()}`,
          type: 'WINNER_CONFIRMED',
          payload: {
            winner: payload.new,
            timestamp: new Date().toISOString(),
          },
          timestamp: new Date().toISOString(),
        });
      }
    );

    channel.subscribe((status: string, err?: any) => {
      if (!isSubscribed) return;
      if (status === 'SUBSCRIBED') {
        onStatusChange?.('SUBSCRIBED');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn(`[Supabase Realtime] Channel status: ${status}`, err);
        onStatusChange?.('ERROR');
      } else if (status === 'CLOSED') {
        onStatusChange?.('CLOSED');
      }
    });
  });

  return () => {
    isSubscribed = false;
    if (channel && browserClient) {
      try {
        browserClient.removeChannel(channel);
      } catch {}
      if (activeChannel === channel) {
        activeChannel = null;
      }
    }
  };
}

/**
 * Broadcast an event from the client across the Supabase Realtime channel
 */
export async function broadcastClientEvent(event: string, payload: any): Promise<boolean> {
  try {
    const client = await initBrowserSupabase();
    if (!client) return false;

    if (!activeChannel) {
      activeChannel = client.channel('cse_fest_raffle_events');
      await activeChannel.subscribe();
    }

    const res = await activeChannel.send({
      type: 'broadcast',
      event,
      payload: {
        id: `client_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        type: event,
        payload,
        timestamp: new Date().toISOString(),
      },
    });

    return res === 'ok';
  } catch (err: any) {
    console.warn('[Supabase Realtime] Broadcast failed:', err.message);
    return false;
  }
}
