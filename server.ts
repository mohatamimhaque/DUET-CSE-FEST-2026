import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import { createServer as createViteServer } from 'vite';
import { loadAndValidateConfig } from './src/server/config.ts';
import { RaffleService } from './src/server/raffleService.ts';
import { wsManager } from './src/server/websocketManager.ts';
import { supabaseRepository } from './src/server/supabaseRepository.ts';
import { checkSupabaseHealth } from './src/server/supabase.ts';
import {
  findRootExcelFile,
  parseExcelBuffer,
  commitExcelParticipantsToDb,
  ensureSampleExcelFile,
} from './src/server/excelService.ts';

const config = loadAndValidateConfig();
const raffleService = new RaffleService(config);

const app = express();
const server = http.createServer(app);
const PORT = 3000;

// Security hardening
app.disable('x-powered-by');
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Initialize WebSocket Manager on the HTTP server
wsManager.initialize(server);

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser(config.SECRET_KEY));

// Explicit static serving of banner.jpg and favicons
app.get('/banner.jpg', (_req: Request, res: Response) => {
  res.sendFile(path.join(process.cwd(), 'public', 'banner.jpg'));
});
app.get('/favicon.ico', (_req: Request, res: Response) => {
  res.sendFile(path.join(process.cwd(), 'public', 'favicon.ico'));
});
app.get('/favicon.svg', (_req: Request, res: Response) => {
  res.type('image/svg+xml').sendFile(path.join(process.cwd(), 'public', 'favicon.svg'));
});

// Helper: Generate secure session token
function generateSessionToken(username: string): string {
  const timestamp = Date.now().toString();
  const signature = crypto
    .createHmac('sha256', config.SECRET_KEY)
    .update(`${username}:${timestamp}`)
    .digest('hex');
  return Buffer.from(`${username}:${timestamp}:${signature}`).toString('base64');
}

// Helper: Verify session token
function verifySessionToken(token: string): boolean {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const [username, timestamp, signature] = decoded.split(':');
    if (!username || !timestamp || !signature) return false;
    if (username !== config.CONTROLLER_USERNAME) return false;

    // Check expiration (24 hours)
    const tokenTime = parseInt(timestamp, 10);
    if (isNaN(tokenTime) || Date.now() - tokenTime > 24 * 60 * 60 * 1000) {
      return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', config.SECRET_KEY)
      .update(`${username}:${timestamp}`)
      .digest('hex');

    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch {
    return false;
  }
}

// Middleware: Require Controller Authentication
function requireControllerAuth(req: Request, res: Response, next: NextFunction) {
  const cookieToken = req.signedCookies?.raffle_ctrl_session || req.cookies?.raffle_ctrl_session;
  const headerToken = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const token = cookieToken || headerToken;

  if (!token || !verifySessionToken(token)) {
    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: 'Access Denied: Controller authorization required for this operation.',
    });
  }
  next();
}

// ==========================================
// 1. PUBLIC APIS
// ==========================================

app.get('/api/public/event', (_req: Request, res: Response) => {
  res.json({
    event_name: config.EVENT_NAME,
    total_winners: config.TOTAL_WINNERS,
    countdown_seconds: config.DRAW_COUNTDOWN_SECONDS,
    reveal_seconds: config.WINNER_REVEAL_SECONDS,
    name_roll_duration_ms: config.NAME_ROLL_DURATION_MS,
    shuffle_passes: config.SHUFFLE_PASSES,
    beep_enabled: config.BEEP_ENABLED,
    confetti_enabled: config.CONFETTI_ENABLED,
  });
});

app.get(['/api/public/draw/state', '/api/public/state'], (_req: Request, res: Response) => {
  res.json(raffleService.getPublicState());
});

// Page Access Status Query for Client Guards
app.get('/api/public/page-access-status', async (req: Request, res: Response) => {
  const page = (req.query.page as string) || '';
  const settings = await supabaseRepository.getPageAccessSettings();
  let isRestricted = false;

  if (page === 'audience' && !settings.audience) isRestricted = true;
  if (page === 'participants' && !settings.participants) isRestricted = true;
  if (page === 'health' && !settings.health) isRestricted = true;
  if (page === 'results' && !settings.results) isRestricted = true;

  res.json({
    settings,
    is_restricted: isRestricted,
    message: settings.restriction_message,
  });
});

// Public Participant Directory with Search & Pagination
app.get('/api/public/participants', async (req: Request, res: Response) => {
  const q = (req.query.q as string) || '';
  const type = (req.query.type as string) || 'all';
  const status = (req.query.status as string) || 'all';
  const page = parseInt((req.query.page as string) || '1', 10) || 1;
  const limit = parseInt((req.query.limit as string) || '15', 10) || 15;
  const result = await raffleService.searchParticipantsPaginated({ q, type, status, page, limit });
  res.json(result);
});

// Verified rolling pool from Supabase database
app.get('/api/public/roll-pool', (_req: Request, res: Response) => {
  const pool = raffleService.getRollingPool(200);
  res.json({ pool });
});

// Real-time Event Stream (SSE) for Audience
app.get('/api/public/events', (_req: Request, res: Response) => {
  wsManager.registerSseClient(res, 'audience');
});

// Real-time Event Stream (SSE) for Controller
app.get('/api/controller/events', requireControllerAuth, (_req: Request, res: Response) => {
  wsManager.registerSseClient(res, 'controller');
});

// Visitor Telemetry Heartbeat
app.post('/api/public/telemetry/heartbeat', (req: Request, res: Response) => {
  const sessionId = req.body.session_id || req.ip || 'anonymous';
  const page = req.body.page || '/';
  const ip = req.ip || '';
  const ua = req.headers['user-agent'] || '';
  supabaseRepository.recordVisitorHeartbeat(sessionId, ip, ua, page);
  res.json({ success: true });
});

app.get('/api/public/telemetry/analytics', (_req: Request, res: Response) => {
  res.json(supabaseRepository.getVisitorAnalytics());
});

// Participant Self-Registration
app.post('/api/public/participants/register', async (req: Request, res: Response) => {
  const pageAccess = await supabaseRepository.getPageAccessSettings();
  if (pageAccess.self_registration === false) {
    return res.status(403).json({
      success: false,
      message: 'Participant self-registration is currently closed by the event administrator.',
    });
  }

  const { name, external_id, type, designation } = req.body;
  if (!name || !type) {
    return res.status(400).json({ success: false, message: 'Name and participant type are required.' });
  }
  const result = await supabaseRepository.createRegistrationRequest({
    name,
    external_id,
    type,
    designation,
  });
  if (!result.success) {
    return res.status(400).json(result);
  }
  const ctrlState = await raffleService.getControllerState();
  wsManager.broadcastController('STATE_UPDATED', ctrlState);
  return res.json(result);
});

app.get('/api/health', async (_req: Request, res: Response) => {
  const mem = process.memoryUsage();
  const wsStats = wsManager.getStats();
  const pubState = raffleService.getPublicState();
  const participants = await raffleService.searchParticipants({});
  const supabaseHealth = await checkSupabaseHealth();

  const isHealthy = supabaseHealth.connected;

  res.json({
    status: isHealthy ? 'healthy' : 'degraded',
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
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
      audit: true,
    },
    metrics: {
      total_participants: participants.total,
      eligible_count: participants.counts.eligible,
      completed_winners: pubState.completed_winners,
      total_winners: config.TOTAL_WINNERS,
      active_ws_connections: wsStats.total,
      audience_connections: wsStats.audience,
      controller_connections: wsStats.controller,
      draw_lock_active: pubState.status === 'DRAWING',
    },
    memory: {
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
    },
  });
});

app.get(['/api/results', '/api/public/results'], async (_req: Request, res: Response) => {
  try {
    const data = await supabaseRepository.getResults();
    res.json({
      event: config.EVENT_NAME,
      total_winners: config.TOTAL_WINNERS,
      results: data.results,
      ignored: data.ignored,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Unable to retrieve results at this time.' });
  }
});

// ==========================================
// 2. CONTROLLER AUTHENTICATION
// ==========================================

interface LoginTracker {
  attempts: number;
  lockedUntil: number;
}
const loginRateLimitMap = new Map<string, LoginTracker>();

app.post('/api/controller/auth/login', (req: Request, res: Response) => {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const tracker = loginRateLimitMap.get(clientIp);

  if (tracker && tracker.lockedUntil > now) {
    const remainingSec = Math.ceil((tracker.lockedUntil - now) / 1000);
    return res.status(429).json({
      success: false,
      message: `Too many failed login attempts. Temporarily locked for ${remainingSec} seconds.`,
    });
  }

  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required.' });
  }

  const userMatch =
    username.length === config.CONTROLLER_USERNAME.length &&
    crypto.timingSafeEqual(Buffer.from(username), Buffer.from(config.CONTROLLER_USERNAME));

  const passMatch =
    password.length === config.CONTROLLER_PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(password), Buffer.from(config.CONTROLLER_PASSWORD));

  if (!userMatch || !passMatch) {
    const currentAttempts = (tracker ? tracker.attempts : 0) + 1;
    if (currentAttempts >= 5) {
      loginRateLimitMap.set(clientIp, {
        attempts: currentAttempts,
        lockedUntil: now + 15 * 60 * 1000, // 15 minute lock
      });
      return res.status(429).json({
        success: false,
        message: 'Too many failed login attempts. Account temporarily locked for 15 minutes.',
      });
    } else {
      loginRateLimitMap.set(clientIp, {
        attempts: currentAttempts,
        lockedUntil: 0,
      });
      return res.status(401).json({
        success: false,
        message: `Invalid controller credentials. ${5 - currentAttempts} attempts remaining.`,
      });
    }
  }

  // Clear rate-limit state on successful login
  loginRateLimitMap.delete(clientIp);

  const token = generateSessionToken(config.CONTROLLER_USERNAME);

  res.cookie('raffle_ctrl_session', token, {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
    signed: true,
  });

  return res.json({
    success: true,
    message: 'Authenticated successfully as event controller.',
    token,
    user: config.CONTROLLER_USERNAME,
  });
});

app.post('/api/controller/auth/logout', (_req: Request, res: Response) => {
  res.clearCookie('raffle_ctrl_session');
  return res.json({ success: true, message: 'Logged out successfully.' });
});

app.get('/api/controller/auth/check', (req: Request, res: Response) => {
  const cookieToken = req.signedCookies?.raffle_ctrl_session || req.cookies?.raffle_ctrl_session;
  const headerToken = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const token = cookieToken || headerToken;
  const isAuth = !!token && verifySessionToken(token);
  return res.json({ authenticated: isAuth, user: isAuth ? config.CONTROLLER_USERNAME : null });
});

// ==========================================
// 3. PROTECTED CONTROLLER OPERATIONS
// ==========================================

app.get('/api/controller/state', requireControllerAuth, async (_req: Request, res: Response) => {
  const state = await raffleService.getControllerState();
  res.json(state);
});

app.get('/api/controller/participants/search', requireControllerAuth, async (req: Request, res: Response) => {
  const q = (req.query.q as string) || '';
  const type = (req.query.type as string) || 'all';
  const status = (req.query.status as string) || 'all';
  const result = await raffleService.searchParticipants(q, type, status);
  res.json({
    total: result.filtered_total ?? result.participants.length,
    is_db_empty: result.is_db_empty,
    counts: result.counts,
    participants: result.participants,
  });
});

app.post('/api/controller/draw/start', requireControllerAuth, async (_req: Request, res: Response) => {
  const result = await raffleService.startDraw();
  if (!result.success) {
    return res.status(400).json(result);
  }
  return res.json(result);
});

app.post('/api/controller/draw/confirm', requireControllerAuth, async (_req: Request, res: Response) => {
  const result = await raffleService.confirmWinner();
  if (!result.success) {
    return res.status(400).json(result);
  }
  return res.json(result);
});

app.post('/api/controller/draw/ignore', requireControllerAuth, async (req: Request, res: Response) => {
  const reason = req.body.reason || 'absent';
  const result = await raffleService.ignoreCandidate(reason);
  if (!result.success) {
    return res.status(400).json(result);
  }
  return res.json(result);
});

app.post('/api/controller/pause', requireControllerAuth, async (_req: Request, res: Response) => {
  return res.json(await raffleService.pause());
});

app.post('/api/controller/resume', requireControllerAuth, async (_req: Request, res: Response) => {
  return res.json(await raffleService.resume());
});

app.post('/api/controller/draw/restore-interrupted', requireControllerAuth, async (_req: Request, res: Response) => {
  const result = await raffleService.restoreInterrupted();
  if (!result.success) return res.status(400).json(result);
  return res.json(result);
});

app.post('/api/controller/draw/cancel-interrupted', requireControllerAuth, async (_req: Request, res: Response) => {
  const result = await raffleService.cancelInterrupted();
  if (!result.success) return res.status(400).json(result);
  return res.json(result);
});

app.post('/api/controller/reset', requireControllerAuth, async (req: Request, res: Response) => {
  const { confirmation } = req.body;
  const result = await raffleService.resetSession(confirmation);
  if (!result.success) {
    return res.status(400).json(result);
  }
  return res.json(result);
});

// Page Access Control Settings Endpoint
app.post('/api/controller/settings/page-access', requireControllerAuth, async (req: Request, res: Response) => {
  const updated = await supabaseRepository.updatePageAccessSettings(req.body);
  wsManager.broadcastAll('PAGE_ACCESS_UPDATED', updated);
  res.json({ success: true, settings: updated });
});

// Registration Request Review
app.get('/api/controller/registrations', requireControllerAuth, async (_req: Request, res: Response) => {
  const requests = await supabaseRepository.getRegistrationRequests();
  res.json({ requests });
});

app.post('/api/controller/registrations/:id/review', requireControllerAuth, async (req: Request, res: Response) => {
  const { action, notes } = req.body;
  const result = await supabaseRepository.reviewRegistrationRequest(
    req.params.id,
    action === 'approve' ? 'approve' : 'reject',
    config.CONTROLLER_USERNAME,
    notes
  );
  if (!result.success) return res.status(400).json(result);
  await raffleService.reloadParticipants();
  const updatedCtrlState = await raffleService.getControllerState();
  wsManager.broadcastController('STATE_UPDATED', updatedCtrlState);
  res.json(result);
});

app.post('/api/controller/registrations/batch-review', requireControllerAuth, async (req: Request, res: Response) => {
  const { action, request_ids } = req.body;
  const result = await supabaseRepository.batchReviewRegistrationRequests(
    action === 'approve' ? 'approve' : 'reject',
    config.CONTROLLER_USERNAME,
    request_ids
  );
  if (!result.success) return res.status(400).json(result);
  await raffleService.reloadParticipants();
  const updatedCtrlState = await raffleService.getControllerState();
  wsManager.broadcastController('STATE_UPDATED', updatedCtrlState);
  res.json(result);
});

// Verify & Update Participant Eligibility (Controller)
app.post('/api/controller/participants/verify', requireControllerAuth, async (req: Request, res: Response) => {
  const { id, name, type, eligible } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, message: 'Participant name is required.' });
  }
  const result = await raffleService.setParticipantEligibility(
    { id, name, type },
    eligible !== undefined ? Number(eligible) : 1
  );
  res.json(result);
});

// Safe Database Maintenance: Truncate & Status
app.post('/api/controller/db/truncate', requireControllerAuth, async (req: Request, res: Response) => {
  const { confirmation } = req.body;
  const result = await supabaseRepository.truncateFestTables(confirmation);
  if (!result.success) return res.status(400).json(result);
  await raffleService.reloadParticipants();
  const updatedCtrlState = await raffleService.getControllerState();
  wsManager.broadcastController('STATE_UPDATED', updatedCtrlState);
  res.json(result);
});

app.get('/api/controller/db/status', requireControllerAuth, async (_req: Request, res: Response) => {
  const health = await checkSupabaseHealth();
  res.json(health);
});

app.post('/api/controller/participants/import', requireControllerAuth, async (req: Request, res: Response) => {
  const { participants } = req.body;
  if (!Array.isArray(participants) || participants.length === 0) {
    return res.status(400).json({ success: false, message: 'Invalid or empty participants array.' });
  }
  const result = await supabaseRepository.importParticipants(participants);
  await raffleService.reloadParticipants();
  const updatedCtrlState = await raffleService.getControllerState();
  wsManager.broadcastController('STATE_UPDATED', updatedCtrlState);
  res.json({ success: true, ...result });
});

// ==========================================
// 3.1. EXCEL PARTICIPANT SEEDING APIS (CONTROLLER ONLY)
// ==========================================

app.get('/api/controller/seed/preview', requireControllerAuth, async (_req: Request, res: Response) => {
  try {
    let fileInfo = findRootExcelFile();
    if (!fileInfo) {
      const samplePath = ensureSampleExcelFile();
      fileInfo = { filePath: samplePath, fileName: 'data.excel' };
    }

    const fileBuffer = fs.readFileSync(fileInfo.filePath);
    const parsed = parseExcelBuffer(fileBuffer, fileInfo.fileName);
    const dbHealth = await checkSupabaseHealth();

    res.json({
      success: true,
      data: parsed,
      dbStatus: {
        connected: dbHealth.connected,
        current_participants: dbHealth.participant_count,
        is_empty: dbHealth.is_empty,
      },
    });
  } catch (err: any) {
    console.error('[Controller API] Excel Preview Error:', err);
    res.status(500).json({
      success: false,
      message: `Failed to read excel file: ${err.message}`,
    });
  }
});

app.post('/api/controller/seed/parse-upload', requireControllerAuth, async (req: Request, res: Response) => {
  try {
    const { base64Data, fileName } = req.body;
    if (!base64Data) {
      return res.status(400).json({ success: false, message: 'Missing base64Data in request.' });
    }

    const buffer = Buffer.from(base64Data, 'base64');
    const parsed = parseExcelBuffer(buffer, fileName || 'uploaded.xlsx');
    const dbHealth = await checkSupabaseHealth();

    res.json({
      success: true,
      data: parsed,
      dbStatus: {
        connected: dbHealth.connected,
        current_participants: dbHealth.participant_count,
        is_empty: dbHealth.is_empty,
      },
    });
  } catch (err: any) {
    console.error('[Controller API] Excel Upload Parse Error:', err);
    res.status(400).json({
      success: false,
      message: `Failed to parse uploaded excel file: ${err.message}`,
    });
  }
});

app.post('/api/controller/seed/commit', requireControllerAuth, async (req: Request, res: Response) => {
  try {
    const { rows, mode } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No rows provided to commit.' });
    }

    const result = await commitExcelParticipantsToDb(rows, mode === 'replace' ? 'replace' : 'append');

    // Refresh raffle service participants pool and notify clients
    await raffleService.reloadParticipants();
    const updatedCtrlState = await raffleService.getControllerState();
    wsManager.broadcastController('STATE_UPDATED', updatedCtrlState);
    wsManager.broadcastAudience('DRAW_STATE', raffleService.getPublicState());

    res.json(result);
  } catch (err: any) {
    console.error('[Controller API] Excel Commit Error:', err);
    res.status(500).json({
      success: false,
      message: `Failed to commit participants: ${err.message}`,
    });
  }
});

// ==========================================
// 4. ADMIN RFC 4180 CSV EXPORTS (UTF-8 BOM)
// ==========================================

function sendCsv(res: Response, filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const escapeCell = (val: any): string => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const headerLine = headers.map(escapeCell).join(',');
  const rowLines = rows.map((r) => r.map(escapeCell).join(',')).join('\r\n');
  const csvContent = '\uFEFF' + headerLine + '\r\n' + rowLines;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csvContent);
}

app.get('/api/controller/export/winners.csv', requireControllerAuth, async (_req: Request, res: Response) => {
  const data = await supabaseRepository.getResults();
  const headers = ['Serial', 'Category', 'ID_Roll', 'Name', 'Designation', 'Status', 'Drawn_At'];
  const rows = data.results.map((w) => [
    `#${String(w.serial).padStart(2, '0')}`,
    w.type.toUpperCase(),
    w.id || 'N/A',
    w.name,
    w.designation || 'DUET CSE',
    w.status,
    w.drawn_at,
  ]);
  sendCsv(res, `DUET_CSE_Fest_2026_Official_Winners_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
});

app.get('/api/controller/export/participants.csv', requireControllerAuth, async (_req: Request, res: Response) => {
  const participants = await supabaseRepository.getParticipants();
  const headers = ['ID_Roll', 'Name', 'Category', 'Designation', 'Eligible_State'];
  const rows = participants.map((p) => [
    p.id || 'N/A',
    p.name,
    p.type.toUpperCase(),
    p.designation || 'DUET CSE',
    p.eligible === 1 ? 'ELIGIBLE' : 'INELIGIBLE',
  ]);
  sendCsv(res, `DUET_CSE_Fest_2026_Participants_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
});

app.get('/api/controller/export/registrations.csv', requireControllerAuth, async (_req: Request, res: Response) => {
  const requests = await supabaseRepository.getRegistrationRequests();
  const headers = ['Request_ID', 'ID_Roll', 'Name', 'Category', 'Designation', 'Status', 'Reviewed_By', 'Submitted_At'];
  const rows = requests.map((r) => [
    r.id,
    r.external_id || 'N/A',
    r.name,
    r.type.toUpperCase(),
    r.designation || 'DUET CSE',
    r.status.toUpperCase(),
    r.reviewed_by || 'Pending',
    r.created_at,
  ]);
  sendCsv(res, `DUET_CSE_Fest_2026_Self_Registrations_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
});

app.get('/api/controller/export/audit-logs.csv', requireControllerAuth, async (_req: Request, res: Response) => {
  const logs = await supabaseRepository.getAuditLogs(500);
  const headers = ['ID', 'Action', 'Details_JSON', 'IP_Address', 'Timestamp'];
  const rows = logs.map((l) => [
    l.id,
    l.action,
    JSON.stringify(l.details || {}),
    l.ip_address || 'N/A',
    l.timestamp,
  ]);
  sendCsv(res, `DUET_CSE_Fest_2026_Audit_Logs_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
});

app.get('/api/controller/export/visitor-analytics.csv', requireControllerAuth, (_req: Request, res: Response) => {
  const stats = supabaseRepository.getVisitorAnalytics();
  const headers = ['Active_Now', 'Total_Page_Views', 'Unique_IP_Visitors', 'Peak_Concurrent', 'Exported_At'];
  const rows = [
    [stats.active_now, stats.total_views, stats.unique_visitors, stats.peak_concurrent, new Date().toISOString()],
  ];
  sendCsv(res, `DUET_CSE_Fest_2026_Visitor_Analytics_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
});

// ==========================================
// 5. VITE / STATIC SERVING
// ==========================================

async function setupViteOrStatic() {
  // If running on Vercel serverless, do not mount dev server or bind port
  if (process.env.VERCEL) {
    return;
  }

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
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

setupViteOrStatic();

export { app, server };
export default app;
