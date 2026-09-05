// server.ts
import express from "express";
import http from "http";
import path2 from "path";
import fs2 from "fs";
import crypto3 from "crypto";
import cookieParser from "cookie-parser";

// src/server/config.ts
import dotenv from "dotenv";
dotenv.config();
function parseBoolean(val, defaultValue) {
  if (val === void 0 || val.trim() === "") {
    return defaultValue;
  }
  const lower = val.trim().toLowerCase();
  if (lower === "true" || lower === "1") return true;
  if (lower === "false" || lower === "0") return false;
  return defaultValue;
}
function parsePositiveInt(val, defaultValue, allowZero = false) {
  if (val === void 0 || val.trim() === "") {
    return defaultValue;
  }
  const parsed = parseInt(val.trim(), 10);
  if (isNaN(parsed)) {
    return defaultValue;
  }
  if (allowZero && parsed < 0) {
    return defaultValue;
  }
  if (!allowZero && parsed <= 0) {
    return defaultValue;
  }
  return parsed;
}
function loadAndValidateConfig() {
  const EVENT_NAME = process.env.EVENT_NAME?.trim() || "DUET CSE Fest 2026";
  const TOTAL_WINNERS = parsePositiveInt(process.env.TOTAL_WINNERS, 10);
  const DRAW_COUNTDOWN_SECONDS = parsePositiveInt(process.env.DRAW_COUNTDOWN_SECONDS, 5, true);
  const SHUFFLE_PASSES = parsePositiveInt(process.env.SHUFFLE_PASSES, 7);
  const WINNER_REVEAL_SECONDS = parsePositiveInt(process.env.WINNER_REVEAL_SECONDS, 3);
  const NAME_ROLL_DURATION_MS = parsePositiveInt(process.env.NAME_ROLL_DURATION_MS, 3e3);
  const BEEP_ENABLED = parseBoolean(process.env.BEEP_ENABLED, true);
  const CONFETTI_ENABLED = parseBoolean(process.env.CONFETTI_ENABLED, true);
  const CONTROLLER_USERNAME = process.env.CONTROLLER_USERNAME?.trim() || "admin";
  const CONTROLLER_PASSWORD = process.env.CONTROLLER_PASSWORD?.trim() || "duetcsefest2026password";
  const SECRET_KEY = process.env.SECRET_KEY?.trim() || "duet-cse-fest-raffle-secure-key-2026-very-strong";
  const SUPABASE_URL = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "https://toyocrdimcvkmiidposk.supabase.co";
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRveW9jcmRpbWN2a21paWRwb3NrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODE3MzA0MCwiZXhwIjoyMDkzNzQ5MDQwfQ.SSV-Cfid5yjv4JqEJNxbMdXSC8U7k4xMGNnqRGuacmU";
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRveW9jcmRpbWN2a21paWRwb3NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNzMwNDAsImV4cCI6MjA5Mzc0OTA0MH0.tcrMtLApEH13VotkJTsNqg2c0FbTwFhoUSIwzxfNF3U";
  console.log(`[Config] Loaded config for event: "${EVENT_NAME}" with ${TOTAL_WINNERS} total winners target.`);
  return {
    EVENT_NAME,
    TOTAL_WINNERS,
    DRAW_COUNTDOWN_SECONDS,
    SHUFFLE_PASSES,
    WINNER_REVEAL_SECONDS,
    NAME_ROLL_DURATION_MS,
    BEEP_ENABLED,
    CONFETTI_ENABLED,
    CONTROLLER_USERNAME,
    CONTROLLER_PASSWORD,
    SECRET_KEY,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_ANON_KEY,
    PORT: 3e3
  };
}

// src/server/raffleService.ts
import crypto2 from "crypto";

// src/server/supabase.ts
import { createClient } from "@supabase/supabase-js";
var cachedClient = null;
var realtimeChannel = null;
function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "https://toyocrdimcvkmiidposk.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRveW9jcmRpbWN2a21paWRwb3NrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODE3MzA0MCwiZXhwIjoyMDkzNzQ5MDQwfQ.SSV-Cfid5yjv4JqEJNxbMdXSC8U7k4xMGNnqRGuacmU";
  const isConfigured = Boolean(url && key && url.startsWith("http"));
  return { url, key, isConfigured };
}
function getSupabaseClient() {
  const { url, key, isConfigured } = getSupabaseConfig();
  if (!isConfigured) {
    return null;
  }
  if (!cachedClient) {
    try {
      cachedClient = createClient(url, key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      });
      console.log("[Supabase] Initialized database client successfully.");
    } catch (err) {
      console.error(`[Supabase] Error creating client:`, err.message);
      return null;
    }
  }
  return cachedClient;
}
async function checkSupabaseHealth() {
  const client = getSupabaseClient();
  if (!client) {
    return {
      connected: false,
      is_empty: true,
      participant_count: 0,
      message: "SUPABASE_NOT_CONFIGURED: Provide SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env."
    };
  }
  try {
    const { count, error } = await client.from("cse_fest_2026_participants").select("*", { count: "exact", head: true });
    if (error) {
      return {
        connected: false,
        is_empty: true,
        participant_count: 0,
        message: `SUPABASE_QUERY_ERROR: ${error.message}`
      };
    }
    const total = count || 0;
    return {
      connected: true,
      is_empty: total === 0,
      participant_count: total,
      message: total === 0 ? "DB is empty" : `Connected. ${total} participants found.`
    };
  } catch (err) {
    return {
      connected: false,
      is_empty: true,
      participant_count: 0,
      message: `SUPABASE_CONNECT_EXCEPTION: ${err.message}`
    };
  }
}
async function broadcastSupabaseEvent(type, payload) {
  const client = getSupabaseClient();
  if (!client) return false;
  try {
    if (!realtimeChannel || realtimeChannel.state !== "joined") {
      realtimeChannel = client.channel("cse_fest_raffle_events");
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 2e3);
        realtimeChannel.subscribe((status) => {
          if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            clearTimeout(timer);
            resolve();
          }
        });
      });
    }
    const res = await realtimeChannel.send({
      type: "broadcast",
      event: type,
      payload
    });
    return res === "ok";
  } catch (err) {
    console.warn("[Supabase Realtime] Broadcast notice:", err.message);
    return false;
  }
}

// src/server/supabaseRepository.ts
var inMemoryParticipants = [];
var inMemoryResults = [];
var inMemoryIgnored = [];
var inMemoryRegistrations = [];
var inMemorySession = {
  event: "DUET CSE Fest 2026",
  status: "READY",
  total_winners: 10,
  completed_winners: 0,
  next_serial: 1,
  current_candidate: null,
  last_action: "INITIALIZED",
  updated_at: (/* @__PURE__ */ new Date()).toISOString(),
  is_db_empty: true
};
var inMemoryPageAccess = {
  audience: true,
  participants: true,
  health: true,
  results: true,
  self_registration: true,
  restriction_message: "This page is temporarily restricted by the event administrator. Please stay tuned."
};
var activeVisitors = /* @__PURE__ */ new Map();
var supabaseRepository = {
  /**
   * Check if participant pool in database is completely empty
   */
  async isDbEmpty() {
    const client = getSupabaseClient();
    if (!client) {
      return inMemoryParticipants.length === 0;
    }
    try {
      const { count, error } = await client.from("cse_fest_2026_participants").select("*", { count: "exact", head: true });
      if (error) {
        console.warn("[SupabaseRepo] isDbEmpty query error, checking fallback:", error.message);
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
  async getParticipants() {
    const client = getSupabaseClient();
    if (!client) {
      return inMemoryParticipants;
    }
    try {
      const { data, error } = await client.from("cse_fest_2026_participants").select("external_id, name, type, designation, eligible").order("name", { ascending: true });
      if (error) {
        console.error("[SupabaseRepo] Error fetching participants:", error.message);
        return inMemoryParticipants;
      }
      if (!data || data.length === 0) {
        return [];
      }
      const participants = data.map((row) => ({
        id: row.external_id || null,
        name: row.name,
        type: row.type?.toLowerCase(),
        designation: row.designation || null,
        eligible: Number(row.eligible ?? 1)
      }));
      inMemoryParticipants = participants;
      return participants;
    } catch (err) {
      console.error("[SupabaseRepo] Exception fetching participants:", err.message);
      return inMemoryParticipants;
    }
  },
  /**
   * Mark participant as ineligible (eligible = 0)
   */
  async markParticipantIneligible(candidate) {
    const idx = inMemoryParticipants.findIndex((p) => {
      if (candidate.id && p.id) {
        return String(p.id).trim().toLowerCase() === String(candidate.id).trim().toLowerCase();
      }
      return p.name.trim().toLowerCase() === candidate.name.trim().toLowerCase() && p.type.toLowerCase() === candidate.type.toLowerCase();
    });
    if (idx !== -1) {
      inMemoryParticipants[idx].eligible = 0;
    }
    const client = getSupabaseClient();
    if (!client) return;
    try {
      if (candidate.id) {
        await client.from("cse_fest_2026_participants").update({ eligible: 0, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).ilike("external_id", candidate.id.trim());
      } else {
        await client.from("cse_fest_2026_participants").update({ eligible: 0, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).ilike("name", candidate.name.trim()).eq("type", candidate.type.toLowerCase());
      }
    } catch (err) {
      console.error("[SupabaseRepo] Failed to mark participant ineligible in Supabase:", err.message);
    }
  },
  /**
   * Restore all participants to eligible = 1
   */
  async restoreAllEligibility() {
    for (const p of inMemoryParticipants) {
      p.eligible = 1;
    }
    const client = getSupabaseClient();
    if (!client) return;
    try {
      await client.from("cse_fest_2026_participants").update({ eligible: 1, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).gte("eligible", 0);
    } catch (err) {
      console.error("[SupabaseRepo] Failed to restore eligibility in Supabase:", err.message);
    }
  },
  /**
   * Update participant eligibility (eligible = 1 or 0)
   */
  async setParticipantEligibility(candidate, eligible) {
    const normName = candidate.name.trim().toLowerCase();
    const normId = candidate.id ? String(candidate.id).trim().toLowerCase() : null;
    const idx = inMemoryParticipants.findIndex((p) => {
      if (normId && p.id) {
        return String(p.id).trim().toLowerCase() === normId;
      }
      return p.name.trim().toLowerCase() === normName && (!candidate.type || p.type.toLowerCase() === candidate.type.toLowerCase());
    });
    if (idx !== -1) {
      inMemoryParticipants[idx].eligible = eligible;
    }
    const client = getSupabaseClient();
    if (client) {
      try {
        if (candidate.id) {
          await client.from("cse_fest_2026_participants").update({ eligible, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).ilike("external_id", candidate.id.trim());
        } else {
          await client.from("cse_fest_2026_participants").update({ eligible, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).ilike("name", candidate.name.trim());
        }
      } catch (err) {
        console.error("[SupabaseRepo] Failed to set participant eligibility in Supabase:", err.message);
      }
    }
    return {
      success: true,
      message: `Participant ${candidate.name} is now ${eligible === 1 ? "verified & eligible" : "marked ineligible"}.`
    };
  },
  /**
   * Batch insert or import participants
   */
  async importParticipants(participants) {
    if (!participants || participants.length === 0) {
      return { inserted: 0, errors: 0 };
    }
    let inserted = 0;
    let errors = 0;
    const formatted = participants.map((p) => ({
      external_id: p.id ? String(p.id).trim() : null,
      name: p.name.trim(),
      type: p.type.toLowerCase(),
      designation: p.designation?.trim() || (p.type.toLowerCase() === "student" ? "Student" : null),
      department: "CSE",
      eligible: 1,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }));
    const client = getSupabaseClient();
    if (client) {
      try {
        const { error } = await client.from("cse_fest_2026_participants").insert(formatted);
        if (error) {
          console.error("[SupabaseRepo] Import batch error:", error.message);
          errors = formatted.length;
        } else {
          inserted = formatted.length;
        }
      } catch (err) {
        console.error("[SupabaseRepo] Import batch exception:", err.message);
        errors = formatted.length;
      }
    }
    for (const item of formatted) {
      inMemoryParticipants.push({
        id: item.external_id,
        name: item.name,
        type: item.type,
        designation: item.designation,
        eligible: 1
      });
    }
    return { inserted, errors };
  },
  /**
   * Read singleton raffle session state
   */
  async getSession() {
    const client = getSupabaseClient();
    if (!client) {
      inMemorySession.is_db_empty = inMemoryParticipants.length === 0;
      return inMemorySession;
    }
    try {
      const { data, error } = await client.from("cse_fest_2026_raffle_sessions").select("*").eq("id", "default_session").maybeSingle();
      if (error || !data) {
        inMemorySession.is_db_empty = inMemoryParticipants.length === 0;
        return inMemorySession;
      }
      const isEmpty = await this.isDbEmpty();
      const session = {
        event: data.event_name || "DUET CSE Fest 2026",
        status: data.status,
        total_winners: data.total_winners,
        completed_winners: data.completed_winners,
        next_serial: data.next_serial,
        current_candidate: data.current_candidate,
        last_action: data.last_action,
        updated_at: data.updated_at,
        is_db_empty: isEmpty
      };
      inMemorySession = session;
      inMemoryPageAccess = {
        audience: data.access_audience_enabled ?? true,
        participants: data.access_participants_enabled ?? true,
        health: data.access_health_enabled ?? true,
        results: data.access_results_enabled ?? true,
        restriction_message: data.access_restriction_message || "This page is temporarily restricted by the event administrator. Please stay tuned."
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
  async saveSession(session) {
    inMemorySession = { ...session };
    const client = getSupabaseClient();
    if (!client) return;
    try {
      await client.from("cse_fest_2026_raffle_sessions").upsert({
        id: "default_session",
        event_name: session.event,
        status: session.status,
        total_winners: session.total_winners,
        completed_winners: session.completed_winners,
        next_serial: session.next_serial,
        current_candidate: session.current_candidate,
        last_action: session.last_action,
        updated_at: session.updated_at
      });
    } catch (err) {
      console.error("[SupabaseRepo] Failed to save session to Supabase:", err.message);
    }
  },
  /**
   * Get all official winners and ignored candidates
   */
  async getResults() {
    const client = getSupabaseClient();
    if (!client) {
      return { results: inMemoryResults, ignored: inMemoryIgnored };
    }
    try {
      const [winnersRes, ignoredRes] = await Promise.all([
        client.from("cse_fest_2026_winner_results").select("serial, type, external_id, name, designation, status, drawn_at").order("serial", { ascending: true }),
        client.from("cse_fest_2026_ignored_candidates").select("type, external_id, name, designation, reason, status, drawn_at").order("drawn_at", { ascending: false })
      ]);
      const winners = (winnersRes.data || []).map((w) => ({
        serial: w.serial,
        type: w.type,
        id: w.external_id || null,
        name: w.name,
        designation: w.designation || null,
        status: "winner",
        drawn_at: w.drawn_at
      }));
      const ignored = (ignoredRes.data || []).map((i) => ({
        serial: null,
        type: i.type,
        id: i.external_id || null,
        name: i.name,
        designation: i.designation || null,
        status: "ignored",
        reason: i.reason || "absent",
        drawn_at: i.drawn_at
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
  async saveWinner(winner, cryptoProof) {
    inMemoryResults.push(winner);
    const client = getSupabaseClient();
    if (!client) return;
    try {
      await client.from("cse_fest_2026_winner_results").insert({
        serial: winner.serial,
        type: winner.type,
        external_id: winner.id,
        name: winner.name,
        designation: winner.designation,
        status: "winner",
        crypto_hash: cryptoProof ? JSON.stringify(cryptoProof) : null,
        drawn_at: winner.drawn_at || (/* @__PURE__ */ new Date()).toISOString()
      });
    } catch (err) {
      console.error("[SupabaseRepo] Failed to insert winner in Supabase:", err.message);
    }
  },
  /**
   * Add an ignored candidate
   */
  async saveIgnored(candidate) {
    inMemoryIgnored.push(candidate);
    const client = getSupabaseClient();
    if (!client) return;
    try {
      await client.from("cse_fest_2026_ignored_candidates").insert({
        type: candidate.type,
        external_id: candidate.id,
        name: candidate.name,
        designation: candidate.designation,
        reason: candidate.reason || "absent",
        status: "ignored",
        drawn_at: candidate.drawn_at || (/* @__PURE__ */ new Date()).toISOString()
      });
    } catch (err) {
      console.error("[SupabaseRepo] Failed to insert ignored candidate in Supabase:", err.message);
    }
  },
  /**
   * Clear results table on session reset
   */
  async clearResults() {
    inMemoryResults = [];
    inMemoryIgnored = [];
    const client = getSupabaseClient();
    if (!client) return;
    try {
      await Promise.all([
        client.from("cse_fest_2026_winner_results").delete().gte("serial", 0),
        client.from("cse_fest_2026_ignored_candidates").delete().not("id", "is", null)
      ]);
    } catch (err) {
      console.error("[SupabaseRepo] Failed to clear results in Supabase:", err.message);
    }
  },
  /**
   * Append audit log
   */
  async appendAudit(action, details, reqMeta) {
    const client = getSupabaseClient();
    if (!client) return;
    try {
      await client.from("cse_fest_2026_audit_logs").insert({
        action,
        details: details || {},
        ip_address: reqMeta?.ip || null,
        user_agent: reqMeta?.userAgent || null,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    } catch (err) {
      console.warn("[SupabaseRepo] Audit insert skipped/failed:", err.message);
    }
  },
  /**
   * Get recent audit logs
   */
  async getAuditLogs(limit = 50) {
    const client = getSupabaseClient();
    if (!client) return [];
    try {
      const { data } = await client.from("cse_fest_2026_audit_logs").select("*").order("timestamp", { ascending: false }).limit(limit);
      return data || [];
    } catch {
      return [];
    }
  },
  /**
   * Page Access Controls
   */
  async getPageAccessSettings() {
    const client = getSupabaseClient();
    if (!client) {
      return inMemoryPageAccess;
    }
    try {
      const { data } = await client.from("cse_fest_2026_raffle_sessions").select("access_audience_enabled, access_participants_enabled, access_health_enabled, access_results_enabled, access_restriction_message, allow_self_registration").eq("id", "default_session").maybeSingle();
      if (data) {
        inMemoryPageAccess = {
          audience: data.access_audience_enabled ?? true,
          participants: data.access_participants_enabled ?? true,
          health: data.access_health_enabled ?? true,
          results: data.access_results_enabled ?? true,
          self_registration: data.allow_self_registration ?? inMemoryPageAccess.self_registration ?? true,
          restriction_message: data.access_restriction_message || "This page is temporarily restricted by the event administrator. Please stay tuned."
        };
      }
      return inMemoryPageAccess;
    } catch {
      return inMemoryPageAccess;
    }
  },
  async updatePageAccessSettings(settings) {
    inMemoryPageAccess = {
      ...inMemoryPageAccess,
      ...settings
    };
    const client = getSupabaseClient();
    if (client) {
      try {
        await client.from("cse_fest_2026_raffle_sessions").update({
          access_audience_enabled: inMemoryPageAccess.audience,
          access_participants_enabled: inMemoryPageAccess.participants,
          access_health_enabled: inMemoryPageAccess.health,
          access_results_enabled: inMemoryPageAccess.results,
          access_restriction_message: inMemoryPageAccess.restriction_message,
          allow_self_registration: inMemoryPageAccess.self_registration !== false,
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        }).eq("id", "default_session");
      } catch (err) {
        console.error("[SupabaseRepo] Failed to update page access settings:", err.message);
      }
    }
    return inMemoryPageAccess;
  },
  /**
   * Self-Registration Queue Management
   */
  async createRegistrationRequest(data) {
    const normName = data.name.trim();
    const normType = data.type.toLowerCase();
    const normId = data.external_id ? data.external_id.trim() : null;
    const normDesig = normType === "student" ? "Student" : data.designation?.trim() || null;
    const allParticipants = await this.getParticipants();
    const existsInParticipants = allParticipants.some((p) => {
      if (normId && p.id) {
        return p.id.trim().toLowerCase() === normId.toLowerCase();
      }
      return p.name.trim().toLowerCase() === normName.toLowerCase() && p.type.toLowerCase() === normType.toLowerCase();
    });
    if (existsInParticipants) {
      return {
        success: false,
        message: normId ? `A participant with Student ID / Roll "${normId}" is already registered in the official database.` : `A participant named "${normName}" is already registered.`
      };
    }
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data: inserted, error } = await client.from("cse_fest_2026_participant_registration_requests").insert({
          external_id: normId,
          name: normName,
          type: normType,
          designation: normDesig,
          department: "CSE",
          status: "pending"
        }).select("id").single();
        if (error) {
          return { success: false, message: error.message };
        }
        return {
          success: true,
          message: "Your registration request has been submitted for official committee verification.",
          id: inserted?.id
        };
      } catch (err) {
        return { success: false, message: err.message };
      }
    }
    const newReq = {
      id: `req_${Date.now()}`,
      external_id: normId,
      name: normName,
      type: normType,
      designation: normDesig,
      department: "CSE",
      status: "pending",
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    inMemoryRegistrations.push(newReq);
    return {
      success: true,
      message: "Registration request recorded for review.",
      id: newReq.id
    };
  },
  async getRegistrationRequests() {
    const client = getSupabaseClient();
    if (!client) {
      return inMemoryRegistrations;
    }
    try {
      const { data } = await client.from("cse_fest_2026_participant_registration_requests").select("*").order("created_at", { ascending: false });
      return (data || []).map((row) => ({
        id: row.id,
        external_id: row.external_id,
        name: row.name,
        type: row.type,
        designation: row.designation,
        department: row.department || "CSE",
        status: row.status,
        review_notes: row.review_notes,
        reviewed_by: row.reviewed_by,
        reviewed_at: row.reviewed_at,
        created_at: row.created_at
      }));
    } catch {
      return inMemoryRegistrations;
    }
  },
  async reviewRegistrationRequest(requestId, action, reviewerName = "Admin", notes) {
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data: request } = await client.from("cse_fest_2026_participant_registration_requests").select("*").eq("id", requestId).single();
        if (!request) {
          return { success: false, message: "Request not found." };
        }
        if (action === "approve") {
          await client.from("cse_fest_2026_participants").insert({
            external_id: request.external_id,
            name: request.name,
            type: request.type,
            designation: request.designation,
            department: request.department || "CSE",
            eligible: 1
          });
          await client.from("cse_fest_2026_participant_registration_requests").update({
            status: "approved",
            reviewed_by: reviewerName,
            reviewed_at: (/* @__PURE__ */ new Date()).toISOString(),
            review_notes: notes || "Approved by controller"
          }).eq("id", requestId);
          inMemoryParticipants.push({
            id: request.external_id,
            name: request.name,
            type: request.type,
            designation: request.designation,
            eligible: 1
          });
          return { success: true, message: `Participant ${request.name} approved and added to active draw pool.` };
        } else {
          await client.from("cse_fest_2026_participant_registration_requests").update({
            status: "rejected",
            reviewed_by: reviewerName,
            reviewed_at: (/* @__PURE__ */ new Date()).toISOString(),
            review_notes: notes || "Rejected by controller"
          }).eq("id", requestId);
          return { success: true, message: `Registration request for ${request.name} was rejected.` };
        }
      } catch (err) {
        return { success: false, message: err.message };
      }
    }
    const item = inMemoryRegistrations.find((r) => r.id === requestId);
    if (!item) return { success: false, message: "Request not found in local queue." };
    item.status = action === "approve" ? "approved" : "rejected";
    item.reviewed_by = reviewerName;
    item.reviewed_at = (/* @__PURE__ */ new Date()).toISOString();
    item.review_notes = notes || "";
    if (action === "approve") {
      inMemoryParticipants.push({
        id: item.external_id,
        name: item.name,
        type: item.type,
        designation: item.designation,
        eligible: 1
      });
    }
    return { success: true, message: `Request updated to ${action}d.` };
  },
  /**
   * Batch review pending registration requests
   */
  async batchReviewRegistrationRequests(action, reviewerName = "Admin", requestIds) {
    const requests = await this.getRegistrationRequests();
    const pendingTargets = requests.filter(
      (r) => r.status === "pending" && (!requestIds || requestIds.includes(r.id))
    );
    let count = 0;
    for (const req of pendingTargets) {
      await this.reviewRegistrationRequest(req.id, action, reviewerName, `Batch ${action}d by controller`);
      count++;
    }
    return {
      success: true,
      count,
      message: `Successfully ${action}d ${count} registration request(s).`
    };
  },
  /**
   * Visitor Telemetry & Audience Tracking
   */
  recordVisitorHeartbeat(sessionId, ip, userAgent, page) {
    const now = Date.now();
    activeVisitors.set(sessionId, {
      id: sessionId,
      ip,
      userAgent,
      page,
      lastHeartbeat: now
    });
    for (const [id, v] of activeVisitors.entries()) {
      if (now - v.lastHeartbeat > 15e3) {
        activeVisitors.delete(id);
      }
    }
  },
  getVisitorAnalytics() {
    const now = Date.now();
    let activeNow = 0;
    const uniqueIps = /* @__PURE__ */ new Set();
    for (const v of activeVisitors.values()) {
      if (now - v.lastHeartbeat <= 15e3) {
        activeNow++;
        if (v.ip) uniqueIps.add(v.ip);
      }
    }
    return {
      active_now: activeNow,
      total_views: Math.max(activeNow, 1),
      unique_visitors: uniqueIps.size,
      peak_concurrent: Math.max(activeNow, 1)
    };
  },
  /**
   * Database Maintenance: Safe Truncate
   * STRICT SAFETY RULE: Only touches tables with prefix cse_fest_2026_*
   */
  async truncateFestTables(confirmationText) {
    if (confirmationText !== "TRUNCATE_CSE_FEST_2026") {
      return {
        success: false,
        message: 'CONFIRMATION_FAILED: Must supply exact confirmation code "TRUNCATE_CSE_FEST_2026".'
      };
    }
    const client = getSupabaseClient();
    if (client) {
      try {
        await Promise.all([
          client.from("cse_fest_2026_winner_results").delete().gte("serial", 0),
          client.from("cse_fest_2026_ignored_candidates").delete().not("id", "is", null),
          client.from("cse_fest_2026_participants").delete().not("id", "is", null),
          client.from("cse_fest_2026_participant_registration_requests").delete().not("id", "is", null),
          client.from("cse_fest_2026_audit_logs").delete().gte("id", 0),
          client.from("cse_fest_2026_audience_timeline_snapshots").delete().gte("serial", 0)
        ]);
        await client.from("cse_fest_2026_raffle_sessions").update({
          status: "READY",
          completed_winners: 0,
          next_serial: 1,
          current_candidate: null,
          last_action: "TABLES_TRUNCATED",
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        }).eq("id", "default_session");
      } catch (err) {
        console.error("[SupabaseRepo] Truncate error in Supabase:", err.message);
      }
    }
    inMemoryParticipants = [];
    inMemoryResults = [];
    inMemoryIgnored = [];
    inMemoryRegistrations = [];
    inMemorySession = {
      event: "DUET CSE Fest 2026",
      status: "READY",
      total_winners: 10,
      completed_winners: 0,
      next_serial: 1,
      current_candidate: null,
      last_action: "TABLES_TRUNCATED",
      updated_at: (/* @__PURE__ */ new Date()).toISOString(),
      is_db_empty: true
    };
    return {
      success: true,
      message: "All cse_fest_2026_* tables successfully cleared. Database is now empty and ready for fresh imports."
    };
  }
};

// src/server/cryptoEngine.ts
import crypto from "crypto";
function computePoolFingerprint(pool) {
  const canonicalPool = [...pool].sort((a, b) => {
    const keyA = String(a.id || a.name || "").toLowerCase();
    const keyB = String(b.id || b.name || "").toLowerCase();
    return keyA.localeCompare(keyB);
  });
  const poolJson = JSON.stringify(
    canonicalPool.map((p) => ({
      id: p.id ? String(p.id).trim().toLowerCase() : "",
      name: p.name.trim().toLowerCase(),
      type: p.type.toLowerCase(),
      eligible: p.eligible
    }))
  );
  return crypto.createHash("sha256").update(poolJson).digest("hex");
}
function selectCandidateCryptographically(pool, secretKey, lastActionHash = "") {
  if (!pool || pool.length === 0) {
    throw new Error("EMPTY_POOL: Cannot select candidate from an empty pool.");
  }
  const effectiveKey = secretKey || "duet-cse-fest-2026-crypto-salt";
  if (pool.length === 1) {
    return {
      selectedIndex: 0,
      selectedParticipant: pool[0],
      entropyProof: {
        algorithm: "HMAC-SHA512-BIAS-FREE-REJECTION-SAMPLING-V1",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        pool_size: 1,
        csprng_nonce: "singleton_pool",
        merkle_pool_hash: computePoolFingerprint(pool),
        hmac_digest_prefix: "singleton",
        full_verification_hash: "singleton",
        zero_modulo_bias_rejected_count: 0
      }
    };
  }
  const poolSize = BigInt(pool.length);
  const poolFingerprint = computePoolFingerprint(pool);
  const csprngBytes = crypto.randomBytes(32);
  const hrtime = process.hrtime.bigint().toString();
  const timestamp = Date.now().toString();
  const sessionSalt = lastActionHash || crypto.randomBytes(16).toString("hex");
  const entropyPayload = Buffer.concat([
    csprngBytes,
    Buffer.from(`::${hrtime}::${timestamp}::${poolFingerprint}::${sessionSalt}`)
  ]);
  const hmac = crypto.createHmac("sha512", effectiveKey);
  hmac.update(entropyPayload);
  const digestBuffer = hmac.digest();
  const TWO_POW_64 = 18446744073709551616n;
  const remainder = TWO_POW_64 % poolSize;
  const maxUnbiased = TWO_POW_64 - remainder;
  let selectedIndex = -1;
  let rejectedCount = 0;
  let offset = 0;
  let workingBuffer = digestBuffer;
  while (selectedIndex === -1) {
    if (offset + 8 > workingBuffer.length) {
      workingBuffer = crypto.createHmac("sha512", effectiveKey).update(Buffer.concat([workingBuffer, Buffer.from(`_iter_${rejectedCount}`)])).digest();
      offset = 0;
    }
    const value = workingBuffer.readBigUInt64BE(offset);
    offset += 8;
    if (value < maxUnbiased) {
      selectedIndex = Number(value % poolSize);
    } else {
      rejectedCount++;
    }
  }
  const fullProofHash = crypto.createHash("sha256").update(
    `${digestBuffer.toString("hex")}::idx=${selectedIndex}::candidate=${pool[selectedIndex].name}::roll=${pool[selectedIndex].id}`
  ).digest("hex");
  return {
    selectedIndex,
    selectedParticipant: pool[selectedIndex],
    entropyProof: {
      algorithm: "HMAC-SHA512-BIAS-FREE-REJECTION-SAMPLING-V1",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      pool_size: pool.length,
      csprng_nonce: csprngBytes.toString("hex"),
      merkle_pool_hash: poolFingerprint,
      hmac_digest_prefix: digestBuffer.slice(0, 16).toString("hex"),
      full_verification_hash: fullProofHash,
      zero_modulo_bias_rejected_count: rejectedCount
    }
  };
}

// src/server/websocketManager.ts
import { WebSocketServer, WebSocket } from "ws";
var WebSocketManager = class {
  constructor() {
    this.wss = null;
    this.clients = /* @__PURE__ */ new Set();
    this.sseClients = /* @__PURE__ */ new Set();
    this.heartbeatInterval = null;
  }
  initialize(server2) {
    this.wss = new WebSocketServer({ noServer: true });
    server2.on("upgrade", (request, socket, head) => {
      try {
        const host = request.headers.host || "localhost:3000";
        const rawPath = request.url ? new URL(request.url, `http://${host}`).pathname : "";
        const pathname = rawPath.replace(/\/+$/, "") || "/";
        const isWs = pathname === "/ws" || pathname === "/api/ws" || pathname.startsWith("/ws/") || pathname.startsWith("/api/ws/");
        if (isWs) {
          this.wss?.handleUpgrade(request, socket, head, (ws) => {
            const role = pathname.includes("controller") ? "controller" : "audience";
            this.wss?.emit("connection", ws, request, role);
          });
        }
      } catch (err) {
      }
    });
    this.wss.on("connection", (ws, _request, role = "audience") => {
      try {
        ws._socket?.setNoDelay(true);
      } catch {
      }
      const client = { ws, role, isAlive: true };
      this.clients.add(client);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "CONNECTED",
            payload: { role },
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          })
        );
      }
      ws.on("pong", () => {
        client.isAlive = true;
      });
      ws.on("close", () => {
        this.clients.delete(client);
      });
      ws.on("error", () => {
        this.clients.delete(client);
      });
      ws.on("message", (raw) => {
        try {
          const data = JSON.parse(raw.toString());
          if (data && data.type === "PING") {
            client.isAlive = true;
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "PONG", timestamp: (/* @__PURE__ */ new Date()).toISOString() }));
            }
          }
        } catch {
        }
      });
    });
    this.heartbeatInterval = setInterval(() => {
      this.clients.forEach((client) => {
        if (!client.isAlive) {
          client.ws.terminate();
          this.clients.delete(client);
          return;
        }
        client.isAlive = false;
        client.ws.ping();
      });
      this.sseClients.forEach((client) => {
        try {
          client.res.write(": keepalive\n\n");
        } catch {
          this.sseClients.delete(client);
        }
      });
    }, 1e4);
  }
  registerSseClient(res, role) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    const client = { res, role };
    this.sseClients.add(client);
    res.write(`data: ${JSON.stringify({ type: "CONNECTED", payload: { role }, timestamp: (/* @__PURE__ */ new Date()).toISOString() })}

`);
    res.on("close", () => {
      this.sseClients.delete(client);
    });
  }
  broadcastAudience(type, payload) {
    const now = Date.now();
    const id = `msg_aud_${now}_${Math.random().toString(36).substring(2, 9)}`;
    const packet = { id, type, payload, timestamp: new Date(now).toISOString(), server_time_ms: now };
    const message = JSON.stringify(packet);
    this.clients.forEach((client) => {
      if (client.role === "audience" && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(message);
        } catch {
        }
      }
    });
    this.sseClients.forEach((client) => {
      if (client.role === "audience") {
        try {
          client.res.write(`data: ${message}

`);
        } catch {
          this.sseClients.delete(client);
        }
      }
    });
    broadcastSupabaseEvent(type, packet).catch(() => {
    });
  }
  broadcastController(type, payload) {
    const now = Date.now();
    const id = `msg_ctrl_${now}_${Math.random().toString(36).substring(2, 9)}`;
    const packet = { id, type, payload, timestamp: new Date(now).toISOString(), server_time_ms: now };
    const message = JSON.stringify(packet);
    this.clients.forEach((client) => {
      if (client.role === "controller" && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(message);
        } catch {
        }
      }
    });
    this.sseClients.forEach((client) => {
      if (client.role === "controller") {
        try {
          client.res.write(`data: ${message}

`);
        } catch {
          this.sseClients.delete(client);
        }
      }
    });
    broadcastSupabaseEvent(type, packet).catch(() => {
    });
  }
  broadcastAll(type, payload) {
    const now = Date.now();
    const id = `msg_all_${now}_${Math.random().toString(36).substring(2, 9)}`;
    const packet = { id, type, payload, timestamp: new Date(now).toISOString(), server_time_ms: now };
    const message = JSON.stringify(packet);
    this.clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(message);
        } catch {
        }
      }
    });
    this.sseClients.forEach((client) => {
      try {
        client.res.write(`data: ${message}

`);
      } catch {
        this.sseClients.delete(client);
      }
    });
    broadcastSupabaseEvent(type, packet).catch(() => {
    });
  }
  getStats() {
    let wsAudience = 0;
    let wsController = 0;
    this.clients.forEach((c) => {
      if (c.role === "controller") wsController++;
      else wsAudience++;
    });
    let sseAudience = 0;
    let sseController = 0;
    this.sseClients.forEach((c) => {
      if (c.role === "controller") sseController++;
      else sseAudience++;
    });
    return {
      total: this.clients.size + this.sseClients.size,
      ws: { total: this.clients.size, audience: wsAudience, controller: wsController },
      sse: { total: this.sseClients.size, audience: sseAudience, controller: sseController },
      audience: wsAudience + sseAudience,
      controller: wsController + sseController
    };
  }
  close() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.wss?.close();
    this.sseClients.forEach((c) => {
      try {
        c.res.end();
      } catch {
      }
    });
    this.sseClients.clear();
  }
};
var wsManager = new WebSocketManager();

// src/server/raffleService.ts
var RaffleService = class {
  constructor(config2) {
    this.isLocked = false;
    this.participants = [];
    this.lastWinner = null;
    this.lastEntropyProof = null;
    this.drawTransitionTimeout = null;
    this.config = config2;
    this.session = {
      event: config2.EVENT_NAME,
      status: "READY",
      total_winners: config2.TOTAL_WINNERS,
      completed_winners: 0,
      next_serial: 1,
      current_candidate: null,
      last_action: "SESSION_INITIALIZED",
      updated_at: (/* @__PURE__ */ new Date()).toISOString(),
      is_db_empty: true
    };
    this.initAsync();
  }
  async initAsync() {
    try {
      this.participants = await supabaseRepository.getParticipants();
      const existingSession = await supabaseRepository.getSession();
      const resultsData = await supabaseRepository.getResults();
      if (existingSession) {
        this.session = existingSession;
      }
      this.session.is_db_empty = this.participants.length === 0;
      if (resultsData.results.length > 0) {
        this.lastWinner = resultsData.results[resultsData.results.length - 1];
      }
      await supabaseRepository.appendAudit("SYSTEM_SERVICE_HYDRATED", {
        participants_count: this.participants.length,
        completed_winners: this.session.completed_winners,
        is_db_empty: this.session.is_db_empty
      });
      console.log(
        `[RaffleService] Initialized with ${this.participants.length} participants (DB Empty: ${this.session.is_db_empty})`
      );
    } catch (err) {
      console.error("[RaffleService] Hydration error:", err.message);
    }
  }
  async reloadParticipants() {
    this.participants = await supabaseRepository.getParticipants();
    this.session.is_db_empty = this.participants.length === 0;
    return this.participants;
  }
  getPublicState() {
    const candidatePresentation = this.session.current_candidate ? {
      type: this.session.current_candidate.type,
      id: this.session.current_candidate.id,
      name: this.session.current_candidate.name,
      designation: this.session.current_candidate.designation
    } : null;
    return {
      event: this.session.event,
      status: this.session.status,
      total_winners: this.session.total_winners,
      completed_winners: this.session.completed_winners,
      next_serial: this.session.next_serial,
      current_candidate: candidatePresentation,
      last_winner: this.lastWinner,
      last_action: this.session.last_action,
      is_db_empty: this.participants.length === 0
    };
  }
  async getControllerState() {
    const total = this.participants.length;
    const isDbEmpty = total === 0;
    let eligibleCount = 0;
    let studentCount = 0;
    let facultyCount = 0;
    let guestCount = 0;
    for (const p of this.participants) {
      if (p.eligible === 1) eligibleCount++;
      if (p.type === "student") studentCount++;
      else if (p.type === "faculty") facultyCount++;
      else if (p.type === "guest") guestCount++;
    }
    const [resultsData, pageAccess, registrationRequests] = await Promise.all([
      supabaseRepository.getResults(),
      supabaseRepository.getPageAccessSettings(),
      supabaseRepository.getRegistrationRequests()
    ]);
    const visitorAnalytics = supabaseRepository.getVisitorAnalytics();
    const pendingRegCount = registrationRequests.filter((r) => r.status === "pending").length;
    return {
      ...this.session,
      is_db_empty: isDbEmpty,
      eligible_count: eligibleCount,
      total_participants: total,
      students_count: studentCount,
      faculty_count: facultyCount,
      guest_count: guestCount,
      winners_count: resultsData.results.length,
      ignored_count: resultsData.ignored.length,
      is_locked: this.isLocked,
      has_interrupted: this.session.status === "INTERRUPTED",
      winners: resultsData.results,
      page_access: pageAccess,
      visitor_analytics: visitorAnalytics,
      pending_registrations_count: pendingRegCount
    };
  }
  getRollingPool(limit = 150) {
    const eligible = this.participants.filter((p) => p.eligible === 1);
    if (eligible.length === 0) {
      return [];
    }
    return eligible.slice(0, limit).map((p) => ({
      name: p.name,
      id: p.id ? `Roll: ${p.id}` : p.designation || "DUET CSE",
      type: p.type.toUpperCase()
    }));
  }
  async startDraw() {
    if (this.isLocked) {
      return { success: false, message: "DRAW_IN_PROGRESS: Another draw operation is currently locked." };
    }
    if (this.participants.length === 0) {
      return {
        success: false,
        message: "DATABASE_EMPTY: The participant database in Supabase is empty. Please import participants before drawing."
      };
    }
    if (this.session.status === "COMPLETED" || this.session.completed_winners >= this.session.total_winners) {
      return { success: false, message: "RAFFLE_COMPLETED: All target winners have already been drawn." };
    }
    if (this.session.status === "WAITING_CONFIRMATION" && this.session.current_candidate) {
      return {
        success: false,
        message: "WAITING_CONFIRMATION: A candidate is currently awaiting confirmation or ignore decision."
      };
    }
    if (this.session.status === "PAUSED") {
      return { success: false, message: "DRAW_PAUSED: The raffle is currently paused. Please resume first." };
    }
    if (this.session.status === "INTERRUPTED") {
      return {
        success: false,
        message: "INTERRUPTED_DRAW: An interrupted draw was detected. Please restore or cancel candidate first."
      };
    }
    await this.reloadParticipants();
    const filteredEligible = this.participants.filter((p) => p.eligible === 1);
    if (filteredEligible.length === 0) {
      return { success: false, message: "NO_ELIGIBLE_PARTICIPANTS: No eligible candidates remain in the pool." };
    }
    const shufflePasses = this.config.SHUFFLE_PASSES || 7;
    const shuffledPool = [...filteredEligible];
    const totalEligible = shuffledPool.length;
    for (let pass = 1; pass <= shufflePasses; pass++) {
      for (let i = totalEligible - 1; i > 0; i--) {
        const j = crypto2.randomInt(0, i + 1);
        const temp = shuffledPool[i];
        shuffledPool[i] = shuffledPool[j];
        shuffledPool[j] = temp;
      }
    }
    this.isLocked = true;
    try {
      const cryptoResult = selectCandidateCryptographically(
        shuffledPool,
        this.config.SECRET_KEY,
        this.session.last_action
      );
      const selectedCandidate = cryptoResult.selectedParticipant;
      this.lastEntropyProof = cryptoResult.entropyProof;
      this.session.status = "DRAWING";
      this.session.current_candidate = selectedCandidate;
      this.session.last_action = `CANDIDATE_SELECTED_ROUND_${this.session.next_serial}`;
      this.session.updated_at = (/* @__PURE__ */ new Date()).toISOString();
      await supabaseRepository.saveSession(this.session);
      await supabaseRepository.appendAudit("DRAW_STARTED_CRYPTOGRAPHIC_SELECTION", {
        next_serial: this.session.next_serial,
        shuffle_passes: shufflePasses,
        eligible_pool_size: shuffledPool.length,
        selected_index: cryptoResult.selectedIndex,
        entropy_proof: cryptoResult.entropyProof,
        selected_candidate: {
          name: selectedCandidate.name,
          id: selectedCandidate.id,
          type: selectedCandidate.type
        },
        countdown_seconds: this.config.DRAW_COUNTDOWN_SECONDS
      });
      const candidatePayload = {
        type: selectedCandidate.type,
        id: selectedCandidate.id,
        name: selectedCandidate.name,
        designation: selectedCandidate.designation,
        serial: this.session.next_serial
      };
      const startTime = Date.now();
      const cdSec = this.config.DRAW_COUNTDOWN_SECONDS || 5;
      const rollDurationMs = 2200;
      const countdownEndMs = startTime + cdSec * 1e3;
      const revealTimeMs = countdownEndMs + rollDurationMs;
      const drawStartPayload = {
        serial: this.session.next_serial,
        countdown_seconds: cdSec,
        start_time_ms: startTime,
        countdown_end_ms: countdownEndMs,
        roll_duration_ms: rollDurationMs,
        reveal_time_ms: revealTimeMs,
        name_roll_ms: this.config.NAME_ROLL_DURATION_MS,
        shuffle_passes: shufflePasses,
        candidate: candidatePayload
      };
      wsManager.broadcastAll("DRAW_START", drawStartPayload);
      this.getControllerState().then((ctrl) => {
        wsManager.broadcastController("STATE_UPDATED", ctrl);
      }).catch(() => {
      });
      if (this.drawTransitionTimeout) {
        clearTimeout(this.drawTransitionTimeout);
        this.drawTransitionTimeout = null;
      }
      const sequenceDurationMs = cdSec * 1e3 + rollDurationMs;
      this.drawTransitionTimeout = setTimeout(async () => {
        if (this.session.status === "DRAWING" && this.session.current_candidate) {
          this.session.status = "WAITING_CONFIRMATION";
          this.session.last_action = "CANDIDATE_REVEALED_ON_STAGE";
          this.session.updated_at = (/* @__PURE__ */ new Date()).toISOString();
          await Promise.all([
            supabaseRepository.saveSession(this.session),
            supabaseRepository.appendAudit("CANDIDATE_REVEALED_FOR_DECISION", {
              name: selectedCandidate.name,
              id: selectedCandidate.id,
              type: selectedCandidate.type,
              serial: this.session.next_serial
            })
          ]);
          wsManager.broadcastAudience("CANDIDATE_SELECTED", candidatePayload);
          this.getControllerState().then((updatedCtrlState) => {
            wsManager.broadcastController("STATE_UPDATED", updatedCtrlState);
          }).catch(() => {
          });
        }
      }, sequenceDurationMs);
      return {
        success: true,
        message: `Draw pipeline executed: candidate ${selectedCandidate.name} chosen with zero-modulo-bias cryptographic selection.`,
        candidate: selectedCandidate
      };
    } finally {
      this.isLocked = false;
    }
  }
  async confirmWinner() {
    if (this.isLocked) {
      return { success: false, message: "DRAW_IN_PROGRESS: Server is processing another transaction." };
    }
    if (!this.session.current_candidate) {
      return { success: false, message: "NO_CANDIDATE: No candidate is currently selected to confirm." };
    }
    if (this.session.status !== "WAITING_CONFIRMATION" && this.session.status !== "CANDIDATE_SELECTED" && this.session.status !== "DRAWING") {
      return { success: false, message: `INVALID_STATE: Cannot confirm in current state (${this.session.status}).` };
    }
    if (this.drawTransitionTimeout) {
      clearTimeout(this.drawTransitionTimeout);
      this.drawTransitionTimeout = null;
    }
    this.isLocked = true;
    try {
      const candidate = this.session.current_candidate;
      const pIdx = this.participants.findIndex((p) => {
        if (candidate.id && p.id) {
          return String(p.id).trim().toLowerCase() === String(candidate.id).trim().toLowerCase();
        }
        return p.name.trim().toLowerCase() === candidate.name.trim().toLowerCase() && p.type.toLowerCase() === candidate.type.toLowerCase();
      });
      if (pIdx !== -1) {
        this.participants[pIdx].eligible = 0;
      }
      const winner = {
        serial: this.session.next_serial,
        type: candidate.type,
        id: candidate.id,
        name: candidate.name,
        designation: candidate.designation,
        status: "winner",
        drawn_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      this.lastWinner = winner;
      this.session.completed_winners += 1;
      this.session.next_serial += 1;
      this.session.current_candidate = null;
      this.session.status = this.session.completed_winners >= this.session.total_winners ? "COMPLETED" : "READY";
      this.session.last_action = `WINNER_#${winner.serial}_CONFIRMED`;
      this.session.updated_at = (/* @__PURE__ */ new Date()).toISOString();
      wsManager.broadcastAll("WINNER_CONFIRMED", {
        winner,
        completed_winners: this.session.completed_winners,
        total_winners: this.session.total_winners,
        is_completed: this.session.status === "COMPLETED",
        confirmed_at_ms: Date.now()
      });
      await Promise.all([
        supabaseRepository.markParticipantIneligible(candidate),
        supabaseRepository.saveWinner(winner, this.lastEntropyProof),
        supabaseRepository.saveSession(this.session),
        supabaseRepository.appendAudit("WINNER_CONFIRMED", {
          serial: winner.serial,
          name: winner.name,
          id: winner.id,
          type: winner.type,
          completed_winners: this.session.completed_winners,
          total_winners: this.session.total_winners
        })
      ]);
      this.getControllerState().then((ctrlState) => {
        wsManager.broadcastController("STATE_UPDATED", ctrlState);
      }).catch(() => {
      });
      return {
        success: true,
        message: `Winner #${winner.serial} confirmed successfully!`,
        winner
      };
    } finally {
      this.isLocked = false;
    }
  }
  async ignoreCandidate(reason = "absent") {
    if (this.isLocked) {
      return { success: false, message: "DRAW_IN_PROGRESS: Server is processing another transaction." };
    }
    if (!this.session.current_candidate) {
      return { success: false, message: "NO_CANDIDATE: No candidate is currently selected to ignore." };
    }
    if (this.drawTransitionTimeout) {
      clearTimeout(this.drawTransitionTimeout);
      this.drawTransitionTimeout = null;
    }
    this.isLocked = true;
    try {
      const candidate = this.session.current_candidate;
      const pIdx = this.participants.findIndex((p) => {
        if (candidate.id && p.id) {
          return String(p.id).trim().toLowerCase() === String(candidate.id).trim().toLowerCase();
        }
        return p.name.trim().toLowerCase() === candidate.name.trim().toLowerCase() && p.type.toLowerCase() === candidate.type.toLowerCase();
      });
      if (pIdx !== -1) {
        this.participants[pIdx].eligible = 0;
      }
      const ignoredRecord = {
        serial: null,
        type: candidate.type,
        id: candidate.id,
        name: candidate.name,
        designation: candidate.designation,
        status: "ignored",
        reason,
        drawn_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      this.session.current_candidate = null;
      this.session.status = "READY";
      this.session.last_action = `CANDIDATE_${candidate.name}_IGNORED`;
      this.session.updated_at = (/* @__PURE__ */ new Date()).toISOString();
      wsManager.broadcastAll("CANDIDATE_IGNORED", {
        name: candidate.name,
        reason,
        next_serial: this.session.next_serial,
        ignored_at_ms: Date.now()
      });
      await Promise.all([
        supabaseRepository.markParticipantIneligible(candidate),
        supabaseRepository.saveIgnored(ignoredRecord),
        supabaseRepository.saveSession(this.session),
        supabaseRepository.appendAudit("CANDIDATE_IGNORED", {
          name: candidate.name,
          id: candidate.id,
          type: candidate.type,
          reason
        })
      ]);
      this.getControllerState().then((ctrlState) => {
        wsManager.broadcastController("STATE_UPDATED", ctrlState);
      }).catch(() => {
      });
      return {
        success: true,
        message: `Candidate ${candidate.name} marked absent. Ready for next draw.`
      };
    } finally {
      this.isLocked = false;
    }
  }
  async pause() {
    if (this.drawTransitionTimeout) {
      clearTimeout(this.drawTransitionTimeout);
      this.drawTransitionTimeout = null;
    }
    if (this.session.status === "PAUSED") {
      return { success: true, message: "Already paused." };
    }
    this.session.status = "PAUSED";
    this.session.last_action = "DRAW_PAUSED";
    this.session.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await supabaseRepository.saveSession(this.session);
    await supabaseRepository.appendAudit("DRAW_PAUSED");
    wsManager.broadcastAll("PAUSED", { paused_at_ms: Date.now() });
    const ctrlState = await this.getControllerState();
    wsManager.broadcastController("STATE_UPDATED", ctrlState);
    return { success: true, message: "Raffle paused." };
  }
  async resume() {
    if (this.session.status !== "PAUSED") {
      return { success: true, message: "Raffle is not paused." };
    }
    this.session.status = this.session.current_candidate ? "WAITING_CONFIRMATION" : "READY";
    this.session.last_action = "DRAW_RESUMED";
    this.session.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await supabaseRepository.saveSession(this.session);
    await supabaseRepository.appendAudit("DRAW_RESUMED");
    wsManager.broadcastAll("RESUMED", { resumed_at_ms: Date.now() });
    const ctrlState = await this.getControllerState();
    wsManager.broadcastController("STATE_UPDATED", ctrlState);
    return { success: true, message: "Raffle resumed." };
  }
  async restoreInterrupted() {
    if (this.session.status !== "INTERRUPTED" || !this.session.current_candidate) {
      return { success: false, message: "No interrupted candidate to restore." };
    }
    this.session.status = "WAITING_CONFIRMATION";
    this.session.last_action = "INTERRUPTED_CANDIDATE_RESTORED";
    this.session.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await supabaseRepository.saveSession(this.session);
    await supabaseRepository.appendAudit("INTERRUPTED_CANDIDATE_RESTORED", {
      candidate: this.session.current_candidate
    });
    wsManager.broadcastAll("CANDIDATE_SELECTED", {
      type: this.session.current_candidate.type,
      id: this.session.current_candidate.id,
      name: this.session.current_candidate.name,
      designation: this.session.current_candidate.designation,
      serial: this.session.next_serial
    });
    const ctrlState = await this.getControllerState();
    wsManager.broadcastController("STATE_UPDATED", ctrlState);
    return { success: true, message: "Interrupted candidate restored to active state." };
  }
  async cancelInterrupted() {
    if (this.drawTransitionTimeout) {
      clearTimeout(this.drawTransitionTimeout);
      this.drawTransitionTimeout = null;
    }
    if (this.session.status !== "INTERRUPTED") {
      return { success: false, message: "No interrupted draw to cancel." };
    }
    const oldCandidate = this.session.current_candidate;
    this.session.current_candidate = null;
    this.session.status = "READY";
    this.session.last_action = "INTERRUPTED_DRAW_CANCELLED";
    this.session.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await supabaseRepository.saveSession(this.session);
    await supabaseRepository.appendAudit("INTERRUPTED_DRAW_CANCELLED", { candidate: oldCandidate });
    wsManager.broadcastAll("RESET", { reset_at_ms: Date.now() });
    const ctrlState = await this.getControllerState();
    wsManager.broadcastController("STATE_UPDATED", ctrlState);
    return { success: true, message: "Interrupted draw cancelled. Participant remains eligible." };
  }
  async resetSession(typedConfirmation) {
    if (this.drawTransitionTimeout) {
      clearTimeout(this.drawTransitionTimeout);
      this.drawTransitionTimeout = null;
    }
    if (typedConfirmation !== "RESET") {
      return {
        success: false,
        message: 'CONFIRMATION_MISMATCH: You must explicitly type "RESET" to confirm resetting the raffle session.'
      };
    }
    await supabaseRepository.restoreAllEligibility();
    await this.reloadParticipants();
    await supabaseRepository.clearResults();
    this.lastWinner = null;
    this.session = {
      event: this.config.EVENT_NAME,
      status: "READY",
      total_winners: this.config.TOTAL_WINNERS,
      completed_winners: 0,
      next_serial: 1,
      current_candidate: null,
      last_action: "SESSION_RESET_TO_INITIAL",
      updated_at: (/* @__PURE__ */ new Date()).toISOString(),
      is_db_empty: this.participants.length === 0
    };
    await supabaseRepository.saveSession(this.session);
    await supabaseRepository.appendAudit("SESSION_RESET", { reset_at: (/* @__PURE__ */ new Date()).toISOString() });
    wsManager.broadcastAll("RESET", { message: "A new raffle session has been initiated.", reset_at_ms: Date.now() });
    const ctrlState = await this.getControllerState();
    wsManager.broadcastController("STATE_UPDATED", ctrlState);
    return {
      success: true,
      message: "Raffle session reset successfully. All winner results cleared and participants restored."
    };
  }
  async setParticipantEligibility(candidate, eligible) {
    const res = await supabaseRepository.setParticipantEligibility(candidate, eligible);
    await this.reloadParticipants();
    const ctrlState = await this.getControllerState();
    wsManager.broadcastController("STATE_UPDATED", ctrlState);
    return res;
  }
  async searchParticipants(query = "", type = "all", status = "all") {
    let qStr = "";
    let tStr = type;
    let sStr = status;
    if (typeof query === "object" && query !== null) {
      qStr = query.q || "";
      tStr = query.type || "all";
      sStr = query.status || "all";
    } else {
      qStr = String(query || "");
    }
    const resultsData = await supabaseRepository.getResults();
    const winnerIds = new Set(
      resultsData.results.filter((w) => !!w.id).map((w) => String(w.id).trim().toLowerCase())
    );
    const winnerCombosWithoutId = new Set(
      resultsData.results.filter((w) => !w.id).map((w) => `${w.name.trim().toLowerCase()}_${w.type.toLowerCase()}`)
    );
    const winnerSerialMap = /* @__PURE__ */ new Map();
    resultsData.results.forEach((w) => {
      if (w.id) {
        winnerSerialMap.set(`id_${String(w.id).trim().toLowerCase()}`, w.serial);
      } else {
        winnerSerialMap.set(`combo_${w.name.trim().toLowerCase()}_${w.type.toLowerCase()}`, w.serial);
      }
    });
    const ignoredIds = new Set(
      resultsData.ignored.filter((i) => !!i.id).map((i) => String(i.id).trim().toLowerCase())
    );
    const ignoredCombosWithoutId = new Set(
      resultsData.ignored.filter((i) => !i.id).map((i) => `${i.name.trim().toLowerCase()}_${i.type.toLowerCase()}`)
    );
    const q = qStr.trim().toLowerCase();
    let eligibleTotal = 0;
    let winnerTotal = 0;
    let ignoredTotal = 0;
    const allMapped = this.participants.map((p) => {
      const pIdNorm = p.id ? String(p.id).trim().toLowerCase() : "";
      const pCombo = `${p.name.trim().toLowerCase()}_${p.type.toLowerCase()}`;
      let isWinner = false;
      let winSerial = void 0;
      if (pIdNorm) {
        if (winnerIds.has(pIdNorm)) {
          isWinner = true;
          winSerial = winnerSerialMap.get(`id_${pIdNorm}`);
        }
      } else if (winnerCombosWithoutId.has(pCombo)) {
        isWinner = true;
        winSerial = winnerSerialMap.get(`combo_${pCombo}`);
      }
      let isIgnored = false;
      if (!isWinner) {
        if (pIdNorm) {
          isIgnored = ignoredIds.has(pIdNorm) || p.eligible === 0;
        } else {
          isIgnored = ignoredCombosWithoutId.has(pCombo) || p.eligible === 0;
        }
      }
      let derivedStatus = "eligible";
      if (isWinner) {
        derivedStatus = "winner";
        winnerTotal++;
      } else if (isIgnored) {
        derivedStatus = "ignored";
        ignoredTotal++;
      } else {
        derivedStatus = "eligible";
        eligibleTotal++;
      }
      return {
        ...p,
        status: derivedStatus,
        winning_serial: winSerial
      };
    });
    const filtered = allMapped.filter((p) => {
      if (tStr && tStr !== "all" && p.type.toLowerCase() !== tStr.toLowerCase()) return false;
      if (sStr === "eligible" && p.status !== "eligible") return false;
      if (sStr === "winner" && p.status !== "winner") return false;
      if (sStr === "ignored" && p.status !== "ignored") return false;
      if (q) {
        const matchId = p.id ? String(p.id).toLowerCase().includes(q) : false;
        const matchName = p.name.toLowerCase().includes(q);
        const matchDesig = p.designation ? p.designation.toLowerCase().includes(q) : false;
        if (!matchId && !matchName && !matchDesig) return false;
      }
      return true;
    });
    return {
      total: allMapped.length,
      filtered_total: filtered.length,
      is_db_empty: allMapped.length === 0,
      counts: {
        total: allMapped.length,
        eligible: eligibleTotal,
        winner: winnerTotal,
        ignored: ignoredTotal
      },
      participants: filtered
    };
  }
  async searchParticipantsPaginated(params) {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 15));
    const searchRes = await this.searchParticipants(
      params.q || "",
      params.type || "all",
      params.status || "all"
    );
    const filteredTotal = searchRes.filtered_total ?? searchRes.participants.length;
    const totalPages = Math.max(1, Math.ceil(filteredTotal / limit));
    const offset = (page - 1) * limit;
    const paginatedParticipants = searchRes.participants.slice(offset, offset + limit);
    return {
      total: searchRes.total,
      filtered_total: filteredTotal,
      is_db_empty: searchRes.is_db_empty,
      page,
      limit,
      total_pages: totalPages,
      counts: searchRes.counts,
      participants: paginatedParticipants
    };
  }
};

// src/server/excelService.ts
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
function findRootExcelFile() {
  const rootDir = process.cwd();
  const candidates = [
    "data.excel",
    "data.xlsx",
    "data.xls",
    "DATA.EXCEL",
    "DATA.XLSX",
    "DATA.XLS",
    "data.csv"
  ];
  for (const name of candidates) {
    const fullPath = path.join(rootDir, name);
    if (fs.existsSync(fullPath)) {
      const stat = fs.statSync(fullPath);
      if (stat.isFile() && stat.size > 0) {
        return { filePath: fullPath, fileName: name };
      }
    }
  }
  try {
    const files = fs.readdirSync(rootDir);
    for (const f of files) {
      if (/^data.*\.(excel|xlsx|xls)$/i.test(f)) {
        return { filePath: path.join(rootDir, f), fileName: f };
      }
    }
  } catch {
  }
  return null;
}
function parseExcelBuffer(buffer, fileName = "data.excel") {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetNames = workbook.SheetNames;
  if (!sheetNames || sheetNames.length === 0) {
    throw new Error("Excel workbook contains no sheets.");
  }
  const firstSheet = workbook.Sheets[sheetNames[0]];
  const rawData = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
  const headers = [];
  if (rawData.length > 0) {
    Object.keys(rawData[0]).forEach((k) => headers.push(k));
  }
  const normalizedRows = [];
  let validCount = 0;
  let invalidCount = 0;
  let studentsCount = 0;
  let facultyCount = 0;
  let guestsCount = 0;
  rawData.forEach((row, idx) => {
    const rawSerialVal = row.serial ?? row.Serial ?? row.SERIAL ?? row["student id"] ?? row["Student ID"] ?? row.student_id ?? row.Student_ID ?? row.roll ?? row.Roll ?? row.id ?? row.ID ?? "";
    const rawSerial = String(rawSerialVal).trim();
    const rawNameVal = row.name ?? row.Name ?? row.NAME ?? "";
    const name = String(rawNameVal).trim();
    const rawTypeVal = row.type ?? row.Type ?? row.TYPE ?? "";
    let rawTypeStr = String(rawTypeVal).trim().toLowerCase();
    let type = "student";
    if (rawTypeStr === "student" || rawTypeStr === "stu") {
      type = "student";
    } else if (rawTypeStr === "faculty" || rawTypeStr === "teacher" || rawTypeStr === "fac") {
      type = "faculty";
    } else if (rawTypeStr === "guest" || rawTypeStr === "staff" || rawTypeStr === "visitor" || rawTypeStr === "alumni") {
      type = "guest";
    } else if (rawTypeStr === "") {
      type = "student";
    } else {
      type = "guest";
    }
    const rawDesigVal = row.designation ?? row.Designation ?? row.DESIGNATION ?? "";
    let designation = String(rawDesigVal).trim();
    const rawDeptVal = row.department ?? row.Department ?? row.DEPARTMENT ?? "CSE";
    const department = String(rawDeptVal).trim() || "CSE";
    let isValid = true;
    let validationError;
    let validationWarning;
    let studentId = "";
    if (!name) {
      isValid = false;
      validationError = "Missing participant name";
    }
    if (type === "student") {
      studentId = rawSerial;
      if (!studentId) {
        isValid = false;
        validationError = "Student must have a Student ID in the serial column";
      }
      designation = "Student";
    } else {
      studentId = "";
      if (!designation) {
        if (type === "faculty") {
          designation = "Faculty Member";
          validationWarning = 'Designation was empty; defaulted to "Faculty Member"';
        } else {
          designation = "Guest";
          validationWarning = 'Designation was empty; defaulted to "Guest"';
        }
      }
    }
    if (isValid) {
      validCount++;
      if (type === "student") studentsCount++;
      else if (type === "faculty") facultyCount++;
      else guestsCount++;
    } else {
      invalidCount++;
    }
    normalizedRows.push({
      rowIndex: idx + 1,
      rawSerial,
      studentId,
      name,
      type,
      designation,
      department,
      isValid,
      validationError,
      validationWarning
    });
  });
  return {
    fileName,
    fileSize: buffer.length,
    foundInRoot: true,
    totalRows: normalizedRows.length,
    validRows: validCount,
    invalidRows: invalidCount,
    counts: {
      students: studentsCount,
      faculty: facultyCount,
      guests: guestsCount
    },
    rows: normalizedRows,
    headers
  };
}
async function commitExcelParticipantsToDb(rows, mode = "append") {
  const validRows = rows.filter((r) => r.isValid && r.name);
  if (validRows.length === 0) {
    return {
      success: false,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      message: "No valid rows to import."
    };
  }
  const client = getSupabaseClient();
  if (!client) {
    const result = await supabaseRepository.importParticipants(
      validRows.map((r) => ({
        id: r.studentId || null,
        name: r.name,
        type: r.type,
        designation: r.designation
      }))
    );
    return {
      success: true,
      inserted: result.inserted,
      updated: 0,
      skipped: 0,
      errors: result.errors,
      message: `Imported ${result.inserted} participants to in-memory store (Supabase not configured).`
    };
  }
  try {
    if (mode === "replace") {
      const { error: delErr } = await client.from("cse_fest_2026_participants").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (delErr) {
        console.warn("[ExcelService] Delete warning during replace:", delErr.message);
      }
    }
    const dbPayload = validRows.map((r) => ({
      external_id: r.studentId || null,
      name: r.name,
      type: r.type,
      designation: r.designation,
      department: r.department || "CSE",
      eligible: 1,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }));
    const BATCH_SIZE = 100;
    let insertedCount = 0;
    let errorCount = 0;
    for (let i = 0; i < dbPayload.length; i += BATCH_SIZE) {
      const chunk = dbPayload.slice(i, i + BATCH_SIZE);
      const { error: insertErr } = await client.from("cse_fest_2026_participants").insert(chunk);
      if (insertErr) {
        console.error(`[ExcelService] Batch insert error (batch ${i}):`, insertErr.message);
        for (const item of chunk) {
          const { error: singleErr } = await client.from("cse_fest_2026_participants").insert(item);
          if (singleErr) {
            errorCount++;
          } else {
            insertedCount++;
          }
        }
      } else {
        insertedCount += chunk.length;
      }
    }
    await client.from("cse_fest_2026_audit_logs").insert({
      action: "EXCEL_SEED_IMPORT",
      details: {
        mode,
        total_rows: rows.length,
        valid_rows: validRows.length,
        inserted_count: insertedCount,
        error_count: errorCount,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      },
      actor: "controller",
      ip_address: "127.0.0.1"
    });
    return {
      success: true,
      inserted: insertedCount,
      updated: 0,
      skipped: rows.length - validRows.length,
      errors: errorCount,
      message: `Successfully uploaded ${insertedCount} participants to Supabase (${mode === "replace" ? "replaced existing records" : "appended"}).`
    };
  } catch (err) {
    console.error("[ExcelService] Upload exception:", err);
    return {
      success: false,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: validRows.length,
      message: `Database upload failed: ${err.message}`
    };
  }
}
function ensureSampleExcelFile() {
  const rootDir = process.cwd();
  const filePath = path.join(rootDir, "data.excel");
  if (fs.existsSync(filePath)) {
    return filePath;
  }
  const sampleData = [
    { serial: "2303001", name: "Tanvir Ahmed", type: "student", designation: "Student" },
    { serial: "2303002", name: "Nusrat Jahan", type: "student", designation: "Student" },
    { serial: "2303003", name: "Arifur Rahman", type: "student", designation: "Student" },
    { serial: "2303004", name: "Farhana Mim", type: "student", designation: "Student" },
    { serial: "2303005", name: "Sabbir Hossain", type: "student", designation: "Student" },
    { serial: "2303006", name: "Jannatul Ferdous", type: "student", designation: "Student" },
    { serial: "2303007", name: "Mahmudul Hasan", type: "student", designation: "Student" },
    { serial: "2303008", name: "Sadia Afrin", type: "student", designation: "Student" },
    { serial: "2303009", name: "Rakibul Islam", type: "student", designation: "Student" },
    { serial: "2303010", name: "Tasnim Sultana", type: "student", designation: "Student" },
    { serial: "", name: "Dr. Md. Zahirul Islam", type: "faculty", designation: "Professor & Head" },
    { serial: "", name: "Dr. Mohammad Nazmul Hassan", type: "faculty", designation: "Associate Professor" },
    { serial: "", name: "Shamima Akter", type: "faculty", designation: "Assistant Professor" },
    { serial: "", name: "Engr. Kazi Moinuddin", type: "guest", designation: "Special Guest" },
    { serial: "", name: "Mahbubur Rahman", type: "guest", designation: "Distinguished Guest" }
  ];
  const ws = XLSX.utils.json_to_sheet(sampleData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Participants");
  XLSX.writeFile(wb, filePath, { bookType: "xlsx" });
  console.log(`[ExcelService] Created sample data.excel in root folder: ${filePath}`);
  return filePath;
}

// server.ts
var config = loadAndValidateConfig();
var raffleService = new RaffleService(config);
var app = express();
var server = http.createServer(app);
var PORT = 3e3;
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
var isServerless = Boolean(
  process.env.VERCEL || process.env.VERCEL_ENV || process.env.NOW_REGION || process.env.AWS_LAMBDA_FUNCTION_NAME
);
app.use((req, _res, next) => {
  const matchedPath = req.headers["x-matched-path"] || req.headers["x-vercel-matched-path"];
  if (matchedPath && (matchedPath.startsWith("/api/") || matchedPath.startsWith("/public/") || matchedPath.startsWith("/controller/"))) {
    const urlParts = req.url.split("?");
    const query = urlParts[1] ? `?${urlParts[1]}` : "";
    req.url = matchedPath.startsWith("/api/") ? matchedPath + query : "/api" + matchedPath + query;
  } else if (req.url && !req.url.startsWith("/api")) {
    if (req.url.startsWith("/public") || req.url.startsWith("/controller") || req.url.startsWith("/health") || req.url.startsWith("/ws")) {
      req.url = "/api" + req.url;
    }
  }
  next();
});
var isDirectExecution = Boolean(
  process.argv[1] && (process.argv[1].endsWith("server.ts") || process.argv[1].endsWith("server.cjs") || process.argv[1].endsWith("server.js"))
);
if (isDirectExecution && !isServerless) {
  wsManager.initialize(server);
}
app.all(["/ws", "/ws/*", "/api/ws", "/api/ws/*"], (_req, res) => {
  res.status(200).json({
    status: "fallback",
    message: "WebSocket upgrade not supported in serverless mode. Client synchronizes via Supabase Realtime and HTTP polling."
  });
});
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser(config.SECRET_KEY));
app.get("/banner.jpg", (_req, res) => {
  res.sendFile(path2.join(process.cwd(), "public", "banner.jpg"));
});
app.get("/favicon.ico", (_req, res) => {
  res.sendFile(path2.join(process.cwd(), "public", "favicon.ico"));
});
app.get("/favicon.svg", (_req, res) => {
  res.type("image/svg+xml").sendFile(path2.join(process.cwd(), "public", "favicon.svg"));
});
app.all(["/ws", "/ws/*"], (_req, res) => {
  res.status(501).json({
    status: "ws_unavailable_serverless",
    message: "WebSocket direct TCP upgrades are not available in serverless functions. Real-time synchronization is handled automatically via HTTP polling and SSE."
  });
});
function generateSessionToken(username) {
  const timestamp = Date.now().toString();
  const signature = crypto3.createHmac("sha256", config.SECRET_KEY).update(`${username}:${timestamp}`).digest("hex");
  return Buffer.from(`${username}:${timestamp}:${signature}`).toString("base64");
}
function verifySessionToken(token) {
  try {
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    const [username, timestamp, signature] = decoded.split(":");
    if (!username || !timestamp || !signature) return false;
    if (username !== config.CONTROLLER_USERNAME) return false;
    const tokenTime = parseInt(timestamp, 10);
    if (isNaN(tokenTime) || Date.now() - tokenTime > 24 * 60 * 60 * 1e3) {
      return false;
    }
    const expectedSignature = crypto3.createHmac("sha256", config.SECRET_KEY).update(`${username}:${timestamp}`).digest("hex");
    return crypto3.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch {
    return false;
  }
}
function requireControllerAuth(req, res, next) {
  const cookieToken = req.signedCookies?.raffle_ctrl_session || req.cookies?.raffle_ctrl_session;
  const headerToken = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const token = cookieToken || headerToken;
  if (!token || !verifySessionToken(token)) {
    return res.status(403).json({
      success: false,
      code: "FORBIDDEN",
      message: "Access Denied: Controller authorization required for this operation."
    });
  }
  next();
}
app.get("/api/public/event", (_req, res) => {
  const supa = getSupabaseConfig();
  res.json({
    event_name: config.EVENT_NAME,
    total_winners: config.TOTAL_WINNERS,
    countdown_seconds: config.DRAW_COUNTDOWN_SECONDS,
    reveal_seconds: config.WINNER_REVEAL_SECONDS,
    name_roll_duration_ms: config.NAME_ROLL_DURATION_MS,
    shuffle_passes: config.SHUFFLE_PASSES,
    beep_enabled: config.BEEP_ENABLED,
    confetti_enabled: config.CONFETTI_ENABLED,
    supabase: {
      url: supa.url,
      anon_key: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
      is_configured: supa.isConfigured
    }
  });
});
app.get(["/api/public/draw/state", "/api/public/state"], (_req, res) => {
  res.json(raffleService.getPublicState());
});
app.get("/api/public/page-access-status", async (req, res) => {
  const page = req.query.page || "";
  const settings = await supabaseRepository.getPageAccessSettings();
  let isRestricted = false;
  if (page === "audience" && !settings.audience) isRestricted = true;
  if (page === "participants" && !settings.participants) isRestricted = true;
  if (page === "health" && !settings.health) isRestricted = true;
  if (page === "results" && !settings.results) isRestricted = true;
  res.json({
    settings,
    is_restricted: isRestricted,
    message: settings.restriction_message
  });
});
app.get("/api/public/participants", async (req, res) => {
  const q = req.query.q || "";
  const type = req.query.type || "all";
  const status = req.query.status || "all";
  const page = parseInt(req.query.page || "1", 10) || 1;
  const limit = parseInt(req.query.limit || "15", 10) || 15;
  const result = await raffleService.searchParticipantsPaginated({ q, type, status, page, limit });
  res.json(result);
});
app.get("/api/public/roll-pool", (_req, res) => {
  const pool = raffleService.getRollingPool(200);
  res.json({ pool });
});
app.get("/api/public/events", (_req, res) => {
  wsManager.registerSseClient(res, "audience");
});
app.get("/api/controller/events", requireControllerAuth, (_req, res) => {
  wsManager.registerSseClient(res, "controller");
});
app.all("/api/public/telemetry/heartbeat", (req, res) => {
  const sessionId = req.body?.session_id || req.query?.session_id || req.ip || "anonymous";
  const page = req.body?.page || req.query?.page || "/";
  const ip = req.ip || "";
  const ua = req.headers["user-agent"] || "";
  supabaseRepository.recordVisitorHeartbeat(String(sessionId), ip, ua, String(page));
  res.json({ success: true });
});
app.get("/api/public/telemetry/analytics", (_req, res) => {
  res.json(supabaseRepository.getVisitorAnalytics());
});
app.post("/api/public/participants/register", async (req, res) => {
  const pageAccess = await supabaseRepository.getPageAccessSettings();
  if (pageAccess.self_registration === false) {
    return res.status(403).json({
      success: false,
      message: "Participant self-registration is currently closed by the event administrator."
    });
  }
  const { name, external_id, type, designation } = req.body;
  if (!name || !type) {
    return res.status(400).json({ success: false, message: "Name and participant type are required." });
  }
  const result = await supabaseRepository.createRegistrationRequest({
    name,
    external_id,
    type,
    designation
  });
  if (!result.success) {
    return res.status(400).json(result);
  }
  const ctrlState = await raffleService.getControllerState();
  wsManager.broadcastController("STATE_UPDATED", ctrlState);
  return res.json(result);
});
app.get("/api/health", async (_req, res) => {
  const mem = process.memoryUsage();
  const wsStats = wsManager.getStats();
  const pubState = raffleService.getPublicState();
  const participants = await raffleService.searchParticipants({});
  const supabaseHealth = await checkSupabaseHealth();
  const isHealthy = supabaseHealth.connected;
  res.json({
    status: isHealthy ? "healthy" : "degraded",
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    event: config.EVENT_NAME,
    supabase: supabaseHealth,
    services: {
      api: true,
      websocket: true,
      supabase: supabaseHealth.connected,
      database: isHealthy,
      session: true,
      participants: participants.total >= 0,
      results: true,
      audit: true
    },
    metrics: {
      total_participants: participants.total,
      eligible_count: participants.counts.eligible,
      completed_winners: pubState.completed_winners,
      total_winners: config.TOTAL_WINNERS,
      active_ws_connections: wsStats.total,
      audience_connections: wsStats.audience,
      controller_connections: wsStats.controller,
      draw_lock_active: pubState.status === "DRAWING"
    },
    memory: {
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024)
    }
  });
});
app.get(["/api/results", "/api/public/results"], async (_req, res) => {
  try {
    const data = await supabaseRepository.getResults();
    res.json({
      event: config.EVENT_NAME,
      total_winners: config.TOTAL_WINNERS,
      results: data.results,
      ignored: data.ignored
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Unable to retrieve results at this time." });
  }
});
var loginRateLimitMap = /* @__PURE__ */ new Map();
app.post("/api/controller/auth/login", (req, res) => {
  const clientIp = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const tracker = loginRateLimitMap.get(clientIp);
  if (tracker && tracker.lockedUntil > now) {
    const remainingSec = Math.ceil((tracker.lockedUntil - now) / 1e3);
    return res.status(429).json({
      success: false,
      message: `Too many failed login attempts. Temporarily locked for ${remainingSec} seconds.`
    });
  }
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: "Username and password are required." });
  }
  const userMatch = username.length === config.CONTROLLER_USERNAME.length && crypto3.timingSafeEqual(Buffer.from(username), Buffer.from(config.CONTROLLER_USERNAME));
  const passMatch = password.length === config.CONTROLLER_PASSWORD.length && crypto3.timingSafeEqual(Buffer.from(password), Buffer.from(config.CONTROLLER_PASSWORD));
  if (!userMatch || !passMatch) {
    const currentAttempts = (tracker ? tracker.attempts : 0) + 1;
    if (currentAttempts >= 5) {
      loginRateLimitMap.set(clientIp, {
        attempts: currentAttempts,
        lockedUntil: now + 15 * 60 * 1e3
        // 15 minute lock
      });
      return res.status(429).json({
        success: false,
        message: "Too many failed login attempts. Account temporarily locked for 15 minutes."
      });
    } else {
      loginRateLimitMap.set(clientIp, {
        attempts: currentAttempts,
        lockedUntil: 0
      });
      return res.status(401).json({
        success: false,
        message: `Invalid controller credentials. ${5 - currentAttempts} attempts remaining.`
      });
    }
  }
  loginRateLimitMap.delete(clientIp);
  const token = generateSessionToken(config.CONTROLLER_USERNAME);
  res.cookie("raffle_ctrl_session", token, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1e3,
    signed: true
  });
  return res.json({
    success: true,
    message: "Authenticated successfully as event controller.",
    token,
    user: config.CONTROLLER_USERNAME
  });
});
app.post("/api/controller/auth/logout", (_req, res) => {
  res.clearCookie("raffle_ctrl_session");
  return res.json({ success: true, message: "Logged out successfully." });
});
app.get("/api/controller/auth/check", (req, res) => {
  const cookieToken = req.signedCookies?.raffle_ctrl_session || req.cookies?.raffle_ctrl_session;
  const headerToken = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const token = cookieToken || headerToken;
  const isAuth = !!token && verifySessionToken(token);
  return res.json({ authenticated: isAuth, user: isAuth ? config.CONTROLLER_USERNAME : null });
});
app.get("/api/controller/state", requireControllerAuth, async (_req, res) => {
  const state = await raffleService.getControllerState();
  res.json(state);
});
app.get("/api/controller/participants/search", requireControllerAuth, async (req, res) => {
  const q = req.query.q || "";
  const type = req.query.type || "all";
  const status = req.query.status || "all";
  const result = await raffleService.searchParticipants(q, type, status);
  res.json({
    total: result.filtered_total ?? result.participants.length,
    is_db_empty: result.is_db_empty,
    counts: result.counts,
    participants: result.participants
  });
});
app.post("/api/controller/draw/start", requireControllerAuth, async (_req, res) => {
  const result = await raffleService.startDraw();
  if (!result.success) {
    return res.status(400).json(result);
  }
  return res.json(result);
});
app.post("/api/controller/draw/confirm", requireControllerAuth, async (_req, res) => {
  const result = await raffleService.confirmWinner();
  if (!result.success) {
    return res.status(400).json(result);
  }
  return res.json(result);
});
app.post("/api/controller/draw/ignore", requireControllerAuth, async (req, res) => {
  const reason = req.body.reason || "absent";
  const result = await raffleService.ignoreCandidate(reason);
  if (!result.success) {
    return res.status(400).json(result);
  }
  return res.json(result);
});
app.post("/api/controller/pause", requireControllerAuth, async (_req, res) => {
  return res.json(await raffleService.pause());
});
app.post("/api/controller/resume", requireControllerAuth, async (_req, res) => {
  return res.json(await raffleService.resume());
});
app.post("/api/controller/draw/restore-interrupted", requireControllerAuth, async (_req, res) => {
  const result = await raffleService.restoreInterrupted();
  if (!result.success) return res.status(400).json(result);
  return res.json(result);
});
app.post("/api/controller/draw/cancel-interrupted", requireControllerAuth, async (_req, res) => {
  const result = await raffleService.cancelInterrupted();
  if (!result.success) return res.status(400).json(result);
  return res.json(result);
});
app.post("/api/controller/reset", requireControllerAuth, async (req, res) => {
  const { confirmation } = req.body;
  const result = await raffleService.resetSession(confirmation);
  if (!result.success) {
    return res.status(400).json(result);
  }
  return res.json(result);
});
app.post("/api/controller/settings/page-access", requireControllerAuth, async (req, res) => {
  const updated = await supabaseRepository.updatePageAccessSettings(req.body);
  wsManager.broadcastAll("PAGE_ACCESS_UPDATED", updated);
  res.json({ success: true, settings: updated });
});
app.get("/api/controller/registrations", requireControllerAuth, async (_req, res) => {
  const requests = await supabaseRepository.getRegistrationRequests();
  res.json({ requests });
});
app.post("/api/controller/registrations/:id/review", requireControllerAuth, async (req, res) => {
  const { action, notes } = req.body;
  const result = await supabaseRepository.reviewRegistrationRequest(
    req.params.id,
    action === "approve" ? "approve" : "reject",
    config.CONTROLLER_USERNAME,
    notes
  );
  if (!result.success) return res.status(400).json(result);
  await raffleService.reloadParticipants();
  const updatedCtrlState = await raffleService.getControllerState();
  wsManager.broadcastController("STATE_UPDATED", updatedCtrlState);
  res.json(result);
});
app.post("/api/controller/registrations/batch-review", requireControllerAuth, async (req, res) => {
  const { action, request_ids } = req.body;
  const result = await supabaseRepository.batchReviewRegistrationRequests(
    action === "approve" ? "approve" : "reject",
    config.CONTROLLER_USERNAME,
    request_ids
  );
  if (!result.success) return res.status(400).json(result);
  await raffleService.reloadParticipants();
  const updatedCtrlState = await raffleService.getControllerState();
  wsManager.broadcastController("STATE_UPDATED", updatedCtrlState);
  res.json(result);
});
app.post("/api/controller/participants/verify", requireControllerAuth, async (req, res) => {
  const { id, name, type, eligible } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, message: "Participant name is required." });
  }
  const result = await raffleService.setParticipantEligibility(
    { id, name, type },
    eligible !== void 0 ? Number(eligible) : 1
  );
  res.json(result);
});
app.post("/api/controller/db/truncate", requireControllerAuth, async (req, res) => {
  const { confirmation } = req.body;
  const result = await supabaseRepository.truncateFestTables(confirmation);
  if (!result.success) return res.status(400).json(result);
  await raffleService.reloadParticipants();
  const updatedCtrlState = await raffleService.getControllerState();
  wsManager.broadcastController("STATE_UPDATED", updatedCtrlState);
  res.json(result);
});
app.get("/api/controller/db/status", requireControllerAuth, async (_req, res) => {
  const health = await checkSupabaseHealth();
  res.json(health);
});
app.post("/api/controller/participants/import", requireControllerAuth, async (req, res) => {
  const { participants } = req.body;
  if (!Array.isArray(participants) || participants.length === 0) {
    return res.status(400).json({ success: false, message: "Invalid or empty participants array." });
  }
  const result = await supabaseRepository.importParticipants(participants);
  await raffleService.reloadParticipants();
  const updatedCtrlState = await raffleService.getControllerState();
  wsManager.broadcastController("STATE_UPDATED", updatedCtrlState);
  res.json({ success: true, ...result });
});
app.get("/api/controller/seed/preview", requireControllerAuth, async (_req, res) => {
  try {
    let fileInfo = findRootExcelFile();
    if (!fileInfo) {
      const samplePath = ensureSampleExcelFile();
      fileInfo = { filePath: samplePath, fileName: "data.excel" };
    }
    const fileBuffer = fs2.readFileSync(fileInfo.filePath);
    const parsed = parseExcelBuffer(fileBuffer, fileInfo.fileName);
    const dbHealth = await checkSupabaseHealth();
    res.json({
      success: true,
      data: parsed,
      dbStatus: {
        connected: dbHealth.connected,
        current_participants: dbHealth.participant_count,
        is_empty: dbHealth.is_empty
      }
    });
  } catch (err) {
    console.error("[Controller API] Excel Preview Error:", err);
    res.status(500).json({
      success: false,
      message: `Failed to read excel file: ${err.message}`
    });
  }
});
app.post("/api/controller/seed/parse-upload", requireControllerAuth, async (req, res) => {
  try {
    const { base64Data, fileName } = req.body;
    if (!base64Data) {
      return res.status(400).json({ success: false, message: "Missing base64Data in request." });
    }
    const buffer = Buffer.from(base64Data, "base64");
    const parsed = parseExcelBuffer(buffer, fileName || "uploaded.xlsx");
    const dbHealth = await checkSupabaseHealth();
    res.json({
      success: true,
      data: parsed,
      dbStatus: {
        connected: dbHealth.connected,
        current_participants: dbHealth.participant_count,
        is_empty: dbHealth.is_empty
      }
    });
  } catch (err) {
    console.error("[Controller API] Excel Upload Parse Error:", err);
    res.status(400).json({
      success: false,
      message: `Failed to parse uploaded excel file: ${err.message}`
    });
  }
});
app.post("/api/controller/seed/commit", requireControllerAuth, async (req, res) => {
  try {
    const { rows, mode } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: "No rows provided to commit." });
    }
    const result = await commitExcelParticipantsToDb(rows, mode === "replace" ? "replace" : "append");
    await raffleService.reloadParticipants();
    const updatedCtrlState = await raffleService.getControllerState();
    wsManager.broadcastController("STATE_UPDATED", updatedCtrlState);
    wsManager.broadcastAudience("DRAW_STATE", raffleService.getPublicState());
    res.json(result);
  } catch (err) {
    console.error("[Controller API] Excel Commit Error:", err);
    res.status(500).json({
      success: false,
      message: `Failed to commit participants: ${err.message}`
    });
  }
});
function sendCsv(res, filename, headers, rows) {
  const escapeCell = (val) => {
    if (val === null || val === void 0) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };
  const headerLine = headers.map(escapeCell).join(",");
  const rowLines = rows.map((r) => r.map(escapeCell).join(",")).join("\r\n");
  const csvContent = "\uFEFF" + headerLine + "\r\n" + rowLines;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csvContent);
}
app.get("/api/controller/export/winners.csv", requireControllerAuth, async (_req, res) => {
  const data = await supabaseRepository.getResults();
  const headers = ["Serial", "Category", "ID_Roll", "Name", "Designation", "Status", "Drawn_At"];
  const rows = data.results.map((w) => [
    `#${String(w.serial).padStart(2, "0")}`,
    w.type.toUpperCase(),
    w.id || "N/A",
    w.name,
    w.designation || "DUET CSE",
    w.status,
    w.drawn_at
  ]);
  sendCsv(res, `DUET_CSE_Fest_2026_Official_Winners_${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.csv`, headers, rows);
});
app.get("/api/controller/export/participants.csv", requireControllerAuth, async (_req, res) => {
  const participants = await supabaseRepository.getParticipants();
  const headers = ["ID_Roll", "Name", "Category", "Designation", "Eligible_State"];
  const rows = participants.map((p) => [
    p.id || "N/A",
    p.name,
    p.type.toUpperCase(),
    p.designation || "DUET CSE",
    p.eligible === 1 ? "ELIGIBLE" : "INELIGIBLE"
  ]);
  sendCsv(res, `DUET_CSE_Fest_2026_Participants_${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.csv`, headers, rows);
});
app.get("/api/controller/export/registrations.csv", requireControllerAuth, async (_req, res) => {
  const requests = await supabaseRepository.getRegistrationRequests();
  const headers = ["Request_ID", "ID_Roll", "Name", "Category", "Designation", "Status", "Reviewed_By", "Submitted_At"];
  const rows = requests.map((r) => [
    r.id,
    r.external_id || "N/A",
    r.name,
    r.type.toUpperCase(),
    r.designation || "DUET CSE",
    r.status.toUpperCase(),
    r.reviewed_by || "Pending",
    r.created_at
  ]);
  sendCsv(res, `DUET_CSE_Fest_2026_Self_Registrations_${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.csv`, headers, rows);
});
app.get("/api/controller/export/audit-logs.csv", requireControllerAuth, async (_req, res) => {
  const logs = await supabaseRepository.getAuditLogs(500);
  const headers = ["ID", "Action", "Details_JSON", "IP_Address", "Timestamp"];
  const rows = logs.map((l) => [
    l.id,
    l.action,
    JSON.stringify(l.details || {}),
    l.ip_address || "N/A",
    l.timestamp
  ]);
  sendCsv(res, `DUET_CSE_Fest_2026_Audit_Logs_${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.csv`, headers, rows);
});
app.get("/api/controller/export/visitor-analytics.csv", requireControllerAuth, (_req, res) => {
  const stats = supabaseRepository.getVisitorAnalytics();
  const headers = ["Active_Now", "Total_Page_Views", "Unique_IP_Visitors", "Peak_Concurrent", "Exported_At"];
  const rows = [
    [stats.active_now, stats.total_views, stats.unique_visitors, stats.peak_concurrent, (/* @__PURE__ */ new Date()).toISOString()]
  ];
  sendCsv(res, `DUET_CSE_Fest_2026_Visitor_Analytics_${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.csv`, headers, rows);
});
app.use((err, _req, res, _next) => {
  console.error("[API Error Handler]:", err);
  if (!res.headersSent) {
    res.status(err.status || 500).json({
      success: false,
      error: err.message || "Internal Server Error"
    });
  }
});
async function setupViteOrStatic() {
  if (process.env.VERCEL || process.env.VERCEL_ENV || process.env.NOW_REGION || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return;
  }
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path2.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path2.join(distPath, "index.html"));
    });
  }
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`========================================================`);
    console.log(`DUET CSE Fest 2026 Raffle Server running on port ${PORT}`);
    console.log(`Audience URL   : http://localhost:${PORT}/ or /draw`);
    console.log(`Controller URL : http://localhost:${PORT}/controller`);
    console.log(`Remote URL     : http://localhost:${PORT}/remote`);
    console.log(`Directory URL  : http://localhost:${PORT}/participants`);
    console.log(`Results URL    : http://localhost:${PORT}/results`);
    console.log(`Health URL     : http://localhost:${PORT}/health`);
    console.log(`========================================================`);
  });
}
if (isDirectExecution && !process.env.VERCEL && !process.env.NOW_REGION && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  setupViteOrStatic();
}
var server_default = app;
export {
  app,
  server_default as default,
  server
};
//# sourceMappingURL=index.js.map
