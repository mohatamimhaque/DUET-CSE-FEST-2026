import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MaterialIcon } from './MaterialIcon.tsx';
import { useWebSocket } from '../hooks/useWebSocket.ts';
import { useTheme } from '../hooks/useTheme.ts';
import { ControllerState, WinnerResult } from '../types.ts';
import { api, getStoredToken, setStoredToken } from '../services/api.ts';

export const RemoteController: React.FC = () => {
  const { toggleTheme, isDark } = useTheme();
  const { isConnected, lastMessage, isSupabaseRealtime } = useWebSocket('controller');

  // Authentication State
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => !!getStoredToken());
  const [isCheckingAuth, setIsCheckingAuth] = useState<boolean>(true);
  const [usernameInput, setUsernameInput] = useState<string>('');
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [loginError, setLoginError] = useState<string>('');
  const [loginSubmitting, setLoginSubmitting] = useState<boolean>(false);

  // Controller State
  const [state, setState] = useState<ControllerState | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [successToast, setSuccessToast] = useState<string>('');

  // Modals & Panels
  const [showIgnoreModal, setShowIgnoreModal] = useState<boolean>(false);
  const [ignoreReason, setIgnoreReason] = useState<string>('absent');
  const [showWinnersSheet, setShowWinnersSheet] = useState<boolean>(false);
  const [recentWinners, setRecentWinners] = useState<WinnerResult[]>([]);
  const [hapticsEnabled, setHapticsEnabled] = useState<boolean>(true);

  // Synchronized Remote Countdown State
  const [remoteCountdown, setRemoteCountdown] = useState<number>(5);
  const [remoteCountdownTotal, setRemoteCountdownTotal] = useState<number>(5);
  const [remoteStagePhase, setRemoteStagePhase] = useState<'IDLE' | 'COUNTDOWN' | 'ROLLING'>('IDLE');
  const remoteStagePhaseRef = useRef<'IDLE' | 'COUNTDOWN' | 'ROLLING'>('IDLE');
  remoteStagePhaseRef.current = remoteStagePhase;
  const isCountingDownRef = useRef<boolean>(false);
  const remoteCountIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Haptic feedback helper
  const triggerHaptic = useCallback((pattern: number | number[] = 50) => {
    if (!hapticsEnabled) return;
    try {
      if (typeof window !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(pattern);
      }
    } catch {}
  }, [hapticsEnabled]);

  const clearRemoteTimers = useCallback(() => {
    isCountingDownRef.current = false;
    if (remoteCountIntervalRef.current) {
      clearInterval(remoteCountIntervalRef.current);
      remoteCountIntervalRef.current = null;
    }
  }, []);

  const fetchStateRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const startRemoteCountdown = useCallback((payloadOrSeconds: any = 5) => {
    // Guard: never restart if countdown is already actively in flight
    if (isCountingDownRef.current || remoteStagePhaseRef.current !== 'IDLE') return;
    isCountingDownRef.current = true;
    clearRemoteTimers();

    const isObj = typeof payloadOrSeconds === 'object' && payloadOrSeconds !== null;
    const cdSeconds = isObj ? (payloadOrSeconds.countdown_seconds || 5) : (Number(payloadOrSeconds) || 5);
    const now = Date.now();
    const countdownEndMs = isObj && payloadOrSeconds.countdown_end_ms ? payloadOrSeconds.countdown_end_ms : (now + cdSeconds * 1000);
    const rollDurationMs = isObj && payloadOrSeconds.roll_duration_ms ? payloadOrSeconds.roll_duration_ms : 2200;
    const revealTimeMs = isObj && payloadOrSeconds.reveal_time_ms ? payloadOrSeconds.reveal_time_ms : (countdownEndMs + rollDurationMs);

    setRemoteCountdownTotal(cdSeconds);

    const startRemoteRolling = () => {
      clearRemoteTimers();
      isCountingDownRef.current = false;
      setRemoteStagePhase('ROLLING');
      remoteStagePhaseRef.current = 'ROLLING';
      triggerHaptic([60, 40, 60]);

      // Roll until revealTimeMs
      const rollRemainingMs = Math.max(600, revealTimeMs - Date.now());
      remoteCountIntervalRef.current = setTimeout(() => {
        setRemoteStagePhase('IDLE');
        remoteStagePhaseRef.current = 'IDLE';
        fetchStateRef.current().catch(() => {});
      }, rollRemainingMs);
    };

    const initialRemainingMs = countdownEndMs - Date.now();
    if (initialRemainingMs <= 100) {
      startRemoteRolling();
      return;
    }

    const initialSec = Math.max(1, Math.ceil(initialRemainingMs / 1000));
    setRemoteCountdown(initialSec);
    setRemoteStagePhase('COUNTDOWN');
    remoteStagePhaseRef.current = 'COUNTDOWN';

    let lastBeepSec = initialSec;
    remoteCountIntervalRef.current = setInterval(() => {
      const remainingMs = countdownEndMs - Date.now();
      const currentSec = Math.ceil(remainingMs / 1000);

      if (remainingMs > 0) {
        if (currentSec !== lastBeepSec && currentSec > 0) {
          lastBeepSec = currentSec;
          setRemoteCountdown(currentSec);
          triggerHaptic(50);
        }
      } else {
        startRemoteRolling();
      }
    }, 50);
  }, [clearRemoteTimers, triggerHaptic]);

  useEffect(() => {
    return () => {
      clearRemoteTimers();
    };
  }, [clearRemoteTimers]);

  // Show temporary toast message
  const showToast = useCallback((msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => setSuccessToast(''), 3500);
  }, []);

  // Check URL token (e.g. from QR code scan: /remote?token=...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get('token');
    if (tokenFromUrl) {
      setStoredToken(tokenFromUrl);
      setIsAuthenticated(true);
      // Clean up URL query parameters without reloading
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
    }
  }, []);

  // Verify authentication with server
  const checkAuth = useCallback(async () => {
    setIsCheckingAuth(true);
    try {
      const ok = await api.checkAuth();
      setIsAuthenticated(ok);
      if (ok) {
        fetchState();
      }
    } catch {
      setIsAuthenticated(false);
    } finally {
      setIsCheckingAuth(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Fetch full controller state
  const fetchState = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const s = await api.getControllerState();
      setState(s);
      setErrorMessage('');
    } catch (err: any) {
      if (err.message === 'AUTH_REQUIRED') {
        setIsAuthenticated(false);
      } else {
        setErrorMessage('Failed to connect to controller service.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);
  fetchStateRef.current = fetchState;

  // Fetch recent winners for mobile drawer
  const fetchWinners = useCallback(async () => {
    try {
      const res = await api.getResults();
      if (res.results) {
        setRecentWinners(res.results);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchState();
    fetchWinners();

    // 1.5s active sync for mobile remote resilience
    const intervalId = setInterval(() => {
      fetchState();
    }, 1500);

    const onWake = () => {
      if (document.visibilityState === 'visible') {
        fetchState();
        fetchWinners();
      }
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('online', onWake);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('online', onWake);
    };
  }, [isAuthenticated, fetchState, fetchWinners]);

  // Handle WebSocket push updates
  const handledMsgSigRef = useRef<string>('');
  useEffect(() => {
    if (!lastMessage) return;
    const sig = (lastMessage as any).id || `${lastMessage.type}_${lastMessage.timestamp}_${JSON.stringify(lastMessage.payload || '')}`;
    if (handledMsgSigRef.current === sig) return;
    handledMsgSigRef.current = sig;

    if (lastMessage.type === 'STATE_UPDATED') {
      setState(lastMessage.payload);
      if (lastMessage.payload?.status === 'WAITING_CONFIRMATION') {
        triggerHaptic([100, 50, 100]);
        setRemoteStagePhase('IDLE');
        remoteStagePhaseRef.current = 'IDLE';
        clearRemoteTimers();
      } else if (
        lastMessage.payload?.status === 'DRAWING' &&
        !isCountingDownRef.current &&
        remoteStagePhaseRef.current === 'IDLE'
      ) {
        startRemoteCountdown(5);
      } else if (lastMessage.payload?.status !== 'DRAWING' && remoteStagePhaseRef.current !== 'IDLE') {
        setRemoteStagePhase('IDLE');
        remoteStagePhaseRef.current = 'IDLE';
        clearRemoteTimers();
      }
    } else if (lastMessage.type === 'DRAW_START') {
      triggerHaptic(80);
      startRemoteCountdown(lastMessage.payload);
      fetchState().catch(() => {});
    } else if (lastMessage.type === 'WINNER_CONFIRMED') {
      triggerHaptic([150, 80, 200]);
      showToast(`Winner #${lastMessage.payload?.winner?.serial} confirmed!`);
      setRemoteStagePhase('IDLE');
      remoteStagePhaseRef.current = 'IDLE';
      clearRemoteTimers();
      fetchState();
      fetchWinners();
    } else if (lastMessage.type === 'CANDIDATE_IGNORED') {
      triggerHaptic([80, 50, 80]);
      showToast(`Candidate skipped (${lastMessage.payload?.reason || 'absent'})`);
      setRemoteStagePhase('IDLE');
      remoteStagePhaseRef.current = 'IDLE';
      clearRemoteTimers();
      fetchState();
    } else if (lastMessage.type === 'RESET' || lastMessage.type === 'SESSION_RESET') {
      setRemoteStagePhase('IDLE');
      remoteStagePhaseRef.current = 'IDLE';
      clearRemoteTimers();
      fetchState();
      fetchWinners();
    }
  }, [lastMessage, fetchState, fetchWinners, triggerHaptic, showToast, startRemoteCountdown, clearRemoteTimers]);

  // Login handler for mobile
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameInput.trim() || !passwordInput) {
      setLoginError('Username and password are required.');
      return;
    }
    setLoginError('');
    setLoginSubmitting(true);
    try {
      await api.login(usernameInput.trim(), passwordInput);
      setIsAuthenticated(true);
      triggerHaptic([50, 50]);
      await fetchState();
    } catch (err: any) {
      setLoginError(err.message || 'Authentication failed. Please verify your credentials.');
      triggerHaptic([100, 100, 100]);
    } finally {
      setLoginSubmitting(false);
    }
  };

  // Mobile Draw Actions
  const handleStartDraw = async () => {
    if (actionLoading) return;
    setActionLoading(true);
    setErrorMessage('');
    triggerHaptic(70);
    try {
      const res = await api.startDraw();
      startRemoteCountdown(res.countdown_seconds || 5);
      showToast(res.message || 'Draw initiated on stage!');
      await fetchState();
    } catch (err: any) {
      setErrorMessage(err.message || 'Unable to start draw.');
      triggerHaptic([150, 100]);
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmWinner = async () => {
    if (actionLoading) return;
    clearRemoteTimers();
    setRemoteStagePhase('IDLE');
    setActionLoading(true);
    setErrorMessage('');
    triggerHaptic([100, 80, 150]);
    try {
      const res = await api.confirmWinner();
      showToast(res.message || 'Winner confirmed!');
      setState((prev) =>
        prev
          ? {
              ...prev,
              current_candidate: null,
              completed_winners: prev.completed_winners + 1,
              next_serial: prev.next_serial + 1,
              status: prev.completed_winners + 1 >= prev.total_winners ? 'COMPLETED' : 'READY',
            }
          : prev
      );
      fetchState().catch(() => {});
      fetchWinners().catch(() => {});
    } catch (err: any) {
      setErrorMessage(err.message || 'Unable to confirm winner.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleIgnoreCandidate = async () => {
    if (actionLoading) return;
    clearRemoteTimers();
    setRemoteStagePhase('IDLE');
    setActionLoading(true);
    setErrorMessage('');
    triggerHaptic(60);
    try {
      const res = await api.ignoreCandidate(ignoreReason);
      setShowIgnoreModal(false);
      showToast(res.message || 'Candidate ignored.');
      setState((prev) =>
        prev
          ? {
              ...prev,
              current_candidate: null,
              status: 'READY',
            }
          : prev
      );
      fetchState().catch(() => {});
    } catch (err: any) {
      setErrorMessage(err.message || 'Unable to ignore candidate.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleTogglePause = async () => {
    if (!state || actionLoading) return;
    setActionLoading(true);
    triggerHaptic(50);
    try {
      if (state.status === 'PAUSED') {
        await api.resume();
        showToast('Raffle session resumed');
      } else {
        await api.pause();
        showToast('Raffle session paused');
      }
      await fetchState();
    } catch (err: any) {
      setErrorMessage(err.message || 'Action failed.');
    } finally {
      setActionLoading(false);
    }
  };

  // 1. Loading Splash
  if (isCheckingAuth) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center p-6 bg-slate-950 text-white">
        <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center animate-spin text-white shadow-xl mb-4">
          <MaterialIcon name="sync" size={32} />
        </div>
        <p className="text-sm font-semibold text-slate-300">Connecting to Mobile Remote...</p>
        <p className="text-xs text-slate-500 mt-1">DUET CSE Fest 2026</p>
      </div>
    );
  }

  // 2. Mobile Login Screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen w-full flex flex-col justify-between p-6 bg-slate-950 text-white max-w-md mx-auto">
        <div className="pt-8">
          <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center text-white shadow-xl shadow-indigo-500/20 mb-6">
            <MaterialIcon name="phonelink_ring" size={36} />
          </div>
          <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
            Official Mobile Remote
          </span>
          <h1 className="text-2xl font-black font-display text-white mt-3">DUET CSE Fest 2026</h1>
          <p className="text-sm text-slate-400 mt-1.5 leading-relaxed">
            Scan the QR code from the Desktop Controller Console to auto-authenticate, or enter the administrator password below.
          </p>
        </div>

        <div className="my-auto py-6">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                Controller Username
              </label>
              <div className="relative">
                <input
                  id="mobile-username-input"
                  type="text"
                  autoComplete="username"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  placeholder="Enter controller username"
                  className="w-full px-4 py-3.5 rounded-2xl bg-slate-900 border border-slate-700 text-white text-base focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                Controller Password
              </label>
              <div className="relative">
                <input
                  id="mobile-password-input"
                  type="password"
                  autoComplete="current-password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Enter controller password"
                  className="w-full px-4 py-3.5 rounded-2xl bg-slate-900 border border-slate-700 text-white text-base focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 transition"
                />
              </div>
            </div>

            {loginError && (
              <div className="p-3.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2">
                <MaterialIcon name="error_outline" size={18} />
                <span>{loginError}</span>
              </div>
            )}

            <button
              id="mobile-login-submit"
              type="submit"
              disabled={loginSubmitting}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 active:scale-[0.98] text-white font-extrabold text-base shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 transition disabled:opacity-50"
            >
              <MaterialIcon name={loginSubmitting ? 'sync' : 'lock_open'} size={20} className={loginSubmitting ? 'animate-spin' : ''} />
              {loginSubmitting ? 'Authenticating...' : 'Unlock Mobile Remote'}
            </button>
          </form>
        </div>

        <div className="pt-4 border-t border-slate-800 text-center">
          <p className="text-xs text-slate-500">
            Authorized Controllers Only • High-Precision Auto-Sync
          </p>
        </div>
      </div>
    );
  }

  // Helper variables for UI presentation
  const isDrawing = state?.status === 'DRAWING';
  const isWaitingConfirmation = state?.status === 'WAITING_CONFIRMATION';
  const isWinnerConfirmed = state?.status === 'WINNER_CONFIRMED';
  const isCompleted = state?.status === 'COMPLETED';
  const isPaused = state?.status === 'PAUSED';

  const completedWinners = state?.completed_winners || 0;
  const totalWinners = state?.total_winners || 10;
  const nextSerial = state?.next_serial || completedWinners + 1;
  const candidate = state?.current_candidate;

  return (
    <div className="min-h-screen w-full bg-slate-950 text-white flex flex-col justify-between max-w-lg mx-auto p-4 sm:p-6 select-none">
      {/* Toast Notification */}
      {successToast && (
        <div className="fixed top-4 inset-x-4 z-50 max-w-md mx-auto p-3.5 rounded-2xl bg-emerald-600 text-white shadow-2xl flex items-center gap-2.5 text-sm font-bold animate-bounce">
          <MaterialIcon name="check_circle" size={20} />
          <span className="flex-1">{successToast}</span>
        </div>
      )}

      {/* Top Mobile App Bar */}
      <header className="flex items-center justify-between pb-4 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center text-white shadow-md">
            <MaterialIcon name="phonelink" size={22} />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-black font-display tracking-tight text-white">DUET CSE FEST</h1>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                REMOTE
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
              <span className="text-[11px] text-slate-400 font-medium">
                {isSupabaseRealtime ? 'Supabase Realtime' : isConnected ? 'Live Synchronized' : 'Reconnecting...'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setHapticsEnabled(!hapticsEnabled)}
            className={`p-2 rounded-xl border text-xs transition ${
              hapticsEnabled
                ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                : 'bg-slate-900 text-slate-500 border-slate-800'
            }`}
            title="Toggle Haptic Feedback"
          >
            <MaterialIcon name={hapticsEnabled ? 'vibration' : 'mobile_off'} size={18} />
          </button>
          <button
            onClick={toggleTheme}
            className="p-2 rounded-xl bg-slate-900 text-slate-400 hover:text-white border border-slate-800 text-xs transition"
            title="Toggle theme"
          >
            <MaterialIcon name={isDark ? 'light_mode' : 'dark_mode'} size={18} />
          </button>
          <a
            href="/controller"
            className="p-2 rounded-xl bg-slate-900 text-slate-400 hover:text-white border border-slate-800 text-xs transition"
            title="Switch to Desktop Controller"
          >
            <MaterialIcon name="desktop_windows" size={18} />
          </a>
        </div>
      </header>

      {/* Main Content Body */}
      <main className="flex-1 py-4 flex flex-col justify-center gap-4">
        {/* Progress & Quick Stats Card */}
        <div className="p-4 rounded-3xl bg-slate-900/90 border border-slate-800 shadow-xl">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-slate-400 font-bold uppercase tracking-wider">Raffle Progress</span>
            <span className="font-extrabold text-cyan-400">
              {completedWinners} / {totalWinners} Winners ({Math.round((completedWinners / totalWinners) * 100)}%)
            </span>
          </div>

          {/* Segmented Progress Bar */}
          <div className="w-full h-3 rounded-full bg-slate-800 overflow-hidden flex gap-0.5 p-0.5">
            {Array.from({ length: totalWinners }).map((_, idx) => (
              <div
                key={idx}
                className={`h-full flex-1 rounded-sm transition-all duration-300 ${
                  idx < completedWinners
                    ? 'bg-gradient-to-r from-amber-400 to-amber-500'
                    : idx === completedWinners && (isDrawing || isWaitingConfirmation)
                    ? 'bg-cyan-400 animate-pulse'
                    : 'bg-slate-700/50'
                }`}
              />
            ))}
          </div>

          <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-slate-800/80 text-xs text-slate-400">
            <span>Eligible Pool: <strong className="text-white">{state?.counts?.eligible ?? '...'}</strong></span>
            <span className="flex items-center gap-1">
              Status:
              <span className={`font-bold uppercase ${
                isDrawing
                  ? 'text-cyan-400'
                  : isWaitingConfirmation
                  ? 'text-amber-400'
                  : isCompleted
                  ? 'text-emerald-400'
                  : isPaused
                  ? 'text-rose-400'
                  : 'text-slate-300'
              }`}>
                {state?.status || 'READY'}
              </span>
            </span>
          </div>
        </div>

        {/* Error Notification */}
        {errorMessage && (
          <div className="p-3 rounded-2xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MaterialIcon name="warning" size={18} />
              <span>{errorMessage}</span>
            </div>
            <button onClick={() => setErrorMessage('')} className="text-rose-400 hover:text-white">
              <MaterialIcon name="close" size={16} />
            </button>
          </div>
        )}

        {/* Dynamic Interactive Stage Centerpiece */}
        {isCompleted ? (
          /* ALL WINNERS DRAWN CARD */
          <div className="p-6 rounded-3xl bg-gradient-to-b from-amber-500/20 to-slate-900 border border-amber-500/40 text-center shadow-2xl">
            <div className="w-16 h-16 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-3 shadow-inner">
              <MaterialIcon name="emoji_events" size={36} />
            </div>
            <h2 className="text-xl font-black font-display text-white">RAFFLE COMPLETED!</h2>
            <p className="text-xs text-slate-300 mt-1">
              All {totalWinners} official winners have been drawn and validated.
            </p>
            <a
              href="/results"
              className="mt-4 inline-flex items-center justify-center gap-2 w-full py-3 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm shadow-lg transition"
            >
              <MaterialIcon name="table_view" size={18} />
              View Official Results
            </a>
          </div>
        ) : isWaitingConfirmation && candidate ? (
          /* CANDIDATE AWAITING CONFIRMATION CARD */
          <div className="p-5 rounded-3xl bg-gradient-to-b from-amber-500/15 to-slate-900 border-2 border-amber-500/60 shadow-2xl space-y-4 animate-in fade-in">
            <div className="flex items-center justify-between">
              <span className="px-3 py-1 rounded-full text-xs font-black uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
                Winner #{nextSerial} Candidate
              </span>
              <span className="text-xs text-slate-400">Check Presence on Stage</span>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950/80 border border-amber-500/30 text-center">
              <div className="text-xs font-bold uppercase tracking-widest text-cyan-400">
                {candidate.type || 'PARTICIPANT'}
              </div>
              <h2 className="text-2xl font-black font-display text-white mt-1 break-words">
                {candidate.name}
              </h2>
              <div className="flex items-center justify-center gap-2 mt-2 text-xs text-slate-300">
                {candidate.id && (
                  <span className="px-2.5 py-1 rounded-lg bg-slate-800 font-mono font-bold text-amber-300 border border-slate-700">
                    Roll: {candidate.id}
                  </span>
                )}
                {candidate.designation && (
                  <span className="text-slate-400">{candidate.designation}</span>
                )}
              </div>
            </div>

            {/* Candidate Confirmation Decision Actions */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                id="mobile-confirm-btn"
                onClick={handleConfirmWinner}
                disabled={actionLoading}
                className="py-4 px-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 active:scale-[0.97] text-white font-extrabold text-sm shadow-xl shadow-emerald-600/30 flex flex-col items-center justify-center gap-1 transition disabled:opacity-50"
              >
                <MaterialIcon name="check_circle" size={26} />
                <span>CONFIRM WINNER</span>
              </button>

              <button
                id="mobile-ignore-btn"
                onClick={() => setShowIgnoreModal(true)}
                disabled={actionLoading}
                className="py-4 px-3 rounded-2xl bg-gradient-to-r from-amber-600/30 to-amber-700/30 hover:from-amber-600/40 hover:to-amber-700/40 active:scale-[0.97] text-amber-300 border border-amber-500/50 font-extrabold text-sm shadow-xl flex flex-col items-center justify-center gap-1 transition disabled:opacity-50"
              >
                <MaterialIcon name="person_off" size={26} />
                <span>IGNORE / ABSENT</span>
              </button>
            </div>
          </div>
        ) : (isDrawing || remoteStagePhase === 'COUNTDOWN' || remoteStagePhase === 'ROLLING') ? (
          /* SYNCHRONIZED STAGE PRESENTATION & COUNTDOWN */
          <div className="p-6 rounded-3xl bg-slate-900 border-2 border-cyan-400/50 text-center shadow-2xl space-y-4 relative overflow-hidden animate-in fade-in zoom-in duration-300">
            <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-cyan-500/20 text-cyan-300 border border-cyan-400/30">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
              DUET CSE FEST 2026 • WINNER #{nextSerial}
            </div>

            {remoteStagePhase === 'ROLLING' ? (
              <div className="py-6 flex flex-col items-center justify-center space-y-3">
                <div className="w-16 h-16 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center mx-auto shadow-inner animate-spin">
                  <MaterialIcon name="sync" size={36} />
                </div>
                <div className="text-lg font-black text-white font-display">
                  CYCLOTRON SHUFFLE ACTIVE
                </div>
                <p className="text-xs text-cyan-300 font-mono">
                  Finalizing cryptographic candidate selection...
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center relative my-1">
                {/* Shockwave ping on second change */}
                <div
                  key={`remote-shockwave-${remoteCountdown}`}
                  className="absolute w-40 h-40 rounded-full border-2 border-cyan-400/60 animate-ping opacity-35 pointer-events-none"
                />

                <div className="relative flex items-center justify-center w-40 h-40 my-1">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 200 200">
                    <defs>
                      <linearGradient id="remote-timer-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#06b6d4" />
                        <stop offset="50%" stopColor="#8b5cf6" />
                        <stop offset="100%" stopColor="#ec4899" />
                      </linearGradient>
                    </defs>

                    {/* Background Track */}
                    <circle
                      cx="100"
                      cy="100"
                      r="84"
                      className="stroke-slate-800"
                      strokeWidth="10"
                      fill="transparent"
                    />

                    {/* Animated Progress Arc */}
                    <circle
                      cx="100"
                      cy="100"
                      r="84"
                      stroke="url(#remote-timer-gradient)"
                      strokeWidth="11"
                      strokeDasharray={2 * Math.PI * 84}
                      strokeDashoffset={(2 * Math.PI * 84) * (1 - (remoteCountdownTotal > 0 ? remoteCountdown / remoteCountdownTotal : 1))}
                      strokeLinecap="round"
                      className="transition-all duration-1000 ease-out"
                      fill="transparent"
                    />
                  </svg>

                  {/* Exploding Countdown Number */}
                  <div className="absolute flex flex-col items-center justify-center select-none pointer-events-none">
                    <span
                      key={remoteCountdown}
                      className="text-6xl font-black font-display bg-gradient-to-b from-white via-cyan-100 to-cyan-400 bg-clip-text text-transparent drop-shadow-[0_0_30px_rgba(6,182,212,0.95)] animate-in zoom-in-50 duration-300 leading-none"
                    >
                      {remoteCountdown}
                    </span>
                    <span className="text-[10px] font-mono tracking-widest text-cyan-300/80 uppercase mt-1">
                      SECONDS
                    </span>
                  </div>
                </div>

                {/* Linear Progress Bar */}
                <div className="w-full max-w-xs h-2 bg-slate-800 rounded-full overflow-hidden mt-2 border border-slate-700/60 p-0.5">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-400 via-purple-500 to-pink-500 rounded-full transition-all duration-1000 ease-out shadow-[0_0_12px_#06b6d4]"
                    style={{ width: `${(remoteCountdown / (remoteCountdownTotal || 5)) * 100}%` }}
                  />
                </div>
              </div>
            )}

            <div>
              <span className="text-xs font-black uppercase tracking-widest text-cyan-400 flex items-center justify-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                COUNTDOWN IN PROGRESS
              </span>
              <p className="text-xs text-slate-400 mt-1">
                Synchronized with audience projector and controller console.
              </p>
            </div>
          </div>
        ) : (
          /* READY TO DRAW NEXT WINNER */
          <div className="p-6 rounded-3xl bg-slate-900/90 border border-slate-800 text-center shadow-xl space-y-5">
            <div>
              <span className="text-xs font-bold uppercase tracking-widest text-slate-400">
                Ready For Draw
              </span>
              <h2 className="text-3xl font-black font-display text-white mt-1">
                Winner #{nextSerial}
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Tap the button below to start theatrical projector countdown and candidate cyclotron.
              </p>
            </div>

            {/* Giant Primary Touch Action Button */}
            <button
              id="mobile-start-draw-btn"
              onClick={handleStartDraw}
              disabled={actionLoading || isDrawing || isWaitingConfirmation || isCompleted}
              className="w-full py-5 px-6 rounded-3xl bg-gradient-to-r from-amber-500 via-yellow-500 to-amber-600 hover:from-amber-400 hover:via-yellow-400 hover:to-amber-500 active:scale-[0.98] text-slate-950 font-black text-lg shadow-2xl shadow-amber-500/30 flex items-center justify-center gap-3 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <MaterialIcon name="play_arrow" size={32} />
              <span>START DRAW #{nextSerial}</span>
            </button>
          </div>
        )}

        {/* Secondary Quick Action Bar */}
        <div className="grid grid-cols-2 gap-2.5">
          <button
            id="mobile-toggle-pause-btn"
            onClick={handleTogglePause}
            disabled={actionLoading || isCompleted}
            className={`py-3 px-4 rounded-2xl border text-xs font-bold flex items-center justify-center gap-2 transition ${
              isPaused
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800'
            }`}
          >
            <MaterialIcon name={isPaused ? 'play_arrow' : 'pause'} size={18} />
            <span>{isPaused ? 'Resume Session' : 'Pause Draw'}</span>
          </button>

          <button
            id="mobile-view-winners-btn"
            onClick={() => {
              fetchWinners();
              setShowWinnersSheet(true);
            }}
            className="py-3 px-4 rounded-2xl bg-slate-900/80 text-slate-300 border border-slate-800 hover:bg-slate-800 text-xs font-bold flex items-center justify-center gap-2 transition"
          >
            <MaterialIcon name="military_tech" size={18} />
            <span>Winners ({completedWinners})</span>
          </button>
        </div>
      </main>

      {/* Bottom Footer Telemetry Info */}
      <footer className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
        <span>Audience: {state?.audience_connections ?? 1} Connected</span>
        <span>Fest Controller v2.6</span>
      </footer>

      {/* IGNORE CANDIDATE MODAL / BOTTOM SHEET */}
      {showIgnoreModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in">
          <div className="w-full sm:max-w-md bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-3xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-400">
                <MaterialIcon name="person_off" size={22} />
                <h3 className="text-base font-extrabold text-white">Ignore Candidate</h3>
              </div>
              <button
                onClick={() => setShowIgnoreModal(false)}
                className="p-1 rounded-xl text-slate-400 hover:text-white"
              >
                <MaterialIcon name="close" size={20} />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Candidate <strong className="text-white">{candidate?.name}</strong> will be skipped and returned to the draw queue with the chosen audit reason.
            </p>

            <div className="space-y-2">
              {[
                { id: 'absent', label: 'Absent / Not Present in Hall' },
                { id: 'left_early', label: 'Left Early Before Draw' },
                { id: 'ineligible', label: 'Ineligible / Disqualified' },
                { id: 'duplicate', label: 'Duplicate Entry' },
                { id: 'declined', label: 'Declined Acceptance' },
              ].map((r) => (
                <label
                  key={r.id}
                  onClick={() => setIgnoreReason(r.id)}
                  className={`flex items-center gap-3 p-3 rounded-xl border text-xs font-semibold cursor-pointer transition ${
                    ignoreReason === r.id
                      ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <input
                    type="radio"
                    name="ignoreReason"
                    value={r.id}
                    checked={ignoreReason === r.id}
                    onChange={() => setIgnoreReason(r.id)}
                    className="accent-amber-500"
                  />
                  <span>{r.label}</span>
                </label>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowIgnoreModal(false)}
                className="py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleIgnoreCandidate}
                disabled={actionLoading}
                className="py-3 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow-lg transition disabled:opacity-50"
              >
                Confirm Ignore
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRMED WINNERS BOTTOM SHEET */}
      {showWinnersSheet && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in">
          <div className="w-full sm:max-w-md bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-3xl p-6 space-y-4 shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2 text-amber-400">
                <MaterialIcon name="military_tech" size={22} />
                <h3 className="text-base font-extrabold text-white">Confirmed Winners</h3>
              </div>
              <button
                onClick={() => setShowWinnersSheet(false)}
                className="p-1 rounded-xl text-slate-400 hover:text-white"
              >
                <MaterialIcon name="close" size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {recentWinners.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">
                  No winners confirmed yet.
                </div>
              ) : (
                recentWinners.map((w) => (
                  <div
                    key={w.serial}
                    className="p-3 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-300 font-extrabold flex items-center justify-center text-xs">
                        #{w.serial}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white">{w.name}</div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          {w.id ? `Roll: ${w.id}` : w.type} • {w.designation || 'DUET CSE'}
                        </div>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      Confirmed
                    </span>
                  </div>
                ))
              )}
            </div>

            <button
              onClick={() => setShowWinnersSheet(false)}
              className="w-full py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
