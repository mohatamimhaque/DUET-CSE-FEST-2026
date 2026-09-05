-- =========================================================================
-- DUET CSE FEST 2026 — OFFICIAL SUPABASE / POSTGRESQL DATABASE SCHEMA
-- Strict Namespace Prefix: cse_fest_2026_*
-- ZERO DEMO DATA: Database starts clean. Displays "DB is empty" until populated.
-- =========================================================================

-- Enable required pgcrypto extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -------------------------------------------------------------------------
-- 1. PARTICIPANTS TABLE
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cse_fest_2026_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id VARCHAR(100),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('student', 'faculty', 'guest')),
    designation VARCHAR(255),
    department VARCHAR(100) DEFAULT 'CSE',
    eligible SMALLINT DEFAULT 1 CHECK (eligible IN (0, 1)),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique index on non-null external_id (e.g. Student Roll)
CREATE UNIQUE INDEX IF NOT EXISTS idx_cse_fest_2026_participants_external_id_unique
    ON cse_fest_2026_participants(LOWER(TRIM(external_id)))
    WHERE external_id IS NOT NULL AND TRIM(external_id) != '';

-- Fast lookup indexes for draw engine and search queries
CREATE INDEX IF NOT EXISTS idx_cse_fest_2026_participants_eligible ON cse_fest_2026_participants(eligible);
CREATE INDEX IF NOT EXISTS idx_cse_fest_2026_participants_type ON cse_fest_2026_participants(type);
CREATE INDEX IF NOT EXISTS idx_cse_fest_2026_participants_name_trgm ON cse_fest_2026_participants(name);

-- -------------------------------------------------------------------------
-- 2. PARTICIPANT SELF-REGISTRATION REQUESTS TABLE
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cse_fest_2026_participant_registration_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id VARCHAR(100),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('student', 'faculty', 'guest')),
    designation VARCHAR(255),
    department VARCHAR(100) DEFAULT 'CSE',
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    review_notes TEXT,
    reviewed_by VARCHAR(100),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cse_fest_2026_reg_status ON cse_fest_2026_participant_registration_requests(status);

-- -------------------------------------------------------------------------
-- 3. RAFFLE SESSIONS TABLE (SINGLETON CONTROLLER STATE)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cse_fest_2026_raffle_sessions (
    id VARCHAR(100) PRIMARY KEY DEFAULT 'default_session',
    event_name VARCHAR(255) DEFAULT 'DUET CSE Fest 2026',
    status VARCHAR(50) DEFAULT 'READY' CHECK (
        status IN ('READY', 'DRAWING', 'WAITING_CONFIRMATION', 'CANDIDATE_SELECTED', 'WINNER_CONFIRMED', 'IGNORED', 'PAUSED', 'COMPLETED', 'INTERRUPTED')
    ),
    total_winners INT DEFAULT 10,
    completed_winners INT DEFAULT 0,
    next_serial INT DEFAULT 1,
    current_candidate JSONB,
    last_action VARCHAR(255) DEFAULT 'INITIALIZED',
    access_audience_enabled BOOLEAN DEFAULT TRUE,
    access_participants_enabled BOOLEAN DEFAULT TRUE,
    access_health_enabled BOOLEAN DEFAULT TRUE,
    access_results_enabled BOOLEAN DEFAULT TRUE,
    access_restriction_message TEXT DEFAULT 'This page is temporarily restricted by the event controller. Please stay tuned.',
    allow_self_registration BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed singleton session row if not exists (Zero demo participants!)
INSERT INTO cse_fest_2026_raffle_sessions (
    id, event_name, status, total_winners, completed_winners, next_serial,
    access_audience_enabled, access_participants_enabled, access_health_enabled, access_results_enabled
) VALUES (
    'default_session', 'DUET CSE Fest 2026', 'READY', 10, 0, 1,
    TRUE, TRUE, TRUE, TRUE
) ON CONFLICT (id) DO NOTHING;

-- -------------------------------------------------------------------------
-- 4. OFFICIAL WINNER RESULTS TABLE
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cse_fest_2026_winner_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    serial INT NOT NULL UNIQUE,
    participant_id UUID REFERENCES cse_fest_2026_participants(id) ON DELETE SET NULL,
    type VARCHAR(50) NOT NULL,
    external_id VARCHAR(100),
    name VARCHAR(255) NOT NULL,
    designation VARCHAR(255),
    status VARCHAR(50) DEFAULT 'winner',
    crypto_hash TEXT,
    drawn_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cse_fest_2026_winner_serial ON cse_fest_2026_winner_results(serial);

-- -------------------------------------------------------------------------
-- 5. IGNORED / INELIGIBLE CANDIDATES TABLE
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cse_fest_2026_ignored_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id UUID REFERENCES cse_fest_2026_participants(id) ON DELETE SET NULL,
    type VARCHAR(50) NOT NULL,
    external_id VARCHAR(100),
    name VARCHAR(255) NOT NULL,
    designation VARCHAR(255),
    reason VARCHAR(255) DEFAULT 'absent',
    status VARCHAR(50) DEFAULT 'ignored',
    drawn_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cse_fest_2026_ignored_at ON cse_fest_2026_ignored_candidates(drawn_at);

-- -------------------------------------------------------------------------
-- 6. IMMUTABLE AUDIT LOGS TABLE
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cse_fest_2026_audit_logs (
    id BIGSERIAL PRIMARY KEY,
    action VARCHAR(100) NOT NULL,
    details JSONB,
    ip_address VARCHAR(100),
    user_agent TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cse_fest_2026_audit_timestamp ON cse_fest_2026_audit_logs(timestamp DESC);

-- -------------------------------------------------------------------------
-- 7. LIVE VISITOR SESSIONS TABLE (Real-Time Audience Telemetry)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cse_fest_2026_live_visitor_sessions (
    id VARCHAR(100) PRIMARY KEY,
    ip_address VARCHAR(100),
    user_agent TEXT,
    page_viewed VARCHAR(255) DEFAULT '/',
    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    last_heartbeat_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_cse_fest_2026_visitor_active ON cse_fest_2026_live_visitor_sessions(is_active, last_heartbeat_at);

-- -------------------------------------------------------------------------
-- 8. EVENT VISITOR ANALYTICS TABLE
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cse_fest_2026_event_visitor_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_name VARCHAR(255) DEFAULT 'DUET CSE Fest 2026' UNIQUE,
    total_views BIGINT DEFAULT 0,
    unique_ips BIGINT DEFAULT 0,
    peak_concurrent INT DEFAULT 0,
    last_updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO cse_fest_2026_event_visitor_analytics (event_name, total_views, unique_ips, peak_concurrent)
VALUES ('DUET CSE Fest 2026', 0, 0, 0)
ON CONFLICT (event_name) DO NOTHING;

-- -------------------------------------------------------------------------
-- 9. AUDIENCE TIMELINE SNAPSHOTS TABLE
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cse_fest_2026_audience_timeline_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    serial INT NOT NULL,
    phase VARCHAR(50) NOT NULL,
    snapshot_data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cse_fest_2026_snapshots_serial ON cse_fest_2026_audience_timeline_snapshots(serial);

-- =========================================================================
-- END OF SCHEMA
-- All tables are completely isolated under the cse_fest_2026_* namespace.
-- =========================================================================
