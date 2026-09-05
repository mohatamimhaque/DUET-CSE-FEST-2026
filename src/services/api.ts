import {
  PublicEventInfo,
  PublicDrawState,
  ControllerState,
  HealthStatus,
  Participant,
  WinnerResult,
} from '../types.ts';

const TOKEN_KEY = 'raffle_ctrl_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = getStoredToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export const api = {
  // Public
  async getPublicEvent(): Promise<PublicEventInfo> {
    const res = await fetch('/api/public/event');
    if (!res.ok) throw new Error('Failed to fetch public event info');
    return res.json();
  },

  async getPublicDrawState(): Promise<PublicDrawState> {
    const res = await fetch('/api/public/draw/state');
    if (!res.ok) throw new Error('Failed to fetch draw state');
    return res.json();
  },

  async getPublicParticipants(params: {
    q?: string;
    type?: string;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    total: number;
    filtered_total: number;
    page: number;
    limit: number;
    total_pages: number;
    counts: { total: number; eligible: number; winner: number; ignored: number };
    participants: (Participant & { status: 'eligible' | 'winner' | 'ignored'; winning_serial?: number })[];
  }> {
    const searchParams = new URLSearchParams();
    if (params.q) searchParams.set('q', params.q);
    if (params.type && params.type !== 'all') searchParams.set('type', params.type);
    if (params.status && params.status !== 'all') searchParams.set('status', params.status);
    if (params.page) searchParams.set('page', String(params.page));
    if (params.limit) searchParams.set('limit', String(params.limit));

    const res = await fetch(`/api/public/participants?${searchParams.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch participants directory');
    return res.json();
  },

  async getRollPool(): Promise<{ pool: Array<{ name: string; id: string; type: string }> }> {
    const res = await fetch('/api/public/roll-pool');
    if (!res.ok) throw new Error('Failed to fetch roll pool');
    return res.json();
  },

  async getResults(): Promise<{
    event: string;
    total_winners: number;
    results: WinnerResult[];
    ignored: any[];
  }> {
    const res = await fetch('/api/results');
    if (!res.ok) throw new Error('Failed to fetch results');
    return res.json();
  },

  // Controller Auth
  async login(username: string, password: string): Promise<{ success: boolean; token: string; user: string }> {
    const res = await fetch('/api/controller/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Login failed. Please check credentials.');
    }
    setStoredToken(data.token);
    return data;
  },

  async controllerLogin(username: string, password: string): Promise<{ success: boolean; token: string; user: string }> {
    return this.login(username, password);
  },

  async logout(): Promise<void> {
    try {
      await fetch('/api/controller/auth/logout', { method: 'POST', headers: getAuthHeaders() });
    } finally {
      setStoredToken(null);
    }
  },

  async checkAuth(): Promise<{ authenticated: boolean; user: string | null }> {
    try {
      const res = await fetch('/api/controller/auth/check', { headers: getAuthHeaders() });
      if (!res.ok) return { authenticated: false, user: null };
      return res.json();
    } catch {
      return { authenticated: false, user: null };
    }
  },

  // Protected Controller
  async getControllerState(): Promise<ControllerState> {
    const res = await fetch('/api/controller/state', { headers: getAuthHeaders() });
    if (!res.ok) {
      if (res.status === 403 || res.status === 401) {
        throw new Error('AUTH_REQUIRED');
      }
      throw new Error('Failed to fetch controller state');
    }
    return res.json();
  },

  async searchParticipants(
    query = '',
    type = 'all',
    status = 'all'
  ): Promise<{
    total: number;
    filtered_total?: number;
    counts?: { total: number; eligible: number; winner: number; ignored: number };
    participants: (Participant & { status: string; winning_serial?: number })[];
  }> {
    const params = new URLSearchParams({ q: query, type, status });
    const res = await fetch(`/api/controller/participants/search?${params.toString()}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to search participants');
    return res.json();
  },

  async startDraw(): Promise<{
    success: boolean;
    message: string;
    candidate?: Participant;
    serial?: number;
    countdown_seconds?: number;
  }> {
    const res = await fetch('/api/controller/draw/start', {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Failed to start draw');
    }
    return data;
  },

  async confirmWinner(): Promise<{ success: boolean; message: string; winner?: WinnerResult }> {
    const res = await fetch('/api/controller/draw/confirm', {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Failed to confirm winner');
    }
    return data;
  },

  async ignoreCandidate(reason = 'absent'): Promise<{ success: boolean; message: string }> {
    const res = await fetch('/api/controller/draw/ignore', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ reason }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Failed to ignore candidate');
    }
    return data;
  },

  async pause(): Promise<{ success: boolean; message: string }> {
    const res = await fetch('/api/controller/pause', {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return res.json();
  },

  async resume(): Promise<{ success: boolean; message: string }> {
    const res = await fetch('/api/controller/resume', {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return res.json();
  },

  async restoreInterrupted(): Promise<{ success: boolean; message: string }> {
    const res = await fetch('/api/controller/draw/restore-interrupted', {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Failed to restore interrupted draw');
    }
    return data;
  },

  async cancelInterrupted(): Promise<{ success: boolean; message: string }> {
    const res = await fetch('/api/controller/draw/cancel-interrupted', {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Failed to cancel interrupted draw');
    }
    return data;
  },

  async resetSession(confirmation: string): Promise<{ success: boolean; message: string; backupFolder?: string }> {
    const res = await fetch('/api/controller/reset', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ confirmation }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Reset failed');
    }
    return data;
  },

  async getHealth(): Promise<HealthStatus> {
    try {
      const res = await fetch('/api/health');
      if (res.ok) return await res.json();
    } catch {
      // Fallback
    }

    const fallbackRes = await fetch('/api/controller/health', { headers: getAuthHeaders() });
    if (!fallbackRes.ok) {
      throw new Error('Failed to retrieve system health');
    }
    return fallbackRes.json();
  },

  // Page Access Control
  async getPageAccessStatus(page: string): Promise<{
    settings: any;
    is_restricted: boolean;
    message: string;
  }> {
    try {
      const res = await fetch(`/api/public/page-access-status?page=${encodeURIComponent(page)}`);
      if (!res.ok) return { settings: null, is_restricted: false, message: '' };
      return res.json();
    } catch {
      return { settings: null, is_restricted: false, message: '' };
    }
  },

  async updatePageAccess(settings: any): Promise<{ success: boolean; settings: any }> {
    const res = await fetch('/api/controller/settings/page-access', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(settings),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Failed to update page access settings');
    }
    return data;
  },

  // Telemetry Heartbeat
  async sendHeartbeat(sessionId: string, page: string): Promise<void> {
    try {
      await fetch('/api/public/telemetry/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, page }),
      });
    } catch {
      // Silent telemetry catch
    }
  },

  async getVisitorAnalytics(): Promise<any> {
    const res = await fetch('/api/public/telemetry/analytics');
    if (!res.ok) throw new Error('Failed to fetch visitor analytics');
    return res.json();
  },

  // Self-Registration
  async registerParticipant(data: {
    name: string;
    external_id?: string;
    type: string;
    designation?: string;
  }): Promise<{ success: boolean; message: string }> {
    const res = await fetch('/api/public/participants/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (!res.ok || !result.success) {
      throw new Error(result.message || 'Registration request failed.');
    }
    return result;
  },

  async getRegistrations(): Promise<{ requests: any[] }> {
    const res = await fetch('/api/controller/registrations', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch registrations');
    return res.json();
  },

  async reviewRegistration(
    id: string,
    action: 'approve' | 'reject',
    notes?: string
  ): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`/api/controller/registrations/${id}/review`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ action, notes }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || `Failed to ${action} registration`);
    }
    return data;
  },

  async batchReviewRegistrations(
    action: 'approve' | 'reject',
    requestIds?: string[]
  ): Promise<{ success: boolean; count: number; message: string }> {
    const res = await fetch('/api/controller/registrations/batch-review', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ action, request_ids: requestIds }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || `Failed to batch ${action} registrations`);
    }
    return data;
  },

  async verifyParticipantEligibility(
    id: string | null | undefined,
    name: string,
    type: string | undefined,
    eligible: number
  ): Promise<{ success: boolean; message: string }> {
    const res = await fetch('/api/controller/participants/verify', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ id, name, type, eligible }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Failed to update participant verification status');
    }
    return data;
  },

  // Safe Database Maintenance
  async truncateDatabase(confirmation: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch('/api/controller/db/truncate', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ confirmation }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Database truncation failed.');
    }
    return data;
  },

  async getDbStatus(): Promise<any> {
    const res = await fetch('/api/controller/db/status', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to check database status');
    return res.json();
  },

  async importParticipants(
    participants: any[]
  ): Promise<{ success: boolean; inserted: number; errors: number }> {
    const res = await fetch('/api/controller/participants/import', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ participants }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Participant import failed.');
    }
    return data;
  },

  // Excel Seeder
  async getExcelSeedPreview(): Promise<{
    success: boolean;
    data: any;
    dbStatus: { connected: boolean; current_participants: number; is_empty: boolean };
    message?: string;
  }> {
    const res = await fetch('/api/controller/seed/preview', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to read root Excel file');
    return data;
  },

  async parseUploadedExcel(
    base64Data: string,
    fileName: string
  ): Promise<{
    success: boolean;
    data: any;
    dbStatus: { connected: boolean; current_participants: number; is_empty: boolean };
    message?: string;
  }> {
    const res = await fetch('/api/controller/seed/parse-upload', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ base64Data, fileName }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to parse uploaded Excel file');
    return data;
  },

  async commitExcelSeed(
    rows: any[],
    mode: 'append' | 'replace' = 'append'
  ): Promise<{
    success: boolean;
    inserted: number;
    updated: number;
    skipped: number;
    errors: number;
    message: string;
  }> {
    const res = await fetch('/api/controller/seed/commit', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ rows, mode }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Failed to upload participants to database');
    return data;
  },
};
