import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MaterialIcon } from './MaterialIcon.tsx';
import { useTheme } from '../hooks/useTheme.ts';
import { HealthStatus } from '../types.ts';
import { api } from '../services/api.ts';
import { useWebSocket } from '../hooks/useWebSocket.ts';

export const HealthDashboard: React.FC = () => {
  const { theme, toggleTheme, isDark } = useTheme();
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [lastRefreshed, setLastRefreshed] = useState<string>('');

  const { isConnected, lastMessage } = useWebSocket('audience');

  const fetchHealth = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    setError('');
    try {
      const data = await api.getHealth();
      setHealth(data);
      setLastRefreshed(new Date().toLocaleTimeString());
    } catch (err: any) {
      setError(err.message || 'Failed to fetch telemetry data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth(true);
    // Dynamic polling every 3 seconds for live memory and connection metrics
    const interval = setInterval(() => fetchHealth(false), 3000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  const handledMsgRef = useRef<string>('');

  // Dynamic WebSocket trigger
  useEffect(() => {
    if (lastMessage) {
      const sig = (lastMessage as any).id || `${lastMessage.type}_${lastMessage.timestamp}`;
      if (handledMsgRef.current === sig) return;
      handledMsgRef.current = sig;

      fetchHealth(false);
    }
  }, [lastMessage, fetchHealth]);

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${d > 0 ? `${d}d ` : ''}${h}h ${m}m ${s}s`;
  };

  return (
    <div id="health-dashboard-root" className="min-h-screen w-full p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <header className="glass-panel p-6 rounded-3xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 shadow-lg">
            <MaterialIcon name="monitor_heart" size={26} />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-black font-display text-white">System Health & Telemetry</h1>
            <p className="text-xs text-slate-300 font-medium">
              {health?.event || 'DUET CSE Fest 2026'} • Uptime: <strong className="text-white">{health ? formatUptime(health.uptime_seconds) : '—'}</strong>
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2.5">
          <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            LIVE TELEMETRY
          </span>

          <button
            onClick={() => fetchHealth(true)}
            disabled={loading}
            className="px-3.5 py-2 rounded-xl glass-pill text-xs font-bold text-slate-200 hover:text-white flex items-center gap-1.5 cursor-pointer"
          >
            <MaterialIcon name="refresh" size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>

          <a
            href="/controller"
            className="px-3.5 py-2 rounded-xl glass-pill text-xs font-bold text-slate-200 hover:text-white flex items-center gap-1.5"
          >
            <MaterialIcon name="admin_panel_settings" size={16} />
            Controller
          </a>

          <button
            onClick={toggleTheme}
            className="p-2 rounded-xl glass-pill text-slate-300 hover:text-white cursor-pointer"
            title="Toggle theme"
          >
            <MaterialIcon name={isDark ? 'light_mode' : 'dark_mode'} size={18} />
          </button>
        </div>
      </header>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs font-semibold flex items-center gap-2">
          <MaterialIcon name="error" size={18} />
          {error}
        </div>
      )}

      {/* Core Health Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-panel p-6 rounded-3xl border border-emerald-500/40 bg-emerald-500/10">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">System State</span>
            <span className="w-3 h-3 rounded-full bg-emerald-400 animate-ping" />
          </div>
          <div className="text-2xl md:text-3xl font-black font-display text-white mt-2">
            {health?.status.toUpperCase() || 'ONLINE & HEALTHY'}
          </div>
          <p className="text-xs text-slate-300 mt-1">All core subsystems operating normally</p>
        </div>

        <div className="glass-panel p-6 rounded-3xl border border-cyan-500/30">
          <div className="text-xs font-bold uppercase tracking-wider text-cyan-300">Memory Allocation</div>
          <div className="text-2xl md:text-3xl font-black font-display text-cyan-300 mt-2">
            {health?.memory.heap_used_mb ?? 0} MB <span className="text-xs text-slate-300 font-normal">Heap</span>
          </div>
          <p className="text-xs text-slate-300 mt-1">Resident Set Size: {health?.memory.rss_mb ?? 0} MB</p>
        </div>

        <div className="glass-panel p-6 rounded-3xl border border-purple-500/30">
          <div className="text-xs font-bold uppercase tracking-wider text-purple-300">Real-time Stream</div>
          <div className="text-2xl md:text-3xl font-black font-display text-purple-300 mt-2">
            {health?.metrics.active_ws_connections ?? 0} <span className="text-xs text-slate-300 font-normal">Active</span>
          </div>
          <p className="text-xs text-slate-300 mt-1">
            Audience: {health?.metrics.audience_connections ?? 0} • Controller: {health?.metrics.controller_connections ?? 0}
          </p>
        </div>
      </div>

      {/* Services Subsystem Integrity Checklist */}
      <div className="glass-panel p-6 rounded-3xl space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold font-display text-white flex items-center gap-2">
            <MaterialIcon name="fact_check" className="text-emerald-400" />
            Subsystem Integrity Verification
          </h2>
          <span className="text-[11px] text-slate-400 font-mono">
            Updated {lastRefreshed || 'just now'}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          {health?.services &&
            Object.entries(health.services).map(([service, isOk]) => (
              <div
                key={service}
                className="p-3 rounded-2xl glass-card flex items-center justify-between border border-slate-700/50"
              >
                <span className="font-semibold text-slate-200 capitalize">{service}</span>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    isOk
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  }`}
                >
                  <MaterialIcon name={isOk ? 'check' : 'close'} size={12} className="mr-1" />
                  {isOk ? 'ONLINE' : 'OFFLINE'}
                </span>
              </div>
            ))}
        </div>
      </div>

      {/* Raffle Operational Metrics */}
      <div className="glass-panel p-6 rounded-3xl space-y-4">
        <h2 className="text-base font-bold font-display text-white flex items-center gap-2">
          <MaterialIcon name="analytics" className="text-cyan-400" />
          Live Event Statistics
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
          <div className="p-4 rounded-2xl glass-card border border-slate-700/50">
            <div className="text-xs text-slate-300 font-medium">Total Participants</div>
            <div className="text-2xl font-bold font-display text-white mt-1">
              {health?.metrics.total_participants ?? 0}
            </div>
          </div>

          <div className="p-4 rounded-2xl glass-card border border-slate-700/50">
            <div className="text-xs text-slate-300 font-medium">Eligible Candidates</div>
            <div className="text-2xl font-bold font-display text-cyan-300 mt-1">
              {health?.metrics.eligible_count ?? 0}
            </div>
          </div>

          <div className="p-4 rounded-2xl glass-card border border-slate-700/50">
            <div className="text-xs text-slate-300 font-medium">Confirmed Winners</div>
            <div className="text-2xl font-bold font-display text-amber-300 mt-1">
              {health?.metrics.completed_winners ?? 0} / {health?.metrics.total_winners ?? 10}
            </div>
          </div>

          <div className="p-4 rounded-2xl glass-card border border-slate-700/50">
            <div className="text-xs text-slate-300 font-medium">Draw Mutex Lock</div>
            <div className="text-2xl font-bold font-display text-pink-400 mt-1">
              {health?.metrics.draw_lock_active ? 'LOCKED' : 'UNLOCKED'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
