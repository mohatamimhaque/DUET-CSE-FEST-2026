import { createClient, SupabaseClient } from '@supabase/supabase-js';

let cachedClient: SupabaseClient | null = null;
let realtimeChannel: any = null;

export function getSupabaseConfig(): { url: string; key: string; isConfigured: boolean } {
  const url = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || 'https://toyocrdimcvkmiidposk.supabase.co';
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()) || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRveW9jcmRpbWN2a21paWRwb3NrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODE3MzA0MCwiZXhwIjoyMDkzNzQ5MDQwfQ.SSV-Cfid5yjv4JqEJNxbMdXSC8U7k4xMGNnqRGuacmU';
  const isConfigured = Boolean(url && key && url.startsWith('http'));
  return { url, key, isConfigured };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseConfig().isConfigured;
}

export function getSupabaseClient(): SupabaseClient | null {
  const { url, key, isConfigured } = getSupabaseConfig();
  if (!isConfigured) {
    return null;
  }

  if (!cachedClient) {
    try {
      cachedClient = createClient(url, key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
      console.log('[Supabase] Initialized database client successfully.');
    } catch (err: any) {
      console.error(`[Supabase] Error creating client:`, err.message);
      return null;
    }
  }

  return cachedClient;
}

export async function checkSupabaseHealth(): Promise<{
  connected: boolean;
  is_empty: boolean;
  participant_count: number;
  message: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      connected: false,
      is_empty: true,
      participant_count: 0,
      message: 'SUPABASE_NOT_CONFIGURED: Provide SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.',
    };
  }

  try {
    const { count, error } = await client
      .from('cse_fest_2026_participants')
      .select('*', { count: 'exact', head: true });

    if (error) {
      return {
        connected: false,
        is_empty: true,
        participant_count: 0,
        message: `SUPABASE_QUERY_ERROR: ${error.message}`,
      };
    }

    const total = count || 0;
    return {
      connected: true,
      is_empty: total === 0,
      participant_count: total,
      message: total === 0 ? 'DB is empty' : `Connected. ${total} participants found.`,
    };
  } catch (err: any) {
    return {
      connected: false,
      is_empty: true,
      participant_count: 0,
      message: `SUPABASE_CONNECT_EXCEPTION: ${err.message}`,
    };
  }
}

/**
 * Broadcast event across Supabase Realtime WebSocket channel
 */
export async function broadcastSupabaseEvent(type: string, payload: any): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  try {
    if (!realtimeChannel || (realtimeChannel as any).state !== 'joined') {
      realtimeChannel = client.channel('cse_fest_raffle_events');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2000);
        realtimeChannel!.subscribe((status: string) => {
          if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            clearTimeout(timer);
            resolve();
          }
        });
      });
    }

    const res = await realtimeChannel.send({
      type: 'broadcast',
      event: type,
      payload,
    });

    return res === 'ok';
  } catch (err: any) {
    console.warn('[Supabase Realtime] Broadcast notice:', err.message);
    return false;
  }
}
