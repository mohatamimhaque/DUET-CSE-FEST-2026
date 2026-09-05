# Complete Database Architecture & System Plan
**Project:** DUET CSE FEST 2026 — Automated Stage Raffle System  
**Table Naming Standard:** All tables and collections are strictly prefixed with **`cse_fest_2026_`**  
**Core Features:** 
1. Full Migration from Flat JSON Files to a Production-Ready Database (`cse_fest_2026_` prefixed tables)
2. Real-Time Live Audience Telemetry & Presence Tracking for Controller Console
3. Public View Participant Self-Registration Modal with Mandatory Controller Verification / Rejection
4. Strict Duplicate Prevention Rules (Student by ID; Faculty & Guest by Name + Designation)
5. Standardized Designation for Students: **Every student designation is explicitly set to `'Student'`** (never null or empty)
6. **Strict Database Isolation & Safe Controller Maintenance**:
   - Controller can **Truncate** all festival tables or **Rebuild a Clean Schema**
   - **ZERO TOUCH on Other Tables**: Because the database is shared with another existing database/project, all maintenance scripts strictly target tables prefixed with `cse_fest_2026_`. All other tables are completely isolated, protected, and untouched.
7. **Admin / Controller CSV Export Center**:
   - One-click CSV file exports for Official Winners, Full Participant Directory (with filters), Registration Requests Queue, Audit Trail, and Live Viewership Telemetry.
   - RFC 4180 compliant with UTF-8 BOM encoding for seamless display in Microsoft Excel and Google Sheets.
8. **Provably Fair Cryptographic Winner Selection Engine**:
   - Multi-source entropy harvesting (OS CSPRNG, nanosecond CPU jitter, candidate pool Merkle root, previous winner hash-chain, ephemeral nonce).
   - HMAC-SHA512 entropy distillation and expansion.
   - 64-bit zero-modulo-bias rejection sampling to guarantee mathematically uniform probability ($\frac{1}{N}$) for every eligible attendee.
   - Cryptographic verification receipts for public auditing.
9. **Granular Public Page Access Control & Real-Time Dynamic Gating**:
   - Controller can independently toggle public access to **Audience Page**, **Public Participants Directory**, **System Health Diagnostics**, and **Official Results Page**.
   - If restricted, public visitors are prevented from viewing the page and receive an elegant, friendly, context-specific status message with live real-time unlocking.  
10. **Dedicated Mobile Stage Remote Controller (`/remote`) with PWA & Real-Time Sync**:
   - Designed specifically for stage presenters, MCs, and roaming coordinators operating on smartphones.
   - **Strictly Focused UI**: Displays only essential stage operations: Selected Candidate Card (`SELECTED CANDIDATE • WINNER #N`, category badge, candidate name, roll/designation), `[✓ PRESENT / CONFIRM WINNER #N]`, `[IGNORE / ABSENT]`, and the primary `[START DRAW FOR WINNER #N]` trigger.
   - **Accidental Touch Protection**: `Pause`, `Resume`, and `Reset` buttons are **strictly hidden and omitted** from the mobile view to prevent disastrous accidental stage disruptions or stalls.
   - **Full PWA Compliance**: Web App Manifest (`display: "standalone"`, mobile theme color, safe-area insets, app icons), service worker caching, and in-app installation prompts with iOS Safari guidance.
   - **Bidirectional Real-Time Sync**: 100% synchronized in sub-50ms via WebSockets with the desktop controller console (`/controller`), stage audience projector (`/audience`), and results page (`/results`).
11. **Strict UI/UX & CSS Preservation (Zero Regressions Contract)**:
   - **Do NOT Touch Existing UI/UX or CSS**: Absolute guarantee that the existing stage audience presentation, controller console layout, typography, animations, color palette, and global CSS (`index.css` / Tailwind styling) will remain **100% intact, unmodified, and untouched**.
   - **Zero Visual Regressions**: All database migrations, backend endpoints, and new pages (e.g. `/remote`) must be purely additive, strictly reusing existing Tailwind design patterns without altering or breaking any existing CSS rules or component layouts.
**Document Status:** Architecture Plan & Full Database Schema Specification  

---

## 1. Executive Summary & Strategic Rationale

The DUET CSE FEST 2026 Raffle System currently utilizes local file-based JSON stores (`data/session.json`, `data/participants.json`, `data/results.json`, `data/audit_log.json`).

Migrating the entire application to an **ACID-compliant Database** with dedicated namespace isolation (`cse_fest_2026_`) provides essential production guarantees:

1. **Strict Namespace Isolation & Shared Database Protection**:
   - The user’s database instance hosts other application tables.
   - All raffle tables strictly use the prefix **`cse_fest_2026_`**.
   - Truncation, migration, drop, and maintenance tools are hard-coded to check against a strict whitelist of `cse_fest_2026_*` tables. Under no circumstances will any existing non-festival table be queried, modified, truncated, or dropped.
2. **Granular Public Page Access Protection & Dynamic Gating**:
   - The Event Controller has individual switch controls over public visibility for four key pages: **Audience Stage View (`/audience`)**, **Public Participants Directory (`/participants`)**, **System Health Diagnostics (`/health`)**, and **Official Results View (`/results`)**.
   - When restricted by the controller, public visitors cannot access the page contents or related API endpoints; instead, a polished, high-contrast status card informs the attendee with a custom or default message.
   - Access state synchronizes in real time via WebSockets so open visitor browser tabs instantly show or hide the page without needing a manual refresh.
3. **Provably Fair Cryptographic Random Winner Algorithm**:
   - Replaces basic pseudo-random generation with an enterprise-grade, cryptographically secure selection pipeline incorporating multi-source entropy, HMAC-SHA512 distillation, and zero-modulo-bias rejection sampling.
   - Produces a tamper-evident cryptographic receipt for each draw round, allowing attendees, faculty, and auditors to mathematically verify draw fairness.
4. **Controller-Driven Maintenance (Truncate & Rebuild Schema)**:
   - Event Controller can trigger a clean wipe/truncate of all festival data before event kick-off.
   - Event Controller can trigger a complete drop-and-rebuild of clean schema DDL for `cse_fest_2026_*` tables without touching any other tables in the database.
5. **Admin CSV Export Hub**:
   - Official records can be downloaded on-demand in CSV format for administrative handoff, post-event verification, faculty reporting, and live audience telemetry reviews.
6. **Strict Multi-Category Duplicate Prevention**:
   - **Students**: Enforced unique by **`id`** (Student Roll Number).
   - **Guest**: Enforced unique by **`name` + `designation`** (normalized case-insensitive).
   - **Faculty**: Enforced unique by **`name` + `designation`** (normalized case-insensitive).
7. **Standardized Student Designation**: For all students, the designation attribute is strictly populated as **`"Student"`** across all database records, verification queues, API responses, public directories, and stage displays.
8. **Mandatory Controller Verification Queue**: Self-registered participants NEVER enter the live draw pool automatically. Every submission enters a pending queue where the Event Controller must explicitly **Verify & Approve** or **Reject** before eligibility is granted.
9. **Transactional Integrity & Concurrency**: Atomic operations ensure candidate selection, winner confirmation, and candidate redraws never experience partial writes or race conditions.
10. **Real-Time Live Audience Telemetry**: Efficient tracking of active visitor sessions, device de-duplication, and time-series snapshots without I/O bottlenecking the draw engine.
11. **Permanent Audit Trail & Append-Only History**: Cryptographic hashes and immutable audit records stored with relational integrity.
12. **Strict UI/UX Preservation & Zero CSS Alteration Directive**:
   - **Do NOT Touch Existing UI/UX or CSS**: The existing stage audience presentation, controller layout, typography, animations, color palette, and global CSS (`index.css` / Tailwind styling) will remain **100% intact, unmodified, and untouched**.
   - **Zero Visual Regressions**: All database migrations, backend endpoints, and new pages (such as `/remote`) are strictly additive, reusing existing Tailwind utility classes without altering or breaking any existing CSS rules or component designs.

---

## 2. Shared Database Isolation & Safe Maintenance Architecture

### 2.1. Whitelist of Isolated Festival Tables
The system maintains an immutable whitelist of allowed tables:

```typescript
export const CSE_FEST_2026_TABLES = [
  'cse_fest_2026_audience_timeline_snapshots',
  'cse_fest_2026_event_visitor_analytics',
  'cse_fest_2026_live_visitor_sessions',
  'cse_fest_2026_audit_logs',
  'cse_fest_2026_ignored_candidates',
  'cse_fest_2026_winner_results',
  'cse_fest_2026_participant_registration_requests',
  'cse_fest_2026_raffle_sessions',
  'cse_fest_2026_participants'
] as const;
```

### 2.2. Safety Guard Rules (Zero Touch on Other Database Tables)
1. **No Wildcard Drops**: Commands like `DROP SCHEMA public CASCADE`, `DROP DATABASE`, or untyped `DROP TABLE` are **strictly forbidden**.
2. **Prefix Enforcement**: Every maintenance SQL statement must pass validation:
   ```typescript
   function assertFestTableOnly(tableName: string) {
     if (!tableName.startsWith('cse_fest_2026_') || !CSE_FEST_2026_TABLES.includes(tableName as any)) {
       throw new Error(`SECURITY ALERT: Attempted operation on non-festival table: ${tableName}. Operation aborted.`);
     }
   }
   ```
3. **Foreign Key Order Execution**: Drops and truncates follow strict dependency order (child tables first) to prevent foreign key errors.

### 2.3. Controller Operation A: "Truncate All Festival Tables"
Wipes all data from festival tables while preserving table structures, indexes, and constraints:
```sql
-- Safe isolated truncation: strictly touches ONLY cse_fest_2026_* tables
TRUNCATE TABLE 
    cse_fest_2026_audience_timeline_snapshots,
    cse_fest_2026_event_visitor_analytics,
    cse_fest_2026_live_visitor_sessions,
    cse_fest_2026_audit_logs,
    cse_fest_2026_ignored_candidates,
    cse_fest_2026_winner_results,
    cse_fest_2026_participant_registration_requests,
    cse_fest_2026_raffle_sessions,
    cse_fest_2026_participants
CASCADE;

-- Re-initialize singleton state for the festival
INSERT INTO cse_fest_2026_raffle_sessions (
    id, status, current_serial, next_serial, completed_winners, total_winners, 
    self_registration_enabled,
    access_audience_enabled, access_participants_enabled, access_health_enabled, access_results_enabled,
    message_audience_restricted, message_participants_restricted, message_health_restricted, message_results_restricted
) VALUES (
    'duet_cse_fest_2026', 'IDLE', 0, 1, 0, 10, 
    FALSE,
    TRUE, TRUE, TRUE, TRUE,
    'The live stage audience screen is currently restricted by the Event Controller. Please wait for stage proceedings to resume.',
    'The public participant directory is currently closed or under administrative review by the Event Controller.',
    'System health diagnostics and telemetry are restricted to authorized event administrators.',
    'Official raffle results are currently hidden and will be announced by the stage controller.'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO cse_fest_2026_event_visitor_analytics (
    event_id, current_audience_count, current_controller_count, total_unique_visitors
) VALUES (
    'duet_cse_fest_2026', 0, 0, 0
) ON CONFLICT (event_id) DO NOTHING;
```

### 2.4. Controller Operation B: "Rebuild Clean Schema"
Drops only the 9 festival tables and executes clean `CREATE TABLE` and `CREATE INDEX` statements:
```sql
-- Step 1: Drop only cse_fest_2026_* tables (Foreign key safe order)
DROP TABLE IF EXISTS cse_fest_2026_audience_timeline_snapshots CASCADE;
DROP TABLE IF EXISTS cse_fest_2026_event_visitor_analytics CASCADE;
DROP TABLE IF EXISTS cse_fest_2026_live_visitor_sessions CASCADE;
DROP TABLE IF EXISTS cse_fest_2026_audit_logs CASCADE;
DROP TABLE IF EXISTS cse_fest_2026_ignored_candidates CASCADE;
DROP TABLE IF EXISTS cse_fest_2026_winner_results CASCADE;
DROP TABLE IF EXISTS cse_fest_2026_participant_registration_requests CASCADE;
DROP TABLE IF EXISTS cse_fest_2026_raffle_sessions CASCADE;
DROP TABLE IF EXISTS cse_fest_2026_participants CASCADE;

-- Step 2: Re-run schema DDL (Section 7)
-- Step 3: Re-seed initial session singleton and analytics records
```

---

### 2.5. Strict UI/UX Preservation & CSS Non-Destruction Mandate (Zero Front-End Regressions)

To ensure operational stability and honor the user's explicit directive (**"do not touch my existing UI/UX or don't change CSS"**), the following non-negotiable frontend engineering principles are established:

1. **Zero Modifications to Global CSS**:
   - `src/index.css` and all Tailwind configuration directives remain **strictly read-only and untouched**.
   - No CSS classes, utility aliases, font declarations, or custom animations will be deleted, renamed, or modified.
2. **Preserve Exact Existing Visuals & Layouts**:
   - The Stage Audience View (`/audience`), Desktop Controller Console (`/controller`), and Results Gallery (`/results`) will retain **100% of their existing visual appearance**, component structure, color schemes, card styling, and animations.
   - The existing dark theme palette (`slate-950`, `slate-900`, `slate-800`), font scales, borders, and margins are preserved identically.
3. **Purely Additive Architectural Pattern**:
   - Any new interface element (such as the `<PageAccessGuard>` overlay, Participant Self-Registration Modal, Admin CSV Export Hub, or the Dedicated Mobile Stage Remote `/remote`) is created as a **purely additive component**.
   - New components will directly reuse the existing project Tailwind utility classes (e.g. `bg-slate-900 border border-slate-800 text-slate-100 rounded-xl px-4 py-2 font-medium`) to maintain visual cohesion without altering a single line of existing CSS.
4. **Isolated Mobile Route (`/remote`)**:
   - The new mobile remote runs on an isolated route (`/remote`) specifically formatted for handheld smartphone screens. It leaves all existing desktop layouts completely undisturbed.

---

## 3. Granular Public Page Access Protection & Dynamic Gating Architecture

### 3.1. Overview of Protected Public Pages

| Page Identifier | Public Route | Purpose | Default Status | Default Restriction Notice |
|---|---|---|---|---|
| **Audience Page** | `/` or `/audience` | Live stage presentation, candidate reveal cards, confetti celebration | **Active (`TRUE`)** | *"The live stage audience screen is currently restricted by the Event Controller. Please wait for stage proceedings to resume."* |
| **Participants Page**| `/participants` | Public directory search, roll lookup, and attendee self-registration | **Active (`TRUE`)** | *"The public participant directory is currently closed or under administrative review by the Event Controller."* |
| **Health Page** | `/health` or `/api/health`| System operational health, DB connectivity, WebSocket latency | **Active (`TRUE`)** | *"System health diagnostics and telemetry are restricted to authorized event administrators."* |
| **Results Page** | `/results` | List of confirmed winners, prize serials, and cryptographic seals | **Active (`TRUE`)** | *"Official raffle results are currently hidden and will be announced by the stage controller."* |

---

### 3.2. Controller Visibility Control Center

Inside the Controller Console (`ControllerConsole.tsx`), a dedicated **"Page Access & Visibility Control Center"** card displays:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🛡️ PAGE ACCESS & VISIBILITY CONTROL CENTER                                  │
│ Control public access for individual festival pages in real time.           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [👥 Audience Stage Page]        Status: [🟢 PUBLIC ACTIVE]   [ Toggle Lock ] │
│  Route: / or /audience           Message: "The live stage audience screen..."│
│                                                                             │
│  [📋 Participants Directory]     Status: [🟢 PUBLIC ACTIVE]   [ Toggle Lock ] │
│  Route: /participants            Message: "The public participant direct..."│
│                                                                             │
│  [📊 System Health & Telemetry]  Status: [🟢 PUBLIC ACTIVE]   [ Toggle Lock ] │
│  Route: /health                  Message: "System health diagnostics are..."│
│                                                                             │
│  [🏆 Official Results Page]      Status: [🟢 PUBLIC ACTIVE]   [ Toggle Lock ] │
│  Route: /results                 Message: "Official raffle results are c..."│
│                                                                             │
│  [ Edit Restriction Messages ]   [ Refresh Access Config ]                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

1. **Independent Switches**: Each page has an independent toggle switch (`true` = Public, `false` = Restricted).
2. **Custom Message Editor Modal**: Controller can customize the explanation message shown to visitors for each page.
3. **Instant Real-Time Broadcasting**: When a switch is toggled, the server emits a `PAGE_ACCESS_UPDATED` WebSocket event. All connected audience and visitor browsers update dynamically without page reloads.

---

### 3.3. Public View Experience When Restricted

When a public user visits a restricted page:
1. The page does **NOT** crash, throw unstyled 404 errors, or render broken empty components.
2. The page renders a polished, high-contrast **Restricted Page Notice**:
   - **Visual Icon**: An animated shield/lock icon with subtle ambient pulse.
   - **Heading**: Specific page state (e.g., *"Audience View Restricted"*, *"Directory Under Review"*, *"Results Pending Unveiling"*).
   - **Controller Message**: The exact explanatory notice configured by the Event Controller.
   - **Auto-Unlock Listener**: A WebSocket subscription that listens for `PAGE_ACCESS_UPDATED`. If the controller re-enables access while the user is looking at the screen, the notice seamlessly transitions to the full live page immediately.
   - **Secondary Navigation**: Quick action buttons: `[ Go to Home ]` or `[ Refresh Status ]`.

---

### 3.4. Server-Side Route Guard Middleware

To prevent unauthorized public clients from bypassing the UI via direct API requests or curl:
- The server provides a central middleware `checkPageAccess(pageKey: 'audience' | 'participants' | 'health' | 'results')`:
  ```typescript
  export function requirePageAccess(pageKey: 'audience' | 'participants' | 'health' | 'results') {
    return async (req: Request, res: Response, next: NextFunction) => {
      // Controller requests with admin authorization always bypass restrictions
      if (req.headers['x-controller-token'] === process.env.CONTROLLER_SECRET_KEY) {
        return next();
      }
      
      const accessConfig = await raffleRepository.getPageAccessConfig();
      const isAllowed = accessConfig[`access_${pageKey}_enabled`];
      
      if (!isAllowed) {
        return res.status(403).json({
          success: false,
          restricted: true,
          page: pageKey,
          message: accessConfig[`message_${pageKey}_restricted`],
          restricted_at: new Date().toISOString()
        });
      }
      
      next();
    };
  }
  ```

---

## 4. Provably Fair Cryptographic Winner Selection Engine

The selection of each raffle winner must be **statistically unbiased**, **cryptographically non-predicable**, and **provably fair**. 

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       MULTI-SOURCE ENTROPY HARVESTING                       │
│                                                                             │
│  [ OS CSPRNG ]          [ CPU Nanosecond ]       [ Previous Winner ]        │
│  crypto.randomBytes(32) process.hrtime.bigint()  Block Chain Hash           │
│         │                        │                        │                 │
│         ├────────────────────────┴────────────────────────┤                 │
│         │                                                 │                 │
│  [ Candidate Snapshot ]                         [ Ephemeral Nonce ]         │
│  SHA-256 Merkle Root                            crypto.randomBytes(16)      │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Combined Entropy Buffer
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      HMAC-SHA512 DISTILLATION & PRNG                        │
│                                                                             │
│  K_round = HMAC-SHA256(ServerMasterKey, "CSE_FEST_2026_ROUND_" + serial)   │
│  Digest512 = HMAC-SHA512(K_round, CombinedEntropyBuffer)                    │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ 512-bit Uniform Bitstream
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                 64-BIT ZERO-MODULO-BIAS REJECTION SAMPLING                  │
│                                                                             │
│  Extract 64-bit unsigned BigInt: V = BigUInt64BE(Digest512[0..8])           │
│  Rejection Threshold: Limit = 2^64 - (2^64 mod N)                           │
│                                                                             │
│  If V < Limit:                                                              │
│      SelectedIndex = Number(V mod N) ──► Exact Uniform Probability (1/N)    │
│  Else (Reject & Iterate):                                                   │
│      Digest512 = HMAC-SHA512(K_round, Digest512 || Counter++)               │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   TAMPER-EVIDENT CRYPTOGRAPHIC RECEIPT                      │
│                                                                             │
│  Receipt = SHA-256(serial || participant_id || drawn_at ||                  │
│                    merkle_root || chain_hash || draw_nonce)                 │
│                                                                             │
│  Published in Winner Card & CSV Export for Public Independent Auditing     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.1. Five Independent Entropy Sources
Every draw harvests entropy across five orthogonal layers:
1. **$E_{\text{CSPRNG}}$ (Kernel Cryptographic Entropy)**: 32 bytes (256 bits) from the operating system's cryptographic random number generator (`crypto.randomBytes(32)`), leveraging kernel noise/entropy pools (`/dev/urandom` / ChaCha20).
2. **$E_{\text{JITTER}}$ (Hardware Clock Jitter)**: Nanosecond-precision hardware CPU timer (`process.hrtime.bigint()`), capturing microsecond execution variations.
3. **$E_{\text{CHAIN}}$ (Cryptographic Hash Chaining)**: The SHA-256 `verification_hash` of the previous confirmed winner (Round $N-1$). Round 1 binds to a published event Genesis Hash (`SHA-256('DUET_CSE_FEST_2026_GENESIS')`). This guarantees blockchain-like immutability where rounds cannot be reordered.
4. **$E_{\text{MERKLE}}$ (Candidate Snapshot Merkle Root)**: A canonical SHA-256 Merkle root computed over all currently eligible candidates sorted deterministically by ID. Any modification to candidate data immediately alters this root.
5. **$E_{\text{NONCE}}$ (Round Nonce)**: A 16-byte cryptographically random ephemeral salt.

### 4.2. HMAC-SHA512 Entropy Distillation
The harvested entropy components are packed into a continuous byte buffer:
```typescript
const entropyBuffer = Buffer.concat([
  osEntropy,                                // 32 bytes
  Buffer.from(cpuJitter.toString()),        // Nanosecond string buffer
  Buffer.from(previousWinnerHash, 'hex'),   // 32 bytes
  Buffer.from(candidateMerkleRoot, 'hex'),  // 32 bytes
  nonceBuffer                               // 16 bytes
]);
```
The draw round secret key is derived via HMAC-SHA256:
$$K_{\text{round}} = \text{HMAC-SHA256}(K_{\text{server\_master}}, \text{"CSE\_FEST\_2026\_ROUND\_"} + \text{serial})$$
The combined entropy is then distilled into a 512-bit pseudorandom stream:
$$\text{Digest}_{512} = \text{HMAC-SHA512}(K_{\text{round}}, \text{entropyBuffer})$$

### 4.3. Zero-Modulo-Bias Rejection Sampling
Standard naive random selection using the modulo operator (`randomInt % N`) suffers from **modulo bias** whenever $2^{64}$ (or the integer range) is not an exact multiple of the pool size $N$. For an event with high stakes, this bias—even if small—is statistically improper.

To achieve mathematical perfection, the engine implements **Cryptographic Rejection Sampling** using 64-bit unsigned integers:
```typescript
function deriveUnbiasedIndex(digest: Buffer, poolSize: number, roundKey: Buffer): { index: number; proofSteps: number } {
  const N = BigInt(poolSize);
  const MAX_UINT64 = 18446744073709551615n; // 2^64 - 1
  const limit = MAX_UINT64 - (MAX_UINT64 % N); // Rejection threshold

  let currentDigest = digest;
  let counter = 0;

  while (true) {
    const value = currentDigest.readBigUInt64BE(0);

    if (value < limit) {
      const selectedIndex = Number(value % N);
      return { index: selectedIndex, proofSteps: counter + 1 };
    }

    counter++;
    currentDigest = crypto
      .createHmac('sha512', roundKey)
      .update(Buffer.concat([currentDigest, Buffer.from(`REJECT_STEP_${counter}`)]))
      .digest();
  }
}
```
**Mathematical Guarantee**: Every single candidate in the eligible pool has an exact, uniform probability:
$$P(\text{Candidate}_i) = \frac{1}{N}$$

---

## 5. Duplicate Prevention Rules & Validation Matrix

To protect festival draw integrity, duplicate submissions are rejected at both the API level and database constraint level:

| Category | Primary Identifier | Designation Standard | Duplicate Prevention Rule | Constraint Mechanism | Error Returned on Conflict |
|---|---|---|---|---|---|
| **Student** | Student Roll (e.g. `2303025`) | **Strictly `"Student"`** | Unique by **`id`** | Primary Key on `cse_fest_2026_participants(id)` + Unique check on pending requests | `"Student with Roll [ID] is already registered under [Name]."` |
| **Faculty** | Faculty Member Name & Title | Academic Title (e.g. *Associate Professor*, *Lecturer*) | Unique by **`LOWER(TRIM(name))` + `LOWER(TRIM(designation))`** | Partial Unique Index where `type = 'faculty'` | `"Faculty member [Name] with designation [Designation] is already registered."` |
| **Guest** | Guest Name & Title | Official Role (e.g. *Special Guest*, *Distinguished Attendee*) | Unique by **`LOWER(TRIM(name))` + `LOWER(TRIM(designation))`** | Partial Unique Index where `type = 'guest'` | `"Guest [Name] with designation [Designation] is already registered."` |

---

## 6. Self-Registration & Controller Verification/Rejection Workflow

### 6.1. End-to-End Workflow Diagram
```
[ Public Participant Directory (/participants) ]
       │
       ├── Controller Switch: ACTIVE / CLOSED
       │     ├── If CLOSED: "+ Add My Info" button is hidden. API returns 403.
       │     └── If ACTIVE: Displays glowing "+ Add My Info" button in header & search empty-states
       │
       ▼ (Attendee submits modal form)
[ Pre-Submission Duplicate & Validation Checks ]
       │
       ├── If Student:
       │     ├── Automatically assign `designation = 'Student'`
       │     └── Check if `id` exists in `cse_fest_2026_participants` or pending requests
       │
       ├── If Faculty/Guest:
       │     └── Check if (`LOWER(name)` + `LOWER(designation)`) exists
       │           └── If match found: REJECT immediately with descriptive duplicate warning (HTTP 409)
       │
       ▼ (If valid & unique)
[ Write to `cse_fest_2026_participant_registration_requests` ]
       │
       ├── Stored with status: 'PENDING'
       ├── NOT added to draw pool yet (`eligible = 0`)
       ├── Broadcasts 'REGISTRATION_PENDING_UPDATE' to Controller Console
       │
       ▼ (Attendee receives confirmation)
[ Public Modal: "Submitted for Controller Verification" ]
       └── Attendee sees status: "Your registration has been submitted and is pending verification by the Event Controller."
       
─────────────────────────────────────────────────────────────────────────────

[ Event Controller Console ]
       │
       ├── Displays "Registration Review Queue" badge (e.g. [ 3 Pending ])
       │
       ▼ (Controller opens review drawer)
[ Controller Review Queue Card ]
       ├── Shows applicant: Name, Roll/ID, Type, Designation ("Student" for students), Contact, Submitted Time
       ├── Auto-audit indicator: "✓ Unique (No duplicate found in database)"
       │
       ├── ACTION A: [ Verify & Approve ]
       │     ├── Inserts/promotes applicant to `cse_fest_2026_participants`
       │     ├── Sets `eligible = 1`, `registration_status = 'approved'`, `approved_by = 'controller_admin'`
       │     ├── Marks request as `status = 'approved'` in requests table
       │     ├── Logs to `cse_fest_2026_audit_logs`
       │     └── Broadcasts real-time refresh to Public Directory and Stage Display
       │
       └── ACTION B: [ Reject ]
             ├── Prompts quick reason ("Invalid Roll", "Not a DUET Student", "Duplicate Entry", "Disqualified")
             ├── Marks request as `status = 'rejected'`, records `rejection_reason`
             ├── Logs to `cse_fest_2026_audit_logs`
             └── Applicant is excluded from draw pool
```

---

## 7. Complete Relational Database Schema with `cse_fest_2026_` Prefix (SQL DDL)

```sql
-- ====================================================================
-- 1. PARTICIPANTS TABLE: cse_fest_2026_participants
-- Replaces data/participants.json
-- Contains all confirmed & verified eligible participants.
-- ====================================================================
CREATE TABLE IF NOT EXISTS cse_fest_2026_participants (
    id VARCHAR(64) PRIMARY KEY,                         -- Student Roll (e.g. '2303001') or generated Guest/Faculty ID
    type VARCHAR(20) NOT NULL CHECK (type IN ('student', 'faculty', 'guest')),
    name VARCHAR(255) NOT NULL,
    designation VARCHAR(255) NOT NULL DEFAULT 'Student', -- Strictly 'Student' for students, academic title for faculty, role/title for guest
    department VARCHAR(100) NOT NULL DEFAULT 'Computer Science & Engineering',
    eligible SMALLINT NOT NULL DEFAULT 1 CHECK (eligible IN (0, 1)),
    source VARCHAR(20) NOT NULL DEFAULT 'seed' CHECK (source IN ('seed', 'self_registered', 'admin_manual')),
    registration_status VARCHAR(20) NOT NULL DEFAULT 'approved' CHECK (registration_status IN ('approved', 'pending', 'rejected')),
    contact_info VARCHAR(255),                         -- Phone number or university email
    registered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_by VARCHAR(100),                          -- Controller username who verified & approved
    approved_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Consistency check: All students MUST have designation = 'Student'
    CONSTRAINT chk_student_designation CHECK (
        (type = 'student' AND designation = 'Student') OR
        (type IN ('faculty', 'guest') AND designation IS NOT NULL AND designation <> '')
    )
);

-- Standard performance indexes
CREATE INDEX idx_cse_fest_2026_participants_type ON cse_fest_2026_participants(type);
CREATE INDEX idx_cse_fest_2026_participants_eligible ON cse_fest_2026_participants(eligible);
CREATE INDEX idx_cse_fest_2026_participants_source ON cse_fest_2026_participants(source, registration_status);
CREATE INDEX idx_cse_fest_2026_participants_search ON cse_fest_2026_participants(name, id);

-- Duplicate prevention indexes
CREATE UNIQUE INDEX idx_cse_fest_2026_faculty_name_desig 
ON cse_fest_2026_participants (LOWER(TRIM(name)), LOWER(TRIM(designation))) 
WHERE type = 'faculty';

CREATE UNIQUE INDEX idx_cse_fest_2026_guest_name_desig 
ON cse_fest_2026_participants (LOWER(TRIM(name)), LOWER(TRIM(designation))) 
WHERE type = 'guest';

-- ====================================================================
-- 2. PARTICIPANT REGISTRATION REQUESTS QUEUE: cse_fest_2026_participant_registration_requests
-- Holds public self-registrations waiting for Controller Verification or Rejection.
-- ====================================================================
CREATE TABLE IF NOT EXISTS cse_fest_2026_participant_registration_requests (
    id VARCHAR(64) PRIMARY KEY,                         -- Request UUID
    participant_id VARCHAR(64) NOT NULL,               -- Student Roll or generated temporary ID
    name VARCHAR(255) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('student', 'faculty', 'guest')),
    designation VARCHAR(255) NOT NULL DEFAULT 'Student', -- 'Student' for students
    department VARCHAR(100) NOT NULL DEFAULT 'Computer Science & Engineering',
    contact_info VARCHAR(255),
    submitted_ip_hash VARCHAR(64),
    submitted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by VARCHAR(100),                          -- Controller username who verified/rejected
    reviewed_at TIMESTAMP WITH TIME ZONE,
    rejection_reason VARCHAR(255),                     -- Controller justification if rejected
    
    CONSTRAINT chk_req_student_designation CHECK (
        (type = 'student' AND designation = 'Student') OR
        (type IN ('faculty', 'guest') AND designation IS NOT NULL AND designation <> '')
    )
);

CREATE INDEX idx_cse_fest_2026_reg_requests_status ON cse_fest_2026_participant_registration_requests(status);
CREATE INDEX idx_cse_fest_2026_reg_requests_pid ON cse_fest_2026_participant_registration_requests(participant_id);
CREATE INDEX idx_cse_fest_2026_reg_requests_time ON cse_fest_2026_participant_registration_requests(submitted_at DESC);

-- Pending queue duplicate checks
CREATE UNIQUE INDEX idx_cse_fest_2026_pending_student_roll 
ON cse_fest_2026_participant_registration_requests (participant_id) 
WHERE type = 'student' AND status = 'pending';

CREATE UNIQUE INDEX idx_cse_fest_2026_pending_faculty_name_desig 
ON cse_fest_2026_participant_registration_requests (LOWER(TRIM(name)), LOWER(TRIM(designation))) 
WHERE type = 'faculty' AND status = 'pending';

CREATE UNIQUE INDEX idx_cse_fest_2026_pending_guest_name_desig 
ON cse_fest_2026_participant_registration_requests (LOWER(TRIM(name)), LOWER(TRIM(designation))) 
WHERE type = 'guest' AND status = 'pending';

-- ====================================================================
-- 3. RAFFLE SESSIONS & EVENT SETTINGS: cse_fest_2026_raffle_sessions
-- Replaces data/session.json
-- Singleton row controlling draw state, registration switches, and granular page access permissions.
-- ====================================================================
CREATE TABLE IF NOT EXISTS cse_fest_2026_raffle_sessions (
    id VARCHAR(64) PRIMARY KEY,                         -- Primary session key e.g. 'duet_cse_fest_2026'
    status VARCHAR(30) NOT NULL DEFAULT 'IDLE' CHECK (
        status IN ('IDLE', 'DRAWING', 'WAITING_CONFIRMATION', 'PAUSED', 'INTERRUPTED', 'COMPLETED')
    ),
    current_serial INTEGER NOT NULL DEFAULT 0,          -- Last completed winner serial (0 to 10)
    next_serial INTEGER NOT NULL DEFAULT 1,             -- Upcoming prize number
    completed_winners INTEGER NOT NULL DEFAULT 0,
    total_winners INTEGER NOT NULL DEFAULT 10,
    current_candidate_id VARCHAR(64) REFERENCES cse_fest_2026_participants(id) ON DELETE SET NULL,
    draw_start_timestamp TIMESTAMP WITH TIME ZONE,
    last_action VARCHAR(255),
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Controller Dynamic Registration Switch
    self_registration_enabled BOOLEAN NOT NULL DEFAULT FALSE,  -- Controlled by Controller (ACTIVE / CLOSED)
    
    -- Cryptographic Proof Chain State
    last_block_hash VARCHAR(128) NOT NULL DEFAULT 'DUET_CSE_FEST_2026_GENESIS_HASH',
    
    -- ================================================================
    -- GRANULAR PUBLIC PAGE ACCESS CONTROLS & RESTRICTION NOTICES
    -- Each boolean enables (TRUE) or locks/restricts (FALSE) public access.
    -- Each message column stores the friendly custom notification shown to public visitors.
    -- ================================================================
    access_audience_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    access_participants_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    access_health_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    access_results_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    
    message_audience_restricted TEXT NOT NULL DEFAULT 'The live stage audience screen is currently restricted by the Event Controller. Please wait for stage proceedings to resume.',
    message_participants_restricted TEXT NOT NULL DEFAULT 'The public participant directory is currently closed or under administrative review by the Event Controller.',
    message_health_restricted TEXT NOT NULL DEFAULT 'System health diagnostics and telemetry are restricted to authorized event administrators.',
    message_results_restricted TEXT NOT NULL DEFAULT 'Official raffle results are currently hidden and will be announced by the stage controller.',
    
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ====================================================================
-- 4. CONFIRMED WINNERS TABLE: cse_fest_2026_winner_results
-- Replaces 'results' array in data/results.json
-- Immutable historical record of every official winner with cryptographic verification proofs.
-- ====================================================================
CREATE TABLE IF NOT EXISTS cse_fest_2026_winner_results (
    id VARCHAR(64) PRIMARY KEY,                         -- UUID for the winner record
    serial INTEGER NOT NULL UNIQUE CHECK (serial >= 1 AND serial <= 10),
    participant_id VARCHAR(64) NOT NULL REFERENCES cse_fest_2026_participants(id),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(20) NOT NULL,
    designation VARCHAR(255) NOT NULL,                 -- 'Student' for students
    drawn_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    confirmed_by VARCHAR(100) NOT NULL DEFAULT 'controller_admin',
    
    -- Cryptographic Audit Fields
    verification_hash VARCHAR(128) NOT NULL,            -- Tamper-evident SHA-256 seal
    candidate_merkle_root VARCHAR(128) NOT NULL,        -- Merkle root of the snapshot at draw time
    chain_prev_hash VARCHAR(128) NOT NULL,              -- Previous round hash link
    draw_nonce VARCHAR(64) NOT NULL                     -- Ephemeral salt used in HMAC-SHA512
);

CREATE INDEX idx_cse_fest_2026_winners_serial ON cse_fest_2026_winner_results(serial);
CREATE INDEX idx_cse_fest_2026_winners_participant ON cse_fest_2026_winner_results(participant_id);

-- ====================================================================
-- 5. IGNORED / ABSENT CANDIDATES: cse_fest_2026_ignored_candidates
-- Replaces 'ignored' array in data/results.json
-- Audit record of skipped candidates during stage calls.
-- ====================================================================
CREATE TABLE IF NOT EXISTS cse_fest_2026_ignored_candidates (
    id VARCHAR(64) PRIMARY KEY,
    serial INTEGER NOT NULL,                            -- Prize serial during which they were skipped
    participant_id VARCHAR(64) NOT NULL REFERENCES cse_fest_2026_participants(id),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(20) NOT NULL,
    designation VARCHAR(255) NOT NULL,                 -- 'Student' for students
    reason VARCHAR(100) NOT NULL DEFAULT 'absent' CHECK (
        reason IN ('absent', 'declined', 'disqualified', 'manual_skip', 'duplicate')
    ),
    ignored_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ignored_by VARCHAR(100) NOT NULL DEFAULT 'controller_admin'
);

CREATE INDEX idx_cse_fest_2026_ignored_participant ON cse_fest_2026_ignored_candidates(participant_id);
CREATE INDEX idx_cse_fest_2026_ignored_serial ON cse_fest_2026_ignored_candidates(serial);

-- ====================================================================
-- 6. AUDIT LOGS TABLE: cse_fest_2026_audit_logs
-- Replaces data/audit_log.json
-- Append-only secure operational log.
-- ====================================================================
CREATE TABLE IF NOT EXISTS cse_fest_2026_audit_logs (
    id VARCHAR(64) PRIMARY KEY,                         -- UUID
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    action VARCHAR(100) NOT NULL,                       -- 'DRAW_START' | 'WINNER_CONFIRMED' | 'TABLES_TRUNCATED' | 'SCHEMA_REBUILT' | 'CSV_EXPORTED' | 'PAGE_ACCESS_MODIFIED' | 'SELF_REG_SUBMITTED' | 'SELF_REG_VERIFIED' | 'SELF_REG_REJECTED'
    operator VARCHAR(100) NOT NULL DEFAULT 'controller_admin',
    details JSONB NOT NULL,                             -- Flexible JSON payload containing event delta
    client_ip VARCHAR(64),
    signature VARCHAR(128)                              -- Tamper-evident hash
);

CREATE INDEX idx_cse_fest_2026_audit_timestamp ON cse_fest_2026_audit_logs(timestamp DESC);
CREATE INDEX idx_cse_fest_2026_audit_action ON cse_fest_2026_audit_logs(action);

-- ====================================================================
-- 7. LIVE VISITOR SESSIONS: cse_fest_2026_live_visitor_sessions
-- Tracks active connected browsers, projector displays, and controllers.
-- ====================================================================
CREATE TABLE IF NOT EXISTS cse_fest_2026_live_visitor_sessions (
    id VARCHAR(64) PRIMARY KEY,                         -- Socket connection UUID
    visitor_id VARCHAR(64) NOT NULL,                   -- Client persistent anonymous token (deduplicates tabs)
    role VARCHAR(20) NOT NULL DEFAULT 'audience' CHECK (role IN ('audience', 'controller', 'display')),
    channel VARCHAR(20) NOT NULL DEFAULT 'ws' CHECK (channel IN ('ws', 'sse')),
    client_ip_hash VARCHAR(64),                        -- Hashed IP for privacy
    user_agent TEXT,
    device_type VARCHAR(20) DEFAULT 'desktop',         -- 'desktop' | 'mobile' | 'tablet'
    connected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    disconnected_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_cse_fest_2026_visitor_sessions_active ON cse_fest_2026_live_visitor_sessions(is_active, role);
CREATE INDEX idx_cse_fest_2026_visitor_sessions_vid ON cse_fest_2026_live_visitor_sessions(visitor_id);
CREATE INDEX idx_cse_fest_2026_visitor_sessions_heartbeat ON cse_fest_2026_live_visitor_sessions(last_heartbeat_at);

-- ====================================================================
-- 8. EVENT VISITOR ANALYTICS: cse_fest_2026_event_visitor_analytics
-- Real-time telemetry exposed to the controller console.
-- ====================================================================
CREATE TABLE IF NOT EXISTS cse_fest_2026_event_visitor_analytics (
    event_id VARCHAR(64) PRIMARY KEY,                  -- 'duet_cse_fest_2026'
    current_audience_count INTEGER NOT NULL DEFAULT 0,
    current_controller_count INTEGER NOT NULL DEFAULT 0,
    current_connections_count INTEGER NOT NULL DEFAULT 0,
    peak_audience_count INTEGER NOT NULL DEFAULT 0,
    peak_recorded_at TIMESTAMP WITH TIME ZONE,
    total_unique_visitors INTEGER NOT NULL DEFAULT 0,
    total_connections_served INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ====================================================================
-- 9. AUDIENCE TIMELINE SNAPSHOTS: cse_fest_2026_audience_timeline_snapshots
-- Time-series log of concurrent viewers for historical charting.
-- ====================================================================
CREATE TABLE IF NOT EXISTS cse_fest_2026_audience_timeline_snapshots (
    id BIGSERIAL PRIMARY KEY,
    event_id VARCHAR(64) NOT NULL REFERENCES cse_fest_2026_event_visitor_analytics(event_id) ON DELETE CASCADE,
    snapshot_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    active_audience_unique INTEGER NOT NULL,
    active_audience_connections INTEGER NOT NULL,
    active_controllers INTEGER NOT NULL,
    active_draw_serial INTEGER,
    draw_status VARCHAR(30)
);

CREATE INDEX idx_cse_fest_2026_timeline_snapshots_time ON cse_fest_2026_audience_timeline_snapshots(snapshot_at DESC);
```

---

## 8. Admin CSV Data Export Architecture & Specifications

### 8.1. Export Format Standards
- **RFC 4180 Compliant**: Handles commas, double-quotes (`""`), and multi-line fields cleanly.
- **UTF-8 Byte Order Mark (`\uFEFF`)**: Injected at the head of every CSV stream so Microsoft Excel (Windows/macOS), LibreOffice, and Google Sheets correctly render Bengali Unicode characters and names without encoding corruption.
- **Direct Browser Attachment Headers**:
  ```http
  Content-Type: text/csv; charset=utf-8
  Content-Disposition: attachment; filename="cse_fest_2026_[dataset]_[timestamp].csv"
  Cache-Control: no-cache, no-store, must-revalidate
  ```

### 8.2. Supported CSV Datasets & Column Mappings

#### 1. Official Winners CSV (`cse_fest_2026_winners_[timestamp].csv`)
Export of all confirmed stage raffle winners in sequence:
| Column Header | Source Field | Example Data |
|---|---|---|
| `Prize Serial` | `serial` | `1` |
| `Winner Roll / ID` | `participant_id` | `2303025` |
| `Full Name` | `name` | `Tanvir Ahmed` |
| `Category` | `type` | `student` |
| `Designation` | `designation` | `Student` |
| `Department` | `department` | `Computer Science & Engineering` |
| `Drawn At (UTC)` | `drawn_at` | `2026-09-05 12:45:00 UTC` |
| `Confirmed By` | `confirmed_by` | `controller_admin` |
| `Verification Hash` | `verification_hash` | `a8f5c312...` |
| `Merkle Root` | `candidate_merkle_root` | `b99e7421...` |
| `Previous Hash Link` | `chain_prev_hash` | `DUET_CSE_FEST_2026_GENESIS` |

#### 2. Participants Directory CSV (`cse_fest_2026_participants_[filter]_[timestamp].csv`)
Export of the complete participant pool with filter options (`all`, `eligible_only`, `students_only`, `faculty_guest_only`):
| Column Header | Source Field | Example Data |
|---|---|---|
| `ID / Roll Number` | `id` | `2303042` |
| `Full Name` | `name` | `Md. Rafiqul Islam` |
| `Category` | `type` | `faculty` |
| `Designation` | `designation` | `Associate Professor` |
| `Department` | `department` | `Computer Science & Engineering` |
| `Eligibility Status` | `eligible` | `Eligible` (or `Winner`, `Ignored`) |
| `Registration Source` | `source` | `seed` (or `self_registered`, `admin_manual`) |
| `Approval Status` | `registration_status` | `approved` |
| `Contact Information` | `contact_info` | `rafiqul@duet.ac.bd` |
| `Registered At` | `registered_at` | `2026-09-05 08:30:00 UTC` |
| `Verified By` | `approved_by` | `controller_admin` |

#### 3. Self-Registration Requests Queue CSV (`cse_fest_2026_registration_requests_[timestamp].csv`)
Export of all public self-registration submissions:
| Column Header | Source Field | Example Data |
|---|---|---|
| `Request ID` | `id` | `req_99b3a...` |
| `Participant Roll / ID` | `participant_id` | `2303088` |
| `Full Name` | `name` | `Sadia Sultana` |
| `Category` | `type` | `student` |
| `Designation` | `designation` | `Student` |
| `Department` | `department` | `Computer Science & Engineering` |
| `Contact Information` | `contact_info` | `01711XXXXXX` |
| `Submitted At` | `submitted_at` | `2026-09-05 10:15:22 UTC` |
| `Verification Status` | `status` | `pending` / `approved` / `rejected` |
| `Reviewed By` | `reviewed_by` | `controller_admin` |
| `Rejection Reason` | `rejection_reason` | `Duplicate Roll Number` |

#### 4. Audit Trail CSV (`cse_fest_2026_audit_trail_[timestamp].csv`)
Full security log of stage events and controller actions:
| Column Header | Source Field | Example Data |
|---|---|---|
| `Log UUID` | `id` | `log_10a7b...` |
| `Timestamp` | `timestamp` | `2026-09-05 12:45:02 UTC` |
| `Action` | `action` | `WINNER_CONFIRMED` |
| `Operator` | `operator` | `controller_admin` |
| `Details Payload` | `details` (flattened) | `{"serial": 1, "candidate": "Tanvir Ahmed", "id": "2303025"}` |
| `Client IP` | `client_ip` | `10.10.2.14` |
| `Cryptographic Signature`| `signature` | `7d4e3a...` |

#### 5. Live Viewership Telemetry CSV (`cse_fest_2026_visitor_analytics_[timestamp].csv`)
Time-series audience telemetry:
| Column Header | Source Field | Example Data |
|---|---|---|
| `Snapshot Timestamp` | `snapshot_at` | `2026-09-05 12:40:00 UTC` |
| `Active Unique Audience`| `active_audience_unique` | `412` |
| `Total Active Connections`| `active_audience_connections` | `530` |
| `Active Controllers` | `active_controllers` | `2` |
| `Active Draw Serial` | `active_draw_serial` | `1` |
| `Draw Status` | `draw_status` | `DRAWING` |

---

## 9. API Endpoints Specification

### 9.1. Public Endpoints

#### `GET /api/public/page-access-status`
Returns real-time public access status and custom restriction messages for all 4 pages:
```json
{
  "success": true,
  "pages": {
    "audience": {
      "is_allowed": true,
      "restricted_message": "The live stage audience screen is currently restricted by the Event Controller. Please wait for stage proceedings to resume."
    },
    "participants": {
      "is_allowed": false,
      "restricted_message": "The public participant directory is currently closed or under administrative review by the Event Controller."
    },
    "health": {
      "is_allowed": false,
      "restricted_message": "System health diagnostics and telemetry are restricted to authorized event administrators."
    },
    "results": {
      "is_allowed": true,
      "restricted_message": "Official raffle results are currently hidden and will be announced by the stage controller."
    }
  }
}
```

#### `GET /api/public/registration-status`
Returns registration availability.

#### `POST /api/public/participants/register`
Submits attendee registration to the verification queue with duplicate checking and forced `designation = 'Student'`. Guarded by `requirePageAccess('participants')`.

#### `GET /api/public/verify-draw/:serial`
Public endpoint allowing anyone to inspect the cryptographic verification proof of a drawn winner. Guarded by `requirePageAccess('results')`.

---

### 9.2. Controller Page Access & Settings Endpoints

#### `POST /api/controller/settings/page-access`
Enables the Event Controller to update individual page access toggles and custom messages:
- **Request Body**:
```json
{
  "page": "participants",
  "is_allowed": false,
  "restricted_message": "Registration is currently paused for verification. Please check back at 3:00 PM."
}
```
- **Action**:
  - Updates `access_[page]_enabled` and `message_[page]_restricted` in `cse_fest_2026_raffle_sessions`.
  - Records event in `cse_fest_2026_audit_logs` (`action = 'PAGE_ACCESS_MODIFIED'`).
  - Broadcasts `PAGE_ACCESS_UPDATED` event to all connected WebSockets.

#### `POST /api/controller/settings/self-registration`
Toggles self-registration active or inactive.

#### `GET /api/controller/registrations/pending`
Retrieves all applicants waiting in the verification queue.

#### `POST /api/controller/registrations/:request_id/verify`
Controller verifies and admits applicant to the raffle pool.

#### `POST /api/controller/registrations/:request_id/reject`
Controller rejects applicant with reason.

---

### 9.3. Controller Admin CSV Export Endpoints

#### `GET /api/controller/export/winners.csv`
Streams confirmed winners as RFC 4180 CSV with UTF-8 BOM.

#### `GET /api/controller/export/participants.csv?filter=all|eligible|students|faculty_guest`
Streams the participant pool as CSV, with optional categorization filters.

#### `GET /api/controller/export/registrations.csv?status=all|pending|approved|rejected`
Streams the public self-registration queue submissions.

#### `GET /api/controller/export/audit-logs.csv`
Streams the complete security audit trail.

#### `GET /api/controller/export/visitor-analytics.csv`
Streams the time-series concurrent viewership logs.

---

### 9.4. Controller Maintenance & Isolation Endpoints

#### `POST /api/controller/maintenance/truncate-tables`
Safely truncates all 9 festival tables without touching external tables (`confirmation: "TRUNCATE-CSE-FEST-2026"`).

#### `POST /api/controller/maintenance/rebuild-schema`
Drops only `cse_fest_2026_*` tables and re-creates clean DDL (`confirmation: "REBUILD-CSE-FEST-2026"`).

---

## 10. Dedicated Mobile Stage Remote Controller (`/remote`) with PWA & Real-Time Sync

### 10.1. Conceptual Overview & Handheld Stage Ergonomics
During live festival ceremonies, the primary event controller often operates behind a soundboard or tech desk running the desktop console, while the stage presenter, faculty host, or student MC is roaming on stage with a microphone. 

Operating the heavy desktop console on a smartphone screen is impractical and hazardous due to dense tables, small fonts, and the risk of misclicking destructive buttons. 

The **Dedicated Mobile Stage Remote (`/remote`)** provides a purpose-built, high-contrast, thumb-friendly mobile web application and PWA specifically tailored for handheld smartphone control.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MOBILE STAGE REMOTE ARCHITECTURE                         │
│                                                                             │
│  [ Stage MC / Presenter Phone ]              [ Desktop Controller Console ] │
│  Route: /remote (PWA Standalone)             Route: /controller (Full View) │
│         │                                                  │                │
│         │ (Action: START DRAW #4)                          │                │
│         ├────────────────────────┐┌────────────────────────┤                │
│         ▼                        ▼▼                        ▼                │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │         BIDIRECTIONAL REAL-TIME WEBSOCKET REPLICATION ENGINE          │  │
│  │  - Instant Sub-50ms State Synchronization                             │  │
│  │  - Atomic Draw Mutex Lock (Prevents Dual-Trigger Concurrency)         │  │
│  └───────────────────────────────────┬───────────────────────────────────┘  │
│                                      │                                      │
│                                      ▼                                      │
│                     ┌─────────────────────────────────┐                     │
│                     │   AUDIENCE STAGE DISPLAY        │                     │
│                     │   Route: /audience (Big Screen) │                     │
│                     │   - Real-time Slot Machine Spin │                     │
│                     │   - Confetti Celebration        │                     │
│                     └─────────────────────────────────┘                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 10.2. Strict Scope of Mobile Controls & Safe Button Elimination

In direct adherence to the operational design (as specified in the controller reference interface), the mobile remote displays **strictly** the live draw operational triggers and candidate decision card:

#### Allowed Mobile Controls:
1. **Live Draw Operations Header**: Clean title with animated pink/magenta icon and real-time state badge (`LOCK: IDLE` | `LOCK: DRAWING` | `LOCK: WAITING_CONFIRMATION` | `LOCK: COMPLETED`).
2. **Selected Candidate Card**:
   - Subtitle: `SELECTED CANDIDATE • WINNER #N` (e.g. `SELECTED CANDIDATE • WINNER #4`)
   - Category pill badge: `STUDENT` (cyan/blue), `FACULTY` (purple), or `GUEST` (amber)
   - Candidate Full Name: High-contrast 26px bold typography (e.g. `Farhana Mim`)
   - Identity subtitle: `Roll: 2303004` (for students) or Academic/Guest Designation
3. **Candidate Decision Actions**:
   - `[✓ PRESENT / CONFIRM WINNER #N]`: Glowing emerald green button (`#10b981`), full-width or side-by-side with high touch target (52px height).
   - `[IGNORE / ABSENT]`: Deep burgundy/wine-red button (`#831843` / `#be123c`) with slash-user icon.
4. **Primary Draw Trigger**:
   - `[START DRAW FOR WINNER #N]`: Prominent gradient button with dice icon to initiate the cryptographic draw sequence.

#### 🛑 Intentional Safety Omission: No Pause, Resume, or Reset Buttons on Mobile
- **Pause & Resume Buttons**: **STRICTLY ELIMINATED** from the mobile view. Stage presenters only need to initiate draws and confirm candidate presence. Pausing the global festival timer is reserved exclusively for the desktop tech director.
- **Reset Button**: **STRICTLY ELIMINATED** from the mobile view. A misplaced thumb or accidental touch in a presenter's pocket must NEVER have the capability to reset a live session or wipe confirmed winners. Complete session resets and database wipes are strictly quarantined to the desktop controller's password-protected Danger Zone.

---

### 10.3. Mobile Screen Wireframe & Component Layout

```
📱 MOBILE VIEWPORT (/remote) - PWA STANDALONE
┌─────────────────────────────────────────────────────────────┐
│ 9:41 📶 🔋                                     [🟢 SYNCED]  │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ⚙️ DUET CSE FEST 2026 STAGE REMOTE                     │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ▷ Live Draw Operations                      [LOCK: IDLE]│ │
│ │                                                         │ │
│ │ ┌─────────────────────────────────────────────────────┐ │ │
│ │ │            SELECTED CANDIDATE • WINNER #4           │ │ │
│ │ │                      [STUDENT]                      │ │ │
│ │ │                                                     │ │ │
│ │ │                    Farhana Mim                      │ │ │
│ │ │                   Roll: 2303004                     │ │ │
│ │ │                                                     │ │ │
│ │ │ ┌──────────────────────┐   ┌──────────────────────┐ │ │ │
│ │ │ │ ✓ PRESENT / CONFIRM  │   │  🚫 IGNORE / ABSENT  │ │ │ │
│ │ │ │      WINNER #4       │   │                      │ │ │ │
│ │ │ └──────────────────────┘   └──────────────────────┘ │ │ │
│ │ └─────────────────────────────────────────────────────┘ │ │
│ │                                                         │ │
│ │ ┌─────────────────────────────────────────────────────┐ │ │
│ │ │            🎲 START DRAW FOR WINNER #4              │ │ │
│ │ └─────────────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│  ℹ️ Pause & Reset controls are locked to Desktop Console.   │
│                                                             │
│ [ ⬇️ Add to Home Screen (PWA) ]  [ 🔊 Haptic: ON ]          │
└─────────────────────────────────────────────────────────────┘
```

---

### 10.4. Progressive Web App (PWA) Architecture

The mobile remote integrates full PWA compliance according to modern web app standards:

#### 1. Web App Manifest (`public/manifest.webmanifest` / `vite-plugin-pwa`)
```json
{
  "id": "/remote",
  "name": "DUET CSE Fest 2026 Stage Remote",
  "short_name": "StageRemote",
  "description": "Mobile Stage Controller Remote for DUET CSE FEST 2026 Raffle",
  "start_url": "/remote",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#020617",
  "theme_color": "#0f172a",
  "icons": [
    {
      "src": "/pwa-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/pwa-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/pwa-maskable-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

#### 2. Service Worker Precaching (`vite-plugin-pwa`)
- Automatically precaches application shell assets (`js`, `css`, `html`, fonts, icons) so the remote UI loads instantly even in environments with patchy auditorium Wi-Fi.
- Implements `NetworkFirst` strategy for real-time draw session status endpoints.

#### 3. In-App PWA Install Banner & Hook (`usePWAInstall.ts`)
- Mounts an install banner at the bottom of `/remote` if not already running in `standalone` mode:
  - **Android / Chrome**: Captures `beforeinstallprompt`, offering a 1-tap `[ Install Stage Remote ]` button.
  - **iOS Safari**: Detects WebKit mobile user-agent and displays a guided overlay: *"Tap the Share button ➔ Select 'Add to Home Screen' for full-screen remote control."*
  - Automatically unmounts itself once `display-mode: standalone` is detected.

#### 4. Native Mobile Touch & Ergonomic Optimizations
- **Touch Target Sizing**: All primary action buttons feature a minimum height of **52px** and horizontal padding exceeding 24px, completely eliminating thumb misclicks.
- **Haptic Vibration Feedback**: Leverages the browser `navigator.vibrate` API:
  - `START DRAW`: Single short tap vibration (`navigator.vibrate?.(35)`).
  - `CANDIDATE SELECTED`: Double rhythmic pulse (`navigator.vibrate?.([40, 60, 40])`).
  - `CONFIRM WINNER`: Celebratory triple pulse (`navigator.vibrate?.([50, 50, 50, 50, 100])`).
  - `IGNORE / ABSENT`: Distinct low buzz (`navigator.vibrate?.([80])`).
- **Safe Area Insets**: Employs CSS environment variables (`env(safe-area-inset-top)` and `env(safe-area-inset-bottom)`) to ensure buttons never collide with iPhone Dynamic Islands or Android gesture navigation bars.
- **Viewport Lock**: Prevents unwanted double-tap zooming via `touch-action: manipulation` and meta tag `maximum-scale=1.0, user-scalable=no`.

---

### 10.5. Real-Time Bidirectional Synchronization Flow

The mobile remote establishes a persistent WebSocket connection to the server replication hub:

1. **State Hydration**: On connect, the mobile remote receives the current `SessionState`:
   - `current_serial`: e.g. `3`
   - `next_serial`: e.g. `4`
   - `status`: `IDLE` | `DRAWING` | `WAITING_CONFIRMATION`
   - `current_candidate`: `{ id: '2303004', name: 'Farhana Mim', type: 'student', designation: 'Student' }`
2. **Synchronized Action: Tapping `[START DRAW FOR WINNER #4]` on Mobile**:
   - Mobile remote immediately sets local optimistic state `LOCK: DRAWING` and triggers short haptic vibration.
   - Mobile dispatches `POST /api/controller/start-draw` with `round: 4`.
   - Server validates state mutex, generates entropy, and broadcasts `DRAW_STARTED` to **ALL** connected clients:
     - **Desktop Controller**: Status badge switches to `LOCK: DRAWING`, draw duration counter starts.
     - **Stage Audience Screen**: Screen initiates suspenseful spinning roulette visual with sound effects.
     - **Mobile Remote**: Button displays spinning loader: *"Selecting Winner #4..."*.
3. **Synchronized Candidate Selection**:
   - When the cryptographic engine resolves a winner, server emits `CANDIDATE_SELECTED`.
   - Desktop and Mobile simultaneously display `Farhana Mim` (Student, Roll: 2303004).
   - Mobile remote triggers vibration and enables `[✓ PRESENT / CONFIRM WINNER #4]` and `[IGNORE / ABSENT]`.
4. **Synchronized Confirmation: Tapping `[✓ PRESENT / CONFIRM]`**:
   - Mobile sends `POST /api/controller/confirm-winner`.
   - Server writes confirmed winner record to `cse_fest_2026_winner_results` with cryptographic hash chain.
   - Server broadcasts `WINNER_CONFIRMED`:
     - Stage audience screen explodes with confetti and winner fanfares.
     - Desktop controller appends winner to the completed table.
     - Mobile remote updates next target to `WINNER #5`, returning to `LOCK: IDLE`.
5. **Actions Performed on Desktop Automatically Mirror on Mobile**:
   - If the desktop operator clicks `[Confirm Winner]` or triggers actions, the mobile remote instantly syncs within 50 milliseconds.

---

### 10.6. Desktop Controller Quick QR Code Access

To enable instantaneous handoff between the tech booth and stage coordinators:
- In the header of `ControllerConsole.tsx`, a dedicated button `[ 📱 Mobile Remote ]` opens a modal showing:
  1. A clear SVG QR code encoding the direct URL to `/remote`.
  2. The direct URL with a 1-click `[ Copy Link ]` button.
  3. PIN / Quick Auth token for seamless instant access without manual password typing on mobile.

---

## 11. Frontend UI Specifications & Restricted State UX

### 10.1. Reusable Restricted Page Guard (`<PageAccessGuard page="..." />`)
Each protected route is wrapped in this component:
- **State Check**: Reads current page permissions from global WebSocket context or query cache.
- **Allowed State**: Renders standard page child components (`<AudienceStageView>`, `<PublicParticipantDirectory>`, `<SystemHealthDashboard>`, `<ResultsGallery>`).
- **Restricted State**: Renders a dedicated, accessible card:
  ```tsx
  <div className="min-h-screen flex items-center justify-center p-6 bg-slate-950 text-slate-100">
    <div className="max-w-lg w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl text-center space-y-6">
      <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto text-amber-400">
        <LockIcon className="w-8 h-8 animate-pulse" />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight text-white">{pageTitle} Restricted</h2>
        <p className="text-slate-400 text-sm leading-relaxed">{restrictedMessage}</p>
      </div>
      <div className="pt-4 border-t border-slate-800 flex items-center justify-center gap-3">
        <Link to="/" className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-xl transition">
          Return to Stage
        </Link>
        <button onClick={handleRetry} className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-xl transition">
          Check Access Again
        </button>
      </div>
    </div>
  </div>
  ```

### 10.2. Public Participant Directory (`PublicParticipantDirectory.tsx`)
1. **Modal Form**:
   - Clean tabs for `[Student]`, `[Faculty]`, `[Guest]`.
   - **Student Tab Behavior**: Designation locked to **`"Student"`**.
   - Attendee enters Roll Number, Full Name, Department, and Contact info.
2. **Directory Display**: All students uniformly display badge: `Student`.
3. **Restricted Handling**: When restricted, displays the custom notice rather than showing the attendee list.

### 10.3. Controller Console (`ControllerConsole.tsx`)
1. **Page Access & Visibility Control Center**:
   - 4 independent toggles (`Audience View`, `Participants Directory`, `Health Diagnostics`, `Results Gallery`).
   - Visual badges (`Public Allowed` vs `Restricted`).
   - "Edit Message" button to customize the restriction notice.
2. **Registration Control Header**:
   - Switch: `Attendee Self-Registration: [ACTIVE / CLOSED]` with green/red indicator.
3. **Verification Queue Drawer / Widget**:
   - Notification pill: `[ 3 Pending Approvals ]` in controller dashboard.
   - Review Card for each pending applicant with 1-click `[ Verify & Admit ]` and `[ Reject ]`.
4. **Data Export Center**:
   - Clean card in Controller Console featuring 1-click CSV download buttons.
5. **Cryptographic Draw Telemetry**:
   - Controller draw monitor displays real-time entropy metrics: Merkle Root Hash, Chain Hash, and Rejection Sampling Proof iterations.
6. **Database Maintenance & Isolation Center (Danger Zone)**:
   - **Isolation Badge**: `🛡️ Shared DB Protection Active: Operations strictly restricted to cse_fest_2026_* tables.`
   - **Action 1: Truncate Festival Tables**: Requires typing `TRUNCATE-CSE-FEST-2026`.
   - **Action 2: Rebuild Clean Schema**: Requires typing `REBUILD-CSE-FEST-2026`.

### 11.4. Dedicated Mobile Stage Remote (`MobileStageRemote.tsx`)
1. **Target Viewport**:
   - Optimized specifically for handheld smartphones in portrait orientation.
   - Fixed header with festival title, live status pill (`[🟢 SYNCED]`), and battery-friendly dark theme (`#020617`).
2. **Component Architecture**:
   - Displays strictly the **Live Draw Operations** container.
   - State pill badge: `LOCK: IDLE` | `LOCK: DRAWING` | `LOCK: WAITING_CONFIRMATION` | `LOCK: COMPLETED`.
   - Candidate display with high-contrast font, category badge (`Student` / `Faculty` / `Guest`), and roll number.
   - Dual action buttons: `[✓ PRESENT / CONFIRM WINNER #N]` (emerald glowing) and `[IGNORE / ABSENT]` (burgundy red).
   - Primary trigger: `[START DRAW FOR WINNER #N]` (high touch-target button with dice icon).
3. **Explicit Component Restrictions**:
   - **`Pause`, `Resume`, and `Reset` buttons are completely absent from the JSX render tree**.
   - No complex analytics cards, dense participant tables, or danger zone maintenance tools.
4. **PWA Integration**:
   - Mounts `<PWAInstallBanner />` to prompt home screen installation.
   - Connects to Web Vibration API for tactile haptic feedback on button clicks.
   - Native-feel touch handling with `touch-action: manipulation` and safe-area padding.

---

## 12. Migration & Rollout Checklist

| Phase | Milestone | Deliverables |
|---|---|---|
| **Phase 1: DB Schema & Prefixes** | Setup all 9 tables with `cse_fest_2026_` prefix, strict duplicate prevention indexes, cryptographic proof columns, page access control flags, and `designation = 'Student'` constraint. | `schema.sql` with prefixed tables. |
| **Phase 2: Data Migration** | Migrate existing `participants.json` setting `designation = 'Student'` for all students, migrate `session.json`, `results.json` into `cse_fest_2026_*` tables. | `migrate-json-to-db.ts`. |
| **Phase 3: Cryptographic Winner Engine** | Implement 5-source entropy harvester, Merkle tree generator, HMAC-SHA512 PRNG, and 64-bit zero-modulo-bias rejection sampling. | `CryptoRaffleEngine.ts`. |
| **Phase 4: Database Isolation & Maintenance Engine** | Implement safe whitelist validator, `truncateTables()` and `rebuildCleanSchema()` methods ensuring zero touch on other database tables. | `DatabaseMaintenanceService.ts`. |
| **Phase 5: Page Access Protection & Middleware** | Implement page access repository methods, controller toggle APIs, real-time WebSocket broadcast, and Express route guards. | `PageAccessMiddleware.ts` & WebSocket events. |
| **Phase 6: Duplicate Engine & Repository** | Implement repository layer enforcing Student ID uniqueness, Faculty/Guest Name+Designation uniqueness, and forced student designation. | `SqlRaffleRepository.ts`. |
| **Phase 7: Admin CSV Export Service** | Implement RFC 4180 CSV serializer with UTF-8 BOM for Winners, Participants, Requests, Audit Logs, and Viewership. | `CsvExportService.ts` & Express handlers. |
| **Phase 8: Registration & Review APIs** | Implement public register endpoint, controller `verify` / `reject` endpoints, and maintenance endpoints with phrase confirmation. | Express routes & handlers. |
| **Phase 9: Frontend Guard & Controller UI** | Add `<PageAccessGuard>` wrapper with polished notice states to audience, participants, health, and results pages; add visibility controls to `ControllerConsole.tsx`. | React components. |
| **Phase 10: Mobile Stage Remote & PWA** | Build `/remote` dedicated mobile page, implement `vite-plugin-pwa` with manifest, service worker, in-app install banner, haptic feedback, and omit Pause/Reset buttons. | `MobileStageRemote.tsx`, `usePWAInstall.ts`, PWA manifest & service worker. |
| **Phase 11: End-to-End Testing & Stage Rehearsal** | Verify real-time sync between mobile remote, desktop controller, and audience screen; verify PWA installation, zero-touch DB isolation, and perform zero visual regression check to guarantee existing UI/UX and `index.css` remain 100% untouched. | Verified system report & visual audit. |
