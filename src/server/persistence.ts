import fs from 'fs';
import path from 'path';
import { Participant, WinnerResult, IgnoredCandidate, SessionState, AuditRecord } from '../types.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

const PARTICIPANTS_FILE = path.join(DATA_DIR, 'participants.json');
const RESULT_FILE = path.join(DATA_DIR, 'result.json');
const SESSION_FILE = path.join(DATA_DIR, 'session.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.json');

export interface ResultsData {
  event: string;
  total_winners: number;
  results: WinnerResult[];
  ignored: IgnoredCandidate[];
}

export function ensureDirectoriesExist(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
}

/**
 * Performs atomic JSON file writes using temporary file flush and rename.
 * Guarantees no partial or corrupted writes if interrupted.
 */
export function atomicWriteJson(filePath: string, data: any): void {
  ensureDirectoriesExist();
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.${path.basename(filePath)}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 8)}`);

  const jsonString = JSON.stringify(data, null, 2);

  // Write and flush to disk
  const fd = fs.openSync(tempPath, 'w');
  try {
    fs.writeSync(fd, jsonString);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  // Atomic replace
  fs.renameSync(tempPath, filePath);
}

export function createBackup(reason: string): string {
  ensureDirectoriesExist();
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const backupFolder = path.join(BACKUPS_DIR, `${timestamp}_${reason.replace(/[^a-zA-Z0-9_-]/g, '')}`);

  fs.mkdirSync(backupFolder, { recursive: true });

  const filesToCopy = [
    { src: PARTICIPANTS_FILE, name: 'participants.json' },
    { src: RESULT_FILE, name: 'result.json' },
    { src: SESSION_FILE, name: 'session.json' },
    { src: AUDIT_FILE, name: 'audit.json' },
  ];

  let copied = 0;
  for (const item of filesToCopy) {
    if (fs.existsSync(item.src)) {
      fs.copyFileSync(item.src, path.join(backupFolder, item.name));
      copied++;
    }
  }

  return backupFolder;
}

export function readParticipants(): Participant[] {
  ensureDirectoriesExist();
  if (!fs.existsSync(PARTICIPANTS_FILE)) {
    throw new Error(`Participants file not found at ${PARTICIPANTS_FILE}`);
  }
  const raw = fs.readFileSync(PARTICIPANTS_FILE, 'utf-8');
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('participants.json must be an array of participants.');
    }
    return parsed;
  } catch (err: any) {
    throw new Error(`Corrupted participants.json: ${err.message}`);
  }
}

export function writeParticipants(participants: Participant[]): void {
  atomicWriteJson(PARTICIPANTS_FILE, participants);
}

export function readResults(): ResultsData {
  ensureDirectoriesExist();
  if (!fs.existsSync(RESULT_FILE)) {
    const defaultResult: ResultsData = {
      event: 'DUET CSE Fest 2026',
      total_winners: 10,
      results: [],
      ignored: [],
    };
    atomicWriteJson(RESULT_FILE, defaultResult);
    return defaultResult;
  }
  const raw = fs.readFileSync(RESULT_FILE, 'utf-8');
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.results || !Array.isArray(parsed.results)) {
      parsed.results = [];
    }
    if (!parsed.ignored || !Array.isArray(parsed.ignored)) {
      parsed.ignored = [];
    }
    return parsed;
  } catch (err: any) {
    throw new Error(`Corrupted result.json: ${err.message}`);
  }
}

export function writeResults(results: ResultsData): void {
  atomicWriteJson(RESULT_FILE, results);
}

export function readSession(): SessionState | null {
  ensureDirectoriesExist();
  if (!fs.existsSync(SESSION_FILE)) {
    return null;
  }
  const raw = fs.readFileSync(SESSION_FILE, 'utf-8');
  try {
    return JSON.parse(raw) as SessionState;
  } catch (err: any) {
    throw new Error(`Corrupted session.json: ${err.message}`);
  }
}

export function writeSession(session: SessionState): void {
  atomicWriteJson(SESSION_FILE, session);
}

export function appendAudit(action: string, details?: Record<string, any>): void {
  ensureDirectoriesExist();
  let auditLogs: AuditRecord[] = [];
  if (fs.existsSync(AUDIT_FILE)) {
    try {
      const raw = fs.readFileSync(AUDIT_FILE, 'utf-8');
      auditLogs = JSON.parse(raw);
      if (!Array.isArray(auditLogs)) auditLogs = [];
    } catch {
      auditLogs = [];
    }
  }

  const record: AuditRecord = {
    action,
    timestamp: new Date().toISOString(),
    details,
  };

  auditLogs.push(record);
  atomicWriteJson(AUDIT_FILE, auditLogs);
}

export function checkStorageIntegrity() {
  ensureDirectoriesExist();
  return {
    participants_exists: fs.existsSync(PARTICIPANTS_FILE),
    result_exists: fs.existsSync(RESULT_FILE),
    session_exists: fs.existsSync(SESSION_FILE),
    audit_exists: fs.existsSync(AUDIT_FILE),
    backups_exists: fs.existsSync(BACKUPS_DIR),
  };
}
