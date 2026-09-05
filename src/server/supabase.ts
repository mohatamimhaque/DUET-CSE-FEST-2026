import { createClient, SupabaseClient } from '@supabase/supabase-js';

let cachedClient: SupabaseClient | null = null;

export function getSupabaseConfig(): { url: string; key: string; isConfigured: boolean } {
  const url = process.env.SUPABASE_URL?.trim() || '';
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim()) || '';
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
