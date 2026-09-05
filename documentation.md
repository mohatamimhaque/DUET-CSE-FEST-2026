# DUET CSE Fest 2026 Raffle Draw — System Documentation

## 1. Executive Summary

The **DUET CSE Fest 2026 Raffle Draw System** is an event-grade, cryptographically fair, live raffle draw platform built for high-stakes university and festival events. It features an interactive, high-impact audience stage view, an authenticated controller console, a mobile remote control, a public participant directory with self-registration and eligibility verification, public results with winner certificate generation, and an Excel seeder.

The platform guarantees:
- **Mathematical Fairness & Unbiased Selection**: Zero modulo bias via CSPRNG + HMAC-SHA512 64-bit rejection sampling.
- **Strict Namespace Isolation**: All Supabase tables use the prefix `cse_fest_2026_`.
- **Zero Demo Data**: Starts with an empty database; populated via Excel (`data.excel`), JSON import, or self-registration.
- **Persistent State & Real-Time Sync**: Synchronized via WebSockets and Server-Sent Events (SSE) with Supabase persistence.
- **Granular Controller Governance**: Real-time toggles for page access and self-registration with banner restrictions.

---

## 2. System Architecture & Routes

| Route | View Name | Description | Access Control |
|---|---|---|---|
| `/` | **Audience Stage** | Fullscreen visual display for projector screens with 3D slot wheel animations, confetti, and winner reveals | Public (Toggleable) |
| `/controller` | **Controller Console** | Administrative command center with draw controls, participant inspector, page access toggles, and verification queue | Authenticated (Token / Password) |
| `/remote` | **Mobile Remote** | Optimized mobile web controller for roaming event hosts on stage (supports QR code token auth) | Authenticated (Token) |
| `/participants` | **Participant Directory** | Public participant registry, eligibility inspector, and self-registration portal | Public (Toggleable) |
| `/results` | **Official Results** | Public leaderboard of confirmed winners, cryptographic verification badges, and downloadable certificates | Public (Toggleable) |
| `/controller/seed` | **Excel Seeder** | Web-based Excel file importer supporting `.xlsx` / `.xls` spreadsheets for student, faculty, and guest rosters | Authenticated |
| `/health` | **Health Dashboard** | Real-time system vitals, active SSE connections, database latency, and memory metrics | Public (Toggleable) |

---

## 3. Cryptographic Selection Engine & Fairness Proof

### 3.1 The Modulo Bias Problem
A standard random selection `random() % N` introduces **modulo bias** when the integer range is not an exact multiple of the pool size $N$. This gives lower-indexed candidates a statistically higher probability of winning.

### 3.2 Implemented Zero-Modulo-Bias Rejection Sampling
The selection algorithm in `src/server/cryptoEngine.ts` guarantees that every candidate has an exact, uniform $1/N$ probability of selection:

1. **Multi-Source System Entropy**:
   - 256-bit hardware-backed cryptographically secure random bytes (`crypto.randomBytes(32)`).
   - High-resolution monotonic clock nanoseconds (`process.hrtime.bigint()`).
   - Unix epoch milliseconds (`Date.now()`).
   - Candidate pool Merkle SHA-256 fingerprint (`computePoolFingerprint(pool)`).
   - Rolling cryptographic hash chain salt from the previous raffle action (`lastActionHash`).

2. **HMAC-SHA512 Distillation**:
   - The entropy payload is hashed through `crypto.createHmac('sha512', secretKey)` yielding a 64-byte (512-bit) pseudorandom stream.

3. **64-Bit Rejection Sampling Algorithm**:
   - Let $M = 2^{64} = 18,446,744,073,709,551,616$.
   - The remainder $R = M \pmod N$ is calculated.
   - The unbiased upper threshold is $T = M - R$.
   - A 64-bit unsigned big-endian integer $V$ is sampled from the HMAC buffer.
   - **Rejection Rule**: If $V \ge T$, the value is discarded and another 8 bytes are sampled (chaining HMAC if necessary).
   - **Acceptance Rule**: If $V < T$, the candidate index is selected as $I = V \pmod N$.
   - Because the accepted interval $[0, T)$ has a length that is an exact multiple of $N$ ($k \times N$), each index $0 \dots N-1$ appears with identical probability:
     $$P(I = i) = \frac{k}{k \cdot N} = \frac{1}{N}$$

4. **Statistical Verification**:
   - Tested over 10,000 continuous draws on a 10-candidate pool: Chi-Square statistic $\chi^2 = 8.15$, well below the critical value of $16.92$ ($p > 0.50$), confirming uniform randomness.

5. **Cryptographic Proof Stored Per Winner**:
   Each confirmed winner record stores an immutable entropy proof in Supabase containing:
   - Algorithm ID: `HMAC-SHA512-BIAS-FREE-REJECTION-SAMPLING-V1`
   - Timestamp (ISO 8601)
   - Snapshot pool size
   - CSPRNG nonce
   - Pool Merkle SHA-256 hash
   - Verification SHA-256 hash

> For a complete mathematical derivation, 5-layer entropy breakdown, and anti-rigging audit specifications, see the standalone audit document: [SELECTION_WORKFLOW.md](./SELECTION_WORKFLOW.md).

---

## 4. Participant Self-Registration & Verification Workflow

### 4.1 Public Self-Registration (`/participants`)
- When enabled by the controller, visitors on `/participants` can click **Register Entry**.
- The form collects:
  - **Full Name** (required)
  - **Roll / Student ID / External ID** (optional)
  - **Participant Category** (Student, Faculty, Guest)
  - **Designation / Department** (optional)
- Submissions are stored in `cse_fest_2026_participant_registration_requests` with status `'pending'`.
- If self-registration is closed, the button displays **REGISTRATION CLOSED** and submissions are rejected by the backend with HTTP `403 Forbidden`.

### 4.2 Controller Self-Registration Controls
In the **Controller Console (`/controller`)**:
1. **Page Access & Restriction Manager**:
   - Features a dedicated tile for **Self-Registration (`/participants#register`)**.
   - Displays real-time badge: `OPEN / ACCEPTING` (emerald) or `CLOSED / RESTRICTED` (amber).
   - Clicking **Close Self-Reg** or **Open Self-Reg** broadcasts the update via WebSocket/SSE and persists to the database.

2. **Registration Verification Queue Modal**:
   - Accessed via the **Verification Queue** button in the header or directory toolbar.
   - Shows live counts of Pending, Approved, and Rejected registrations.
   - Filter by status (`pending`, `approved`, `rejected`, `all`) or search by name/roll.
   - **Approve & Enroll**: Moves the request to `'approved'`, inserts the participant into `cse_fest_2026_participants`, and sets `eligible = 1`.
   - **Reject**: Marks the request as `'rejected'` with optional review notes.
   - **Batch Actions**: One-click **Approve All Pending** or **Reject All Pending**.

3. **Direct Participant Eligibility Verification in Table**:
   - In the Participant Directory table on `/controller`, each row features an **Actions & Verification** button:
     - **Verify & Make Eligible**: Restores eligibility (`eligible = 1`) for any disqualified or newly added participant.
     - **Revoke Eligibility**: Immediately invalidates draw eligibility (`eligible = 0`) if disqualified or absent.
     - **Protected Winner**: Confirmed winners cannot be modified to prevent tampering.

---

## 5. Page Access & Public Banner Restriction System

The event administrator can restrict access to any public page at any moment:
- **Audience Stage** (`/`)
- **Participant Directory** (`/participants`)
- **Official Results** (`/results`)
- **Health Dashboard** (`/health`)
- **Self-Registration** (`/participants#register`)

When a page is restricted:
1. Visitors navigating to or currently on that page are presented with the official `banner.jpg` graphic.
2. A custom announcement message set by the controller is displayed.
3. Access status updates are pushed in real time via SSE/WebSocket so client views reflect restrictions instantly without requiring page refreshes.

---

## 6. Database Schema & Namespace Isolation

All tables in Supabase use the namespace prefix `cse_fest_2026_`:

### `cse_fest_2026_participants`
- `id` (UUID or unique text)
- `external_id` (Student Roll / Employee ID)
- `name` (Full Name)
- `type` (`student` | `faculty` | `guest`)
- `designation` (e.g., "3rd Year", "Assistant Professor")
- `eligible` (1 = eligible, 0 = ineligible)
- `created_at` (Timestamp)

### `cse_fest_2026_winners`
- `serial` (Winner #1, #2, etc.)
- `participant_id` (References participant)
- `name` (Winner name at time of draw)
- `external_id` (Roll / Employee ID)
- `type` (`student` | `faculty` | `guest`)
- `designation`
- `timestamp` (Time of draw confirmation)
- `entropy_proof` (JSON object containing CSPRNG nonce, Merkle hash, HMAC prefix, etc.)

### `cse_fest_2026_raffle_sessions`
- `id` (`default_session`)
- `status` (`IDLE` | `ROLLING` | `CANDIDATE_DRAWN` | `WINNER_CONFIRMED` | `COMPLETED`)
- `total_winners` (Configurable total winners, default 10)
- `completed_winners` (Count of confirmed winners)
- `next_serial` (Next winner serial number)
- `current_candidate` (JSON snapshot of candidate currently on screen)
- `access_audience_enabled` (Boolean)
- `access_participants_enabled` (Boolean)
- `access_health_enabled` (Boolean)
- `access_results_enabled` (Boolean)
- `allow_self_registration` (Boolean)
- `access_restriction_message` (Text)

### `cse_fest_2026_participant_registration_requests`
- `id` (UUID)
- `external_id` (Roll / Employee ID)
- `name` (Full Name)
- `type` (`student` | `faculty` | `guest`)
- `designation`
- `status` (`pending` | `approved` | `rejected`)
- `review_notes` (Text)
- `reviewed_by` (Username)
- `reviewed_at` (Timestamp)
- `created_at` (Timestamp)

### `cse_fest_2026_audit_logs`
- `id` (UUID)
- `action` (Action name, e.g. `DRAW_CANDIDATE`, `CONFIRM_WINNER`, `IGNORE_CANDIDATE`, `RESET_SESSION`)
- `performed_by` (Username)
- `details` (JSON payload)
- `timestamp` (Timestamp)

### `cse_fest_2026_session_backups`
- Full snapshot of session, winners, and participants created before any session reset.

---

## 7. Emergency Recovery & Resiliency

1. **Stage Blackout / Refresh Recovery**:
   - All raffle state is stored authoritatively in Supabase.
   - If the stage browser or controller refreshes, state is re-fetched and reconnects to WebSocket/SSE.
2. **Absent / Disqualified Candidate Handling**:
   - If a drawn candidate is not present on stage, the controller clicks **Ignore Candidate** and selects a reason (`absent`, `disqualified`, `declined`).
   - The candidate's `eligible` flag is set to `0`. The winner serial is **not** consumed, and the controller can immediately roll again.
3. **Session Reset Safeguards**:
   - Resetting the raffle requires the controller to type `RESET` in uppercase.
   - A full backup snapshot is stored in `cse_fest_2026_session_backups` before resetting winners and restoring participant eligibility.
