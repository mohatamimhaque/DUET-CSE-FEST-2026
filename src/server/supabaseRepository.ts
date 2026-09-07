import { getSupabaseClient, isSupabaseConfigured } from './supabase.ts';
import {
  Participant,
  WinnerResult,
  IgnoredCandidate,
  SessionState,
  PageAccessSettings,
  RegistrationRequest,
  ParticipantEditRequest,
  VisitorAnalytics,
} from '../types.ts';

// In-memory fallback if Supabase is pending configuration
// CRITICAL MANDATE: Zero demo data! Starts strictly empty.
let inMemoryParticipants: Participant[] = [];
let inMemoryResults: WinnerResult[] = [];
let inMemoryIgnored: IgnoredCandidate[] = [];
let inMemoryRegistrations: RegistrationRequest[] = [];
let inMemoryEditRequests: ParticipantEditRequest[] = [];
let inMemorySession: SessionState = {
  event: 'DUET CSE Fest 2026',
  status: 'READY',
  total_winners: 10,
  completed_winners: 0,
  next_serial: 1,
  current_candidate: null,
  last_action: 'INITIALIZED',
  updated_at: new Date().toISOString(),
  is_db_empty: true,
};
let inMemoryPageAccess: PageAccessSettings = {
  audience: true,
  participants: true,
  health: true,
  results: true,
  self_registration: true,
  allow_participant_edit: true,
  allowed_edit_series: ['20', '21', '22', '23', '24'],
  restriction_message: 'This page is temporarily restricted by the event administrator. Please stay tuned.',
};

// Live visitor session tracking in memory cache with Supabase sync
interface ActiveVisitor {
  id: string;
  ip: string;
  userAgent: string;
  page: string;
  lastHeartbeat: number;
}
const activeVisitors = new Map<string, ActiveVisitor>();

export const supabaseRepository = {
  /**
   * Check if participant pool in database is completely empty
   */
  async isDbEmpty(): Promise<boolean> {
    const client = getSupabaseClient();
    if (!client) {
      return inMemoryParticipants.length === 0;
    }

    try {
      const { count, error } = await client
        .from('cse_fest_2026_participants')
        .select('*', { count: 'exact', head: true });

      if (error) {
        console.warn('[SupabaseRepo] isDbEmpty query error, checking fallback:', error.message);
        return inMemoryParticipants.length === 0;
      }
      return (count || 0) === 0;
    } catch {
      return inMemoryParticipants.length === 0;
    }
  },

  /**
   * Fetch all participants from cse_fest_2026_participants
   * STRICT MANDATE: Never seed demo data. If empty, return [].
   */
  async getParticipants(): Promise<Participant[]> {
    const client = getSupabaseClient();
    if (!client) {
      return inMemoryParticipants;
    }

    try {
      const { data, error } = await client
        .from('cse_fest_2026_participants')
        .select('external_id, name, type, designation, eligible')
        .order('name', { ascending: true });

      if (error) {
        console.error('[SupabaseRepo] Error fetching participants:', error.message);
        return inMemoryParticipants;
      }

      if (!data || data.length === 0) {
        // DB is empty, do NOT add demo data!
        return [];
      }

      const participants: Participant[] = data.map((row: any) => ({
        id: row.external_id || null,
        name: row.name,
        type: row.type?.toLowerCase() as 'student' | 'faculty' | 'guest',
        designation: row.designation || null,
        eligible: Number(row.eligible ?? 1),
      }));

      // Cache locally for instant read operations
      inMemoryParticipants = participants;
      return participants;
    } catch (err: any) {
      console.error('[SupabaseRepo] Exception fetching participants:', err.message);
      return inMemoryParticipants;
    }
  },

  /**
   * Mark participant as ineligible (eligible = 0)
   */
  async markParticipantIneligible(candidate: { id?: string | null; name: string; type: string }): Promise<void> {
    // 1. Update in-memory
    const idx = inMemoryParticipants.findIndex((p) => {
      if (candidate.id && p.id) {
        return String(p.id).trim().toLowerCase() === String(candidate.id).trim().toLowerCase();
      }
      return (
        p.name.trim().toLowerCase() === candidate.name.trim().toLowerCase() &&
        p.type.toLowerCase() === candidate.type.toLowerCase()
      );
    });

    if (idx !== -1) {
      inMemoryParticipants[idx].eligible = 0;
    }

    // 2. Update Supabase
    const client = getSupabaseClient();
    if (!client) return;

    try {
      if (candidate.id) {
        await client
          .from('cse_fest_2026_participants')
          .update({ eligible: 0, updated_at: new Date().toISOString() })
          .ilike('external_id', candidate.id.trim());
      } else {
        await client
          .from('cse_fest_2026_participants')
          .update({ eligible: 0, updated_at: new Date().toISOString() })
          .ilike('name', candidate.name.trim())
          .eq('type', candidate.type.toLowerCase());
      }
    } catch (err: any) {
      console.error('[SupabaseRepo] Failed to mark participant ineligible in Supabase:', err.message);
    }
  },

  /**
   * Restore all participants to eligible = 1
   */
  async restoreAllEligibility(): Promise<void> {
    for (const p of inMemoryParticipants) {
      p.eligible = 1;
    }

    const client = getSupabaseClient();
    if (!client) return;

    try {
      await client
        .from('cse_fest_2026_participants')
        .update({ eligible: 1, updated_at: new Date().toISOString() })
        .gte('eligible', 0);
    } catch (err: any) {
      console.error('[SupabaseRepo] Failed to restore eligibility in Supabase:', err.message);
    }
  },

  /**
   * Update participant eligibility (eligible = 1 or 0)
   */
  async setParticipantEligibility(
    candidate: { id?: string | null; name: string; type?: string },
    eligible: number
  ): Promise<{ success: boolean; message: string }> {
    const normName = candidate.name.trim().toLowerCase();
    const normId = candidate.id ? String(candidate.id).trim().toLowerCase() : null;

    // 1. Update in-memory
    const idx = inMemoryParticipants.findIndex((p) => {
      if (normId && p.id) {
        return String(p.id).trim().toLowerCase() === normId;
      }
      return (
        p.name.trim().toLowerCase() === normName &&
        (!candidate.type || p.type.toLowerCase() === candidate.type.toLowerCase())
      );
    });

    if (idx !== -1) {
      inMemoryParticipants[idx].eligible = eligible;
    }

    // 2. Update Supabase
    const client = getSupabaseClient();
    if (client) {
      try {
        if (candidate.id) {
          await client
            .from('cse_fest_2026_participants')
            .update({ eligible, updated_at: new Date().toISOString() })
            .ilike('external_id', candidate.id.trim());
        } else {
          await client
            .from('cse_fest_2026_participants')
            .update({ eligible, updated_at: new Date().toISOString() })
            .ilike('name', candidate.name.trim());
        }
      } catch (err: any) {
        console.error('[SupabaseRepo] Failed to set participant eligibility in Supabase:', err.message);
      }
    }

    return {
      success: true,
      message: `Participant ${candidate.name} is now ${eligible === 1 ? 'verified & eligible' : 'marked ineligible'}.`,
    };
  },

  /**
   * Batch insert or import participants
   */
  async importParticipants(
    participants: Array<{ id?: string | null; name: string; type: string; designation?: string | null }>
  ): Promise<{ inserted: number; errors: number }> {
    if (!participants || participants.length === 0) {
      return { inserted: 0, errors: 0 };
    }

    let inserted = 0;
    let errors = 0;

    const formatted = participants.map((p) => ({
      external_id: p.id ? String(p.id).trim() : null,
      name: p.name.trim(),
      type: p.type.toLowerCase(),
      designation: p.designation?.trim() || (p.type.toLowerCase() === 'student' ? 'Student' : null),
      department: 'CSE',
      eligible: 1,
      updated_at: new Date().toISOString(),
    }));

    const client = getSupabaseClient();
    if (client) {
      try {
        const { error } = await client.from('cse_fest_2026_participants').insert(formatted);
        if (error) {
          console.error('[SupabaseRepo] Import batch error:', error.message);
          errors = formatted.length;
        } else {
          inserted = formatted.length;
        }
      } catch (err: any) {
        console.error('[SupabaseRepo] Import batch exception:', err.message);
        errors = formatted.length;
      }
    }

    // Update in-memory pool
    for (const item of formatted) {
      inMemoryParticipants.push({
        id: item.external_id,
        name: item.name,
        type: item.type as 'student' | 'faculty' | 'guest',
        designation: item.designation,
        eligible: 1,
      });
    }

    return { inserted, errors };
  },

  /**
   * Read singleton raffle session state
   */
  async getSession(): Promise<SessionState> {
    const client = getSupabaseClient();
    if (!client) {
      inMemorySession.is_db_empty = inMemoryParticipants.length === 0;
      return inMemorySession;
    }

    try {
      const { data, error } = await client
        .from('cse_fest_2026_raffle_sessions')
        .select('*')
        .eq('id', 'default_session')
        .maybeSingle();

      if (error || !data) {
        inMemorySession.is_db_empty = inMemoryParticipants.length === 0;
        return inMemorySession;
      }

      const isEmpty = await this.isDbEmpty();

      const session: SessionState = {
        event: data.event_name || 'DUET CSE Fest 2026',
        status: data.status,
        total_winners: data.total_winners,
        completed_winners: data.completed_winners,
        next_serial: data.next_serial,
        current_candidate: data.current_candidate,
        last_action: data.last_action,
        updated_at: data.updated_at,
        is_db_empty: isEmpty,
      };

      inMemorySession = session;

      // Update cached page access
      inMemoryPageAccess = {
        audience: data.access_audience_enabled ?? true,
        participants: data.access_participants_enabled ?? true,
        health: data.access_health_enabled ?? true,
        results: data.access_results_enabled ?? true,
        restriction_message:
          data.access_restriction_message ||
          'This page is temporarily restricted by the event administrator. Please stay tuned.',
      };

      return session;
    } catch {
      inMemorySession.is_db_empty = inMemoryParticipants.length === 0;
      return inMemorySession;
    }
  },

  /**
   * Save session state
   */
  async saveSession(session: SessionState): Promise<void> {
    inMemorySession = { ...session };

    const client = getSupabaseClient();
    if (!client) return;

    try {
      await client
        .from('cse_fest_2026_raffle_sessions')
        .upsert({
          id: 'default_session',
          event_name: session.event,
          status: session.status,
          total_winners: session.total_winners,
          completed_winners: session.completed_winners,
          next_serial: session.next_serial,
          current_candidate: session.current_candidate,
          last_action: session.last_action,
          updated_at: session.updated_at,
        });
    } catch (err: any) {
      console.error('[SupabaseRepo] Failed to save session to Supabase:', err.message);
    }
  },

  /**
   * Get all official winners and ignored candidates
   */
  async getResults(): Promise<{ results: WinnerResult[]; ignored: IgnoredCandidate[] }> {
    const client = getSupabaseClient();
    if (!client) {
      return { results: inMemoryResults, ignored: inMemoryIgnored };
    }

    try {
      const [winnersRes, ignoredRes] = await Promise.all([
        client
          .from('cse_fest_2026_winner_results')
          .select('serial, type, external_id, name, designation, status, drawn_at')
          .order('serial', { ascending: true }),
        client
          .from('cse_fest_2026_ignored_candidates')
          .select('type, external_id, name, designation, reason, status, drawn_at')
          .order('drawn_at', { ascending: false }),
      ]);

      const winners: WinnerResult[] = (winnersRes.data || []).map((w: any) => ({
        serial: w.serial,
        type: w.type as any,
        id: w.external_id || null,
        name: w.name,
        designation: w.designation || null,
        status: 'winner',
        drawn_at: w.drawn_at,
      }));

      const ignored: IgnoredCandidate[] = (ignoredRes.data || []).map((i: any) => ({
        serial: null,
        type: i.type as any,
        id: i.external_id || null,
        name: i.name,
        designation: i.designation || null,
        status: 'ignored',
        reason: i.reason || 'absent',
        drawn_at: i.drawn_at,
      }));

      inMemoryResults = winners;
      inMemoryIgnored = ignored;

      return { results: winners, ignored };
    } catch {
      return { results: inMemoryResults, ignored: inMemoryIgnored };
    }
  },

  /**
   * Add a confirmed winner
   */
  async saveWinner(winner: WinnerResult, cryptoProof?: any): Promise<void> {
    inMemoryResults.push(winner);

    const client = getSupabaseClient();
    if (!client) return;

    try {
      await client.from('cse_fest_2026_winner_results').insert({
        serial: winner.serial,
        type: winner.type,
        external_id: winner.id,
        name: winner.name,
        designation: winner.designation,
        status: 'winner',
        crypto_hash: cryptoProof ? JSON.stringify(cryptoProof) : null,
        drawn_at: winner.drawn_at || new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('[SupabaseRepo] Failed to insert winner in Supabase:', err.message);
    }
  },

  /**
   * Add an ignored candidate
   */
  async saveIgnored(candidate: IgnoredCandidate): Promise<void> {
    inMemoryIgnored.push(candidate);

    const client = getSupabaseClient();
    if (!client) return;

    try {
      await client.from('cse_fest_2026_ignored_candidates').insert({
        type: candidate.type,
        external_id: candidate.id,
        name: candidate.name,
        designation: candidate.designation,
        reason: candidate.reason || 'absent',
        status: 'ignored',
        drawn_at: candidate.drawn_at || new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('[SupabaseRepo] Failed to insert ignored candidate in Supabase:', err.message);
    }
  },

  /**
   * Clear results table on session reset
   */
  async clearResults(): Promise<void> {
    inMemoryResults = [];
    inMemoryIgnored = [];

    const client = getSupabaseClient();
    if (!client) return;

    try {
      await Promise.all([
        client.from('cse_fest_2026_winner_results').delete().gte('serial', 0),
        client.from('cse_fest_2026_ignored_candidates').delete().not('id', 'is', null),
      ]);
    } catch (err: any) {
      console.error('[SupabaseRepo] Failed to clear results in Supabase:', err.message);
    }
  },

  /**
   * Append audit log
   */
  async appendAudit(
    action: string,
    details?: any,
    reqMeta?: { ip?: string; userAgent?: string }
  ): Promise<void> {
    const client = getSupabaseClient();
    if (!client) return;

    try {
      await client.from('cse_fest_2026_audit_logs').insert({
        action,
        details: details || {},
        ip_address: reqMeta?.ip || null,
        user_agent: reqMeta?.userAgent || null,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      console.warn('[SupabaseRepo] Audit insert skipped/failed:', err.message);
    }
  },

  /**
   * Get recent audit logs
   */
  async getAuditLogs(limit: number = 50): Promise<any[]> {
    const client = getSupabaseClient();
    if (!client) return [];

    try {
      const { data } = await client
        .from('cse_fest_2026_audit_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(limit);
      return data || [];
    } catch {
      return [];
    }
  },

  /**
   * Page Access Controls
   */
  async getPageAccessSettings(): Promise<PageAccessSettings> {
    const client = getSupabaseClient();
    if (!client) {
      return inMemoryPageAccess;
    }

    try {
      const { data } = await client
        .from('cse_fest_2026_raffle_sessions')
        .select('*')
        .eq('id', 'default_session')
        .maybeSingle();

      if (data) {
        let parsedSeries = inMemoryPageAccess.allowed_edit_series ?? ['20', '21', '22', '23', '24'];
        if (Array.isArray(data.allowed_edit_series)) {
          parsedSeries = data.allowed_edit_series;
        } else if (typeof data.allowed_edit_series === 'string') {
          try {
            const parsed = JSON.parse(data.allowed_edit_series);
            if (Array.isArray(parsed)) parsedSeries = parsed;
          } catch {
            parsedSeries = data.allowed_edit_series.split(',').map((s: string) => s.trim()).filter(Boolean);
          }
        }

        inMemoryPageAccess = {
          audience: data.access_audience_enabled ?? true,
          participants: data.access_participants_enabled ?? true,
          health: data.access_health_enabled ?? true,
          results: data.access_results_enabled ?? true,
          self_registration: data.allow_self_registration ?? inMemoryPageAccess.self_registration ?? true,
          allow_participant_edit: data.allow_participant_edit ?? inMemoryPageAccess.allow_participant_edit ?? true,
          allowed_edit_series: parsedSeries,
          restriction_message:
            data.access_restriction_message ||
            'This page is temporarily restricted by the event administrator. Please stay tuned.',
        };
      }
      return inMemoryPageAccess;
    } catch {
      return inMemoryPageAccess;
    }
  },

  async updatePageAccessSettings(settings: Partial<PageAccessSettings>): Promise<PageAccessSettings> {
    inMemoryPageAccess = {
      ...inMemoryPageAccess,
      ...settings,
    };

    const client = getSupabaseClient();
    if (client) {
      const basePayload = {
        access_audience_enabled: inMemoryPageAccess.audience,
        access_participants_enabled: inMemoryPageAccess.participants,
        access_health_enabled: inMemoryPageAccess.health,
        access_results_enabled: inMemoryPageAccess.results,
        access_restriction_message: inMemoryPageAccess.restriction_message,
        allow_self_registration: inMemoryPageAccess.self_registration !== false,
        updated_at: new Date().toISOString(),
      };

      try {
        // Attempt full update including participant edit options
        await client
          .from('cse_fest_2026_raffle_sessions')
          .update({
            ...basePayload,
            allow_participant_edit: inMemoryPageAccess.allow_participant_edit !== false,
            allowed_edit_series: inMemoryPageAccess.allowed_edit_series || ['20', '21', '22', '23', '24'],
          })
          .eq('id', 'default_session');
      } catch (err: any) {
        // Graceful fallback if allow_participant_edit columns not yet added to remote table
        try {
          await client
            .from('cse_fest_2026_raffle_sessions')
            .update(basePayload)
            .eq('id', 'default_session');
        } catch (innerErr: any) {
          console.warn('[SupabaseRepo] Failed to update session settings in Supabase:', innerErr.message);
        }
      }
    }

    return inMemoryPageAccess;
  },

  /**
   * Self-Registration Queue Management
   */
  async createRegistrationRequest(data: {
    external_id?: string | null;
    name: string;
    type: string;
    designation?: string | null;
  }): Promise<{ success: boolean; message: string; id?: string }> {
    const normName = data.name.trim();
    const normType = data.type.toLowerCase();
    const normId = data.external_id ? data.external_id.trim() : null;
    const normDesig = normType === 'student' ? 'Student' : data.designation?.trim() || null;

    // Check duplicate in active participants
    const allParticipants = await this.getParticipants();
    const existsInParticipants = allParticipants.some((p) => {
      if (normId && p.id) {
        return p.id.trim().toLowerCase() === normId.toLowerCase();
      }
      return (
        p.name.trim().toLowerCase() === normName.toLowerCase() &&
        p.type.toLowerCase() === normType.toLowerCase()
      );
    });

    if (existsInParticipants) {
      return {
        success: false,
        message: normId
          ? `A participant with Student ID / Roll "${normId}" is already registered in the official database.`
          : `A participant named "${normName}" is already registered.`,
      };
    }

    const client = getSupabaseClient();
    if (client) {
      try {
        const { data: inserted, error } = await client
          .from('cse_fest_2026_participant_registration_requests')
          .insert({
            external_id: normId,
            name: normName,
            type: normType,
            designation: normDesig,
            department: 'CSE',
            status: 'pending',
          })
          .select('id')
          .single();

        if (error) {
          return { success: false, message: error.message };
        }
        return {
          success: true,
          message: 'Your registration request has been submitted for official committee verification.',
          id: inserted?.id,
        };
      } catch (err: any) {
        return { success: false, message: err.message };
      }
    }

    // In-memory fallback
    const newReq: RegistrationRequest = {
      id: `req_${Date.now()}`,
      external_id: normId,
      name: normName,
      type: normType as any,
      designation: normDesig,
      department: 'CSE',
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    inMemoryRegistrations.push(newReq);

    return {
      success: true,
      message: 'Registration request recorded for review.',
      id: newReq.id,
    };
  },

  async getRegistrationRequests(): Promise<RegistrationRequest[]> {
    const client = getSupabaseClient();
    if (!client) {
      return inMemoryRegistrations;
    }

    try {
      const { data } = await client
        .from('cse_fest_2026_participant_registration_requests')
        .select('*')
        .order('created_at', { ascending: false });

      return (data || []).map((row: any) => ({
        id: row.id,
        external_id: row.external_id,
        name: row.name,
        type: row.type,
        designation: row.designation,
        department: row.department || 'CSE',
        status: row.status,
        review_notes: row.review_notes,
        reviewed_by: row.reviewed_by,
        reviewed_at: row.reviewed_at,
        created_at: row.created_at,
      }));
    } catch {
      return inMemoryRegistrations;
    }
  },

  async reviewRegistrationRequest(
    requestId: string,
    action: 'approve' | 'reject',
    reviewerName: string = 'Admin',
    notes?: string
  ): Promise<{ success: boolean; message: string }> {
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data: request } = await client
          .from('cse_fest_2026_participant_registration_requests')
          .select('*')
          .eq('id', requestId)
          .single();

        if (!request) {
          return { success: false, message: 'Request not found.' };
        }

        if (action === 'approve') {
          // Add to official participants
          await client.from('cse_fest_2026_participants').insert({
            external_id: request.external_id,
            name: request.name,
            type: request.type,
            designation: request.designation,
            department: request.department || 'CSE',
            eligible: 1,
          });

          await client
            .from('cse_fest_2026_participant_registration_requests')
            .update({
              status: 'approved',
              reviewed_by: reviewerName,
              reviewed_at: new Date().toISOString(),
              review_notes: notes || 'Approved by controller',
            })
            .eq('id', requestId);

          // Update local cache
          inMemoryParticipants.push({
            id: request.external_id,
            name: request.name,
            type: request.type,
            designation: request.designation,
            eligible: 1,
          });

          return { success: true, message: `Participant ${request.name} approved and added to active draw pool.` };
        } else {
          await client
            .from('cse_fest_2026_participant_registration_requests')
            .update({
              status: 'rejected',
              reviewed_by: reviewerName,
              reviewed_at: new Date().toISOString(),
              review_notes: notes || 'Rejected by controller',
            })
            .eq('id', requestId);

          return { success: true, message: `Registration request for ${request.name} was rejected.` };
        }
      } catch (err: any) {
        return { success: false, message: err.message };
      }
    }

    const item = inMemoryRegistrations.find((r) => r.id === requestId);
    if (!item) return { success: false, message: 'Request not found in local queue.' };

    item.status = action === 'approve' ? 'approved' : 'rejected';
    item.reviewed_by = reviewerName;
    item.reviewed_at = new Date().toISOString();
    item.review_notes = notes || '';

    if (action === 'approve') {
      inMemoryParticipants.push({
        id: item.external_id,
        name: item.name,
        type: item.type,
        designation: item.designation,
        eligible: 1,
      });
    }

    return { success: true, message: `Request updated to ${action}d.` };
  },

  /**
   * Batch review pending registration requests
   */
  async batchReviewRegistrationRequests(
    action: 'approve' | 'reject',
    reviewerName: string = 'Admin',
    requestIds?: string[]
  ): Promise<{ success: boolean; count: number; message: string }> {
    const requests = await this.getRegistrationRequests();
    const pendingTargets = requests.filter(
      (r) => r.status === 'pending' && (!requestIds || requestIds.includes(r.id))
    );

    let count = 0;
    for (const req of pendingTargets) {
      await this.reviewRegistrationRequest(req.id, action, reviewerName, `Batch ${action}d by controller`);
      count++;
    }

    return {
      success: true,
      count,
      message: `Successfully ${action}d ${count} registration request(s).`,
    };
  },

  /**
   * Participant Name Edit & Verification Flow
   */
  async createEditRequest(data: {
    student_id: string;
    current_name?: string;
    requested_name: string;
    reason?: string;
  }): Promise<{ success: boolean; message: string; id?: string }> {
    const pageAccess = await this.getPageAccessSettings();
    if (pageAccess.allow_participant_edit === false) {
      return {
        success: false,
        message: 'Student name correction requests are currently closed by the event controller.',
      };
    }

    const studentId = String(data.student_id || '').trim();
    const reqName = String(data.requested_name || '').trim();
    const currName = data.current_name ? String(data.current_name).trim() : '';

    if (!studentId) {
      return { success: false, message: 'Student ID / Roll number is required.' };
    }
    if (!reqName) {
      return { success: false, message: 'Corrected name is required.' };
    }
    if (reqName.length < 2) {
      return { success: false, message: 'Name must be at least 2 characters.' };
    }

    // Lookup participant in official pool
    const allParticipants = await this.getParticipants();
    const participant = allParticipants.find(
      (p) =>
        (p.id && p.id.trim().toLowerCase() === studentId.toLowerCase()) ||
        (currName && p.name.trim().toLowerCase() === currName.toLowerCase())
    );

    if (!participant) {
      return {
        success: false,
        message: `Student with ID / Roll "${studentId}" was not found in the official participant directory.`,
      };
    }

    // Verify participant type is strictly student
    if (participant.type.toLowerCase() !== 'student') {
      return {
        success: false,
        message: 'Name edits are restricted exclusively to students. Faculty and guests cannot request name edits.',
      };
    }

    // Extract series from first 2 digits of student_id
    const rawId = (participant.id || studentId).trim();
    const seriesMatch = rawId.match(/^\d{2}/);
    const series = seriesMatch ? seriesMatch[0] : rawId.slice(0, 2);

    // Verify series permissions set by controller
    const allowedSeries = pageAccess.allowed_edit_series || [];
    const isAllAllowed =
      allowedSeries.length === 0 || allowedSeries.includes('*') || allowedSeries.includes('all');
    if (!isAllAllowed && !allowedSeries.includes(series)) {
      return {
        success: false,
        message: `Name editing is not currently permitted for Series "${series}". Allowed series: ${allowedSeries.join(', ')}. Please contact the event committee.`,
      };
    }

    if (participant.name.trim().toLowerCase() === reqName.toLowerCase()) {
      return {
        success: false,
        message: 'The requested name is identical to the current registered name.',
      };
    }

    // Check if an edit request is already pending for this student
    const existing = await this.getEditRequests();
    const hasPending = existing.some(
      (r) =>
        r.status === 'pending' &&
        ((r.student_id && r.student_id.toLowerCase() === studentId.toLowerCase()) ||
          (r.current_name && r.current_name.toLowerCase() === participant.name.toLowerCase()))
    );

    if (hasPending) {
      return {
        success: false,
        message: `A name edit request for Student ID "${studentId}" is already pending review by the event controller.`,
      };
    }

    const client = getSupabaseClient();
    if (client) {
      try {
        const { data: inserted, error } = await client
          .from('cse_fest_2026_participant_edit_requests')
          .insert({
            external_id: participant.id || studentId,
            current_name: participant.name,
            requested_name: reqName,
            type: 'student',
            series: series,
            reason: data.reason?.trim() || null,
            status: 'pending',
          })
          .select('id')
          .single();

        if (!error && inserted?.id) {
          await this.appendAudit('PARTICIPANT_EDIT_REQUESTED', {
            id: inserted.id,
            student_id: participant.id || studentId,
            series,
            current_name: participant.name,
            requested_name: reqName,
          });
          return {
            success: true,
            message: `Your name correction request for "${reqName}" has been submitted for controller verification.`,
            id: inserted.id,
          };
        }
      } catch (err: any) {
        console.warn(
          '[SupabaseRepo] Failed to insert to cse_fest_2026_participant_edit_requests, using in-memory fallback:',
          err.message
        );
      }
    }

    // In-memory fallback
    const newReq: ParticipantEditRequest = {
      id: `edit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      participant_id: participant.id || studentId,
      student_id: participant.id || studentId,
      current_name: participant.name,
      requested_name: reqName,
      type: 'student',
      series: series,
      reason: data.reason?.trim() || null,
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    inMemoryEditRequests.unshift(newReq);

    await this.appendAudit('PARTICIPANT_EDIT_REQUESTED', {
      id: newReq.id,
      student_id: newReq.student_id,
      series,
      current_name: newReq.current_name,
      requested_name: reqName,
    });

    return {
      success: true,
      message: `Your name correction request for "${reqName}" has been submitted for controller verification.`,
      id: newReq.id,
    };
  },

  async getEditRequests(): Promise<ParticipantEditRequest[]> {
    const client = getSupabaseClient();
    if (!client) {
      return inMemoryEditRequests;
    }

    try {
      const { data, error } = await client
        .from('cse_fest_2026_participant_edit_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (error || !data) {
        return inMemoryEditRequests;
      }

      return data.map((row: any) => ({
        id: row.id,
        participant_id: row.external_id,
        student_id: row.external_id,
        current_name: row.current_name,
        requested_name: row.requested_name,
        type: row.type || 'student',
        series: row.series,
        reason: row.reason,
        status: row.status,
        reviewed_by: row.reviewed_by,
        reviewed_at: row.reviewed_at,
        review_notes: row.review_notes,
        created_at: row.created_at,
      }));
    } catch {
      return inMemoryEditRequests;
    }
  },

  async reviewEditRequest(
    requestId: string,
    action: 'approve' | 'reject',
    reviewerName: string = 'Controller',
    notes?: string
  ): Promise<{ success: boolean; message: string }> {
    const client = getSupabaseClient();
    let request: ParticipantEditRequest | null = null;

    if (client) {
      try {
        const { data } = await client
          .from('cse_fest_2026_participant_edit_requests')
          .select('*')
          .eq('id', requestId)
          .maybeSingle();

        if (data) {
          request = {
            id: data.id,
            participant_id: data.external_id,
            student_id: data.external_id,
            current_name: data.current_name,
            requested_name: data.requested_name,
            type: data.type,
            series: data.series,
            reason: data.reason,
            status: data.status,
            reviewed_by: data.reviewed_by,
            reviewed_at: data.reviewed_at,
            review_notes: data.review_notes,
            created_at: data.created_at,
          };
        }
      } catch {}
    }

    if (!request) {
      request = inMemoryEditRequests.find((r) => r.id === requestId) || null;
    }

    if (!request) {
      return { success: false, message: 'Edit request not found.' };
    }

    if (request.status !== 'pending') {
      return { success: false, message: `Request has already been ${request.status}.` };
    }

    const now = new Date().toISOString();

    if (action === 'approve') {
      // 1. Update official table cse_fest_2026_participants
      if (client) {
        try {
          if (request.student_id) {
            await client
              .from('cse_fest_2026_participants')
              .update({
                name: request.requested_name,
                updated_at: now,
              })
              .ilike('external_id', request.student_id.trim());
          } else {
            await client
              .from('cse_fest_2026_participants')
              .update({
                name: request.requested_name,
                updated_at: now,
              })
              .ilike('name', request.current_name.trim());
          }

          // Also update winner_results and ignored_candidates if this participant was already drawn
          if (request.student_id) {
            await client
              .from('cse_fest_2026_winner_results')
              .update({ name: request.requested_name })
              .ilike('external_id', request.student_id.trim());
            await client
              .from('cse_fest_2026_ignored_candidates')
              .update({ name: request.requested_name })
              .ilike('external_id', request.student_id.trim());
          }
        } catch (err: any) {
          console.error('[SupabaseRepo] Failed to update participant name in Supabase:', err.message);
        }
      }

      // Update in-memory pool
      const idx = inMemoryParticipants.findIndex((p) => {
        if (request?.student_id && p.id) {
          return p.id.trim().toLowerCase() === request.student_id.trim().toLowerCase();
        }
        return p.name.trim().toLowerCase() === request?.current_name.trim().toLowerCase();
      });
      if (idx !== -1) {
        inMemoryParticipants[idx].name = request.requested_name;
      }

      // Update in-memory winners/ignored
      inMemoryResults.forEach((w) => {
        if (request?.student_id && w.id?.trim().toLowerCase() === request.student_id.trim().toLowerCase()) {
          w.name = request.requested_name;
        }
      });
      inMemoryIgnored.forEach((i) => {
        if (request?.student_id && i.id?.trim().toLowerCase() === request.student_id.trim().toLowerCase()) {
          i.name = request.requested_name;
        }
      });
    }

    // Mark edit request as approved or rejected
    if (client) {
      try {
        await client
          .from('cse_fest_2026_participant_edit_requests')
          .update({
            status: action === 'approve' ? 'approved' : 'rejected',
            reviewed_by: reviewerName,
            reviewed_at: now,
            review_notes: notes || null,
          })
          .eq('id', requestId);
      } catch (err: any) {
        console.warn('[SupabaseRepo] Failed to update edit request status in Supabase:', err.message);
      }
    }

    // Update in-memory edit request
    const memReq = inMemoryEditRequests.find((r) => r.id === requestId);
    if (memReq) {
      memReq.status = action === 'approve' ? 'approved' : 'rejected';
      memReq.reviewed_by = reviewerName;
      memReq.reviewed_at = now;
      memReq.review_notes = notes || null;
    }

    await this.appendAudit(
      action === 'approve' ? 'PARTICIPANT_EDIT_APPROVED' : 'PARTICIPANT_EDIT_REJECTED',
      {
        id: requestId,
        student_id: request.student_id,
        current_name: request.current_name,
        requested_name: request.requested_name,
        reviewer: reviewerName,
        notes,
      }
    );

    return {
      success: true,
      message:
        action === 'approve'
          ? `Approved name change for Student ID "${request.student_id}". Participant name updated from "${request.current_name}" to "${request.requested_name}".`
          : `Rejected name change for Student ID "${request.student_id}". Official participant record was not modified.`,
    };
  },

  async batchReviewEditRequests(
    action: 'approve' | 'reject',
    reviewerName: string = 'Controller',
    requestIds?: string[]
  ): Promise<{ success: boolean; count: number; message: string }> {
    const all = await this.getEditRequests();
    const targets = all.filter(
      (r) => r.status === 'pending' && (!requestIds || requestIds.includes(r.id))
    );

    let count = 0;
    for (const req of targets) {
      await this.reviewEditRequest(req.id, action, reviewerName, `Batch ${action}d by controller`);
      count++;
    }

    return {
      success: true,
      count,
      message: `Successfully ${action}d ${count} name edit request(s).`,
    };
  },

  /**
   * Visitor Telemetry & Audience Tracking
   */
  recordVisitorHeartbeat(sessionId: string, ip: string, userAgent: string, page: string): void {
    const now = Date.now();
    activeVisitors.set(sessionId, {
      id: sessionId,
      ip,
      userAgent,
      page,
      lastHeartbeat: now,
    });

    // Cleanup stale visitors (> 15 seconds)
    for (const [id, v] of activeVisitors.entries()) {
      if (now - v.lastHeartbeat > 15000) {
        activeVisitors.delete(id);
      }
    }
  },

  getVisitorAnalytics(): VisitorAnalytics {
    const now = Date.now();
    let activeNow = 0;
    const uniqueIps = new Set<string>();

    for (const v of activeVisitors.values()) {
      if (now - v.lastHeartbeat <= 15000) {
        activeNow++;
        if (v.ip) uniqueIps.add(v.ip);
      }
    }

    return {
      active_now: activeNow,
      total_views: Math.max(activeNow, 1),
      unique_visitors: uniqueIps.size,
      peak_concurrent: Math.max(activeNow, 1),
    };
  },

  /**
   * Database Maintenance: Safe Truncate
   * STRICT SAFETY RULE: Only touches tables with prefix cse_fest_2026_*
   */
  async truncateFestTables(confirmationText: string): Promise<{ success: boolean; message: string }> {
    if (confirmationText !== 'TRUNCATE_CSE_FEST_2026') {
      return {
        success: false,
        message: 'CONFIRMATION_FAILED: Must supply exact confirmation code "TRUNCATE_CSE_FEST_2026".',
      };
    }

    const client = getSupabaseClient();
    if (client) {
      try {
        await Promise.all([
          client.from('cse_fest_2026_winner_results').delete().gte('serial', 0),
          client.from('cse_fest_2026_ignored_candidates').delete().not('id', 'is', null),
          client.from('cse_fest_2026_participants').delete().not('id', 'is', null),
          client.from('cse_fest_2026_participant_registration_requests').delete().not('id', 'is', null),
          client.from('cse_fest_2026_participant_edit_requests').delete().not('id', 'is', null),
          client.from('cse_fest_2026_audit_logs').delete().gte('id', 0),
          client.from('cse_fest_2026_audience_timeline_snapshots').delete().gte('serial', 0),
        ]);

        // Reset default session
        await client
          .from('cse_fest_2026_raffle_sessions')
          .update({
            status: 'READY',
            completed_winners: 0,
            next_serial: 1,
            current_candidate: null,
            last_action: 'TABLES_TRUNCATED',
            updated_at: new Date().toISOString(),
          })
          .eq('id', 'default_session');
      } catch (err: any) {
        console.error('[SupabaseRepo] Truncate error in Supabase:', err.message);
      }
    }

    inMemoryParticipants = [];
    inMemoryResults = [];
    inMemoryIgnored = [];
    inMemoryRegistrations = [];
    inMemoryEditRequests = [];
    inMemorySession = {
      event: 'DUET CSE Fest 2026',
      status: 'READY',
      total_winners: 10,
      completed_winners: 0,
      next_serial: 1,
      current_candidate: null,
      last_action: 'TABLES_TRUNCATED',
      updated_at: new Date().toISOString(),
      is_db_empty: true,
    };

    return {
      success: true,
      message: 'All cse_fest_2026_* tables successfully cleared. Database is now empty and ready for fresh imports.',
    };
  },
};
