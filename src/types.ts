export type ParticipantType = 'student' | 'faculty' | 'guest';

export interface WorkspaceModule {
  id: string;
  name: string;
  path: string;
  description: string;
  status: 'ready' | 'pending';
}

export interface Participant {
  type: ParticipantType;
  id: string | null;
  name: string;
  designation: string | null;
  eligible: number; // 1 = eligible, 0 = ineligible
}

export type RaffleStatus =
  | 'READY'
  | 'DRAWING'
  | 'CANDIDATE_SELECTED'
  | 'WAITING_CONFIRMATION'
  | 'WINNER_CONFIRMED'
  | 'IGNORED'
  | 'PAUSED'
  | 'INTERRUPTED'
  | 'COMPLETED'
  | 'ERROR';

export interface WinnerResult {
  serial: number;
  type: ParticipantType;
  id: string | null;
  name: string;
  designation?: string | null;
  status: 'winner';
  drawn_at: string;
}

export interface IgnoredCandidate {
  serial: null;
  type: ParticipantType;
  id: string | null;
  name: string;
  designation?: string | null;
  status: 'ignored';
  reason: string;
  drawn_at: string;
}

export interface SessionState {
  event: string;
  status: RaffleStatus;
  total_winners: number;
  completed_winners: number;
  next_serial: number;
  current_candidate: Participant | null;
  last_action: string;
  updated_at: string;
  is_db_empty?: boolean;
}

export interface PageAccessSettings {
  audience: boolean;
  participants: boolean;
  health: boolean;
  results: boolean;
  self_registration?: boolean;
  restriction_message: string;
}

export interface RegistrationRequest {
  id: string;
  external_id: string | null;
  name: string;
  type: ParticipantType;
  designation: string | null;
  department: string;
  status: 'pending' | 'approved' | 'rejected';
  review_notes?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at: string;
}

export interface VisitorAnalytics {
  active_now: number;
  total_views: number;
  unique_visitors: number;
  peak_concurrent: number;
}

export interface AuditRecord {
  action: string;
  timestamp: string;
  details?: Record<string, any>;
}

export interface PublicEventInfo {
  event_name: string;
  total_winners: number;
  countdown_seconds: number;
  reveal_seconds: number;
  name_roll_duration_ms: number;
  shuffle_passes: number;
  beep_enabled: boolean;
  confetti_enabled: boolean;
}

export interface PublicDrawState {
  event: string;
  status: RaffleStatus;
  total_winners: number;
  completed_winners: number;
  next_serial: number;
  current_candidate: {
    type: ParticipantType;
    id: string | null;
    name: string;
    designation: string | null;
  } | null;
  last_winner: WinnerResult | null;
  last_action: string;
  is_db_empty?: boolean;
}

export interface ControllerState extends SessionState {
  eligible_count: number;
  total_participants: number;
  students_count: number;
  faculty_count: number;
  guest_count: number;
  winners_count: number;
  ignored_count: number;
  is_locked: boolean;
  has_interrupted: boolean;
  is_db_empty?: boolean;
  page_access?: PageAccessSettings;
  pending_registrations_count?: number;
  visitor_analytics?: VisitorAnalytics;
  winners?: WinnerResult[];
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime_seconds: number;
  timestamp: string;
  event: string;
  services: {
    api: boolean;
    websocket: boolean;
    supabase?: boolean;
    database?: boolean;
    storage?: boolean;
    session: boolean;
    participants: boolean;
    results: boolean;
    audit: boolean;
    backups?: boolean;
  };
  metrics: {
    total_participants: number;
    eligible_count: number;
    completed_winners: number;
    total_winners: number;
    active_ws_connections: number;
    audience_connections: number;
    controller_connections: number;
    draw_lock_active: boolean;
  };
  memory: {
    rss_mb: number;
    heap_used_mb: number;
  };
}

// Runtime compatibility placeholders for Node.js type stripping ESM loader
export const Participant = {} as any;
export const WinnerResult = {} as any;
export const IgnoredCandidate = {} as any;
export const SessionState = {} as any;
export const PageAccessSettings = {} as any;
export const RegistrationRequest = {} as any;
export const VisitorAnalytics = {} as any;
export const AuditRecord = {} as any;
export const PublicEventInfo = {} as any;
export const PublicDrawState = {} as any;
export const ControllerState = {} as any;
export const HealthStatus = {} as any;
export const WorkspaceModule = {} as any;
export const ParticipantType = {} as any;
export const RaffleStatus = {} as any;
