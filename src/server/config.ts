import dotenv from 'dotenv';
dotenv.config();

export interface AppConfig {
  EVENT_NAME: string;
  TOTAL_WINNERS: number;
  DRAW_COUNTDOWN_SECONDS: number;
  SHUFFLE_PASSES: number;
  WINNER_REVEAL_SECONDS: number;
  NAME_ROLL_DURATION_MS: number;
  BEEP_ENABLED: boolean;
  CONFETTI_ENABLED: boolean;
  CONTROLLER_USERNAME: string;
  CONTROLLER_PASSWORD: string;
  SECRET_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_ANON_KEY: string;
  PORT: number;
}

export const AppConfig = {} as any;

function parseBoolean(val: string | undefined, defaultValue: boolean): boolean {
  if (val === undefined || val.trim() === '') {
    return defaultValue;
  }
  const lower = val.trim().toLowerCase();
  if (lower === 'true' || lower === '1') return true;
  if (lower === 'false' || lower === '0') return false;
  return defaultValue;
}

function parsePositiveInt(val: string | undefined, defaultValue: number, allowZero = false): number {
  if (val === undefined || val.trim() === '') {
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

export function loadAndValidateConfig(): AppConfig {
  const EVENT_NAME = process.env.EVENT_NAME?.trim() || 'DUET CSE Fest 2026';
  const TOTAL_WINNERS = parsePositiveInt(process.env.TOTAL_WINNERS, 10);
  const DRAW_COUNTDOWN_SECONDS = parsePositiveInt(process.env.DRAW_COUNTDOWN_SECONDS, 5, true);
  const SHUFFLE_PASSES = parsePositiveInt(process.env.SHUFFLE_PASSES, 7);
  const WINNER_REVEAL_SECONDS = parsePositiveInt(process.env.WINNER_REVEAL_SECONDS, 3);
  const NAME_ROLL_DURATION_MS = parsePositiveInt(process.env.NAME_ROLL_DURATION_MS, 3000);
  const BEEP_ENABLED = parseBoolean(process.env.BEEP_ENABLED, true);
  const CONFETTI_ENABLED = parseBoolean(process.env.CONFETTI_ENABLED, true);
  const CONTROLLER_USERNAME = process.env.CONTROLLER_USERNAME?.trim() || 'admin';
  const CONTROLLER_PASSWORD = process.env.CONTROLLER_PASSWORD?.trim() || 'duetcsefest2026password';
  const SECRET_KEY = process.env.SECRET_KEY?.trim() || 'duet-cse-fest-raffle-secure-key-2026-very-strong';
  const SUPABASE_URL = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || 'https://toyocrdimcvkmiidposk.supabase.co';
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRveW9jcmRpbWN2a21paWRwb3NrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODE3MzA0MCwiZXhwIjoyMDkzNzQ5MDQwfQ.SSV-Cfid5yjv4JqEJNxbMdXSC8U7k4xMGNnqRGuacmU';
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRveW9jcmRpbWN2a21paWRwb3NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNzMwNDAsImV4cCI6MjA5Mzc0OTA0MH0.tcrMtLApEH13VotkJTsNqg2c0FbTwFhoUSIwzxfNF3U';

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
    PORT: 3000,
  };
}
