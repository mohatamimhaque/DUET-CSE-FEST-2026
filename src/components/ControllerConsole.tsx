import React, { useState, useEffect, useCallback, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { MaterialIcon } from './MaterialIcon.tsx';
import { DuetFestIntro } from './DuetFestIntro.tsx';
import { soundEngine } from '../utils/audio.ts';
import { useWebSocket } from '../hooks/useWebSocket.ts';
import { useTheme } from '../hooks/useTheme.ts';
import { ControllerState, Participant, RegistrationRequest } from '../types.ts';
import { api, getStoredToken } from '../services/api.ts';

type ControllerStagePhase = 'IDLE' | 'STAGE_INTRO' | 'COUNTDOWN' | 'ROLLING' | 'CANDIDATE_REVEAL';

export const ControllerConsole: React.FC = () => {
  const { theme, toggleTheme, isDark } = useTheme();
  const { isConnected, lastMessage, isSupabaseRealtime } = useWebSocket('controller');

  // Auth State
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [usernameInput, setUsernameInput] = useState<string>('');
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [loginError, setLoginError] = useState<string>('');
  const [loginSubmitting, setLoginSubmitting] = useState<boolean>(false);

  // Mobile Remote State
  const [showRemoteModal, setShowRemoteModal] = useState<boolean>(false);
  const [copiedRemoteUrl, setCopiedRemoteUrl] = useState<boolean>(false);
  const [includeTokenInQr, setIncludeTokenInQr] = useState<boolean>(true);

  // Controller State
  const [state, setState] = useState<ControllerState | null>(null);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Synchronized Stage Presentation & Countdown State
  const [stagePhase, setStagePhase] = useState<ControllerStagePhase>('IDLE');
  const [countdownTotal, setCountdownTotal] = useState<number>(5);
  const [countdownNumber, setCountdownNumber] = useState<number>(5);
  const [rollingIndex, setRollingIndex] = useState<number>(0);
  const [stageSerial, setStageSerial] = useState<number>(1);
  const [revealedCandidate, setRevealedCandidate] = useState<Participant | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  const pendingCandidateRef = useRef<Participant | null>(null);
  const stageSequenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const countTimerRef = useRef<NodeJS.Timeout | null>(null);
  const rollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const activeAnimationLockRef = useRef<boolean>(false);
  const stagePhaseRef = useRef<ControllerStagePhase>('IDLE');
  stagePhaseRef.current = stagePhase;
  const stateRef = useRef<ControllerState | null>(null);
  stateRef.current = state;
  const soundEnabledRef = useRef<boolean>(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  // Modal States
  const [showIgnoreModal, setShowIgnoreModal] = useState<boolean>(false);
  const [ignoreReason, setIgnoreReason] = useState<string>('absent');

  const [showResetModal, setShowResetModal] = useState<boolean>(false);
  const [resetConfirmationText, setResetConfirmationText] = useState<string>('');
  const [resetError, setResetError] = useState<string>('');

  // Page Access Control State
  const [pageAccess, setPageAccess] = useState<{
    audience: boolean;
    participants: boolean;
    health: boolean;
    results: boolean;
    self_registration: boolean;
    restriction_message: string;
  }>({
    audience: true,
    participants: true,
    health: true,
    results: true,
    self_registration: true,
    restriction_message: 'This page is temporarily restricted by the event administrator. Please stay tuned.',
  });
  const [savingAccess, setSavingAccess] = useState<boolean>(false);

  // Registration Review & Verification Center State
  const [showVerifyModal, setShowVerifyModal] = useState<boolean>(false);
  const [registrations, setRegistrations] = useState<RegistrationRequest[]>([]);
  const [regFilterStatus, setRegFilterStatus] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [regFilterType, setRegFilterType] = useState<string>('all');
  const [regSearchQuery, setRegSearchQuery] = useState<string>('');
  const [loadingRegistrations, setLoadingRegistrations] = useState<boolean>(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [batchReviewing, setBatchReviewing] = useState<boolean>(false);
  const [verifyingParticipantKey, setVerifyingParticipantKey] = useState<string | null>(null);

  // Participant Import State
  const [importJsonText, setImportJsonText] = useState<string>('');
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [showImportModal, setShowImportModal] = useState<boolean>(false);

  // Participant Search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchType, setSearchType] = useState<string>('all');
  const [searchStatus, setSearchStatus] = useState<string>('all');
  const [participantsList, setParticipantsList] = useState<(Participant & { status: string })[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  const fetchPageAccess = async () => {
    try {
      const res = await api.getPageAccessStatus('');
      if (res.settings) {
        setPageAccess(res.settings);
      }
    } catch {
      // Ignored
    }
  };

  const fetchRegistrations = async () => {
    setLoadingRegistrations(true);
    try {
      const res = await api.getRegistrations();
      if (res.requests) {
        setRegistrations(res.requests);
      }
    } catch {
      // Ignored
    } finally {
      setLoadingRegistrations(false);
    }
  };

  const handleReviewRegistration = async (id: string, action: 'approve' | 'reject', notes?: string) => {
    setReviewingId(id);
    try {
      const res = await api.reviewRegistration(id, action, notes);
      showToast(res.message, 'success');
      await fetchRegistrations();
      await fetchState();
      fetchParticipants();
    } catch (err: any) {
      showToast(err.message || `Failed to ${action} registration`, 'error');
    } finally {
      setReviewingId(null);
    }
  };

  const handleBatchReview = async (action: 'approve' | 'reject') => {
    setBatchReviewing(true);
    try {
      const res = await api.batchReviewRegistrations(action);
      showToast(res.message, 'success');
      await fetchRegistrations();
      await fetchState();
      fetchParticipants();
    } catch (err: any) {
      showToast(err.message || `Failed to batch ${action} registrations`, 'error');
    } finally {
      setBatchReviewing(false);
    }
  };

  const handleVerifyParticipantEligibility = async (
    p: Participant & { status: string },
    newEligible: number
  ) => {
    const key = `${p.name}_${p.id || ''}`;
    setVerifyingParticipantKey(key);
    try {
      const res = await api.verifyParticipantEligibility(p.id, p.name, p.type, newEligible);
      showToast(res.message, 'success');
      await fetchState();
      fetchParticipants();
    } catch (err: any) {
      showToast(err.message || 'Failed to update participant verification status', 'error');
    } finally {
      setVerifyingParticipantKey(null);
    }
  };

  const handleTogglePageAccess = async (pageKey: 'audience' | 'participants' | 'health' | 'results' | 'self_registration') => {
    const updated = {
      ...pageAccess,
      [pageKey]: !pageAccess[pageKey],
    };
    setSavingAccess(true);
    try {
      const res = await api.updatePageAccess(updated);
      setPageAccess(res.settings);
      if (pageKey === 'self_registration') {
        const isOpen = !pageAccess.self_registration;
        showToast(
          `Participant self-registration is now ${isOpen ? 'OPEN' : 'CLOSED'} on /participants.`,
          isOpen ? 'success' : 'info'
        );
      } else {
        showToast(`${pageKey.toUpperCase()} access updated. Visitors on restricted pages will see banner.jpg.`, 'success');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSavingAccess(false);
    }
  };

  const handleSaveRestrictionMessage = async () => {
    setSavingAccess(true);
    try {
      const res = await api.updatePageAccess(pageAccess);
      setPageAccess(res.settings);
      showToast('Restriction announcement message saved.', 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSavingAccess(false);
    }
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importJsonText.trim()) return;
    setIsImporting(true);
    try {
      let parsed: any[];
      try {
        parsed = JSON.parse(importJsonText);
        if (!Array.isArray(parsed)) {
          throw new Error('Import data must be a JSON array of participants');
        }
      } catch (parseErr: any) {
        // Fallback simple CSV parsing: Name, ID, Category, Designation
        const lines = importJsonText.trim().split('\n');
        if (lines.length > 0) {
          parsed = lines.map((line) => {
            const parts = line.split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
            return {
              name: parts[0] || 'Unknown',
              external_id: parts[1] || undefined,
              type: parts[2] || 'student',
              designation: parts[3] || undefined,
            };
          });
        } else {
          throw new Error('Invalid format: ' + parseErr.message);
        }
      }

      const res = await api.importParticipants(parsed);
      showToast(`Successfully imported ${res.inserted} participants to Supabase.`, 'success');
      setShowImportModal(false);
      setImportJsonText('');
      await fetchState();
      await fetchParticipants();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setIsImporting(false);
    }
  };

  const checkAuth = useCallback(async () => {
    setAuthLoading(true);
    try {
      const res = await api.checkAuth();
      setIsAuthenticated(res.authenticated);
      if (res.authenticated) {
        fetchState();
        fetchPageAccess();
        fetchRegistrations();
      }
    } catch {
      setIsAuthenticated(false);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const clearStageTimers = useCallback(() => {
    if (stageSequenceTimeoutRef.current) {
      clearTimeout(stageSequenceTimeoutRef.current);
      stageSequenceTimeoutRef.current = null;
    }
    if (countTimerRef.current) {
      clearInterval(countTimerRef.current);
      countTimerRef.current = null;
    }
    if (rollingIntervalRef.current) {
      clearInterval(rollingIntervalRef.current);
      rollingIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      activeAnimationLockRef.current = false;
      clearStageTimers();
    };
  }, [clearStageTimers]);

  const participantsListRef = useRef(participantsList);
  participantsListRef.current = participantsList;

  const fetchStateRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const startStageCountdownRef = useRef<(payload: any) => void>(() => {});

  const startStageCountdown = useCallback(
    (payload: any) => {
      // Guard against duplicate start / mid-sequence restart from websocket or polling
      if (activeAnimationLockRef.current || stagePhaseRef.current !== 'IDLE') return;
      activeAnimationLockRef.current = true;
      clearStageTimers();

      const candidate = payload?.candidate;
      pendingCandidateRef.current = candidate;
      const serial = payload?.serial || stateRef.current?.next_serial || 1;
      const cdSeconds = payload?.countdown_seconds ?? 5;

      setStageSerial(serial);
      setCountdownTotal(cdSeconds);
      setCountdownNumber(cdSeconds);

      // Immediately show countdown timer (time) with beep sound
      setStagePhase('COUNTDOWN');
      if (soundEnabledRef.current) {
        try {
          soundEngine.playCountdownBeep(cdSeconds);
        } catch {
          // Audio fallback
        }
      }

      let currentSec = cdSeconds;
      countTimerRef.current = setInterval(() => {
        currentSec -= 1;
        if (currentSec > 0) {
          setCountdownNumber(currentSec);
          if (soundEnabledRef.current) {
            try {
              soundEngine.playCountdownBeep(currentSec);
            } catch {
              // Audio fallback
            }
          }
        } else {
          if (countTimerRef.current) {
            clearInterval(countTimerRef.current);
            countTimerRef.current = null;
          }

          // PHASE: CYCLOTRON ROLLING SIMULATION
          setStagePhase('ROLLING');
          let rIdx = 0;
          const fallbackRollingItem = candidate
            ? { name: candidate.name, id: candidate.id ? `Roll: ${candidate.id}` : 'DUET CSE', type: candidate.type || 'STUDENT' }
            : { name: 'Selecting candidate...', id: 'DUET CSE FEST 2026', type: 'DRAW' };
          const activePool = participantsListRef.current.length > 0 ? participantsListRef.current : [fallbackRollingItem];
          const poolLength = Math.max(1, activePool.length);

          rollingIntervalRef.current = setInterval(() => {
            rIdx = (rIdx + 1) % poolLength;
            setRollingIndex(rIdx);
            if (soundEnabledRef.current) {
              try {
                soundEngine.playTickSound();
              } catch {
                // Audio fallback
              }
            }
          }, 60);

          // Roll for 2.2 seconds then reveal candidate
          stageSequenceTimeoutRef.current = setTimeout(() => {
            if (rollingIntervalRef.current) {
              clearInterval(rollingIntervalRef.current);
              rollingIntervalRef.current = null;
            }
            activeAnimationLockRef.current = false;

            // CANDIDATE REVEAL
            const finalCandidate = pendingCandidateRef.current || candidate;
            setRevealedCandidate(finalCandidate);
            setStagePhase('CANDIDATE_REVEAL');
            if (soundEnabledRef.current) {
              try {
                soundEngine.playCandidateSelectSound();
              } catch {
                // Audio fallback
              }
            }
            fetchStateRef.current();
          }, 2200);
        }
      }, 1000);
    },
    [clearStageTimers]
  );
  startStageCountdownRef.current = startStageCountdown;

  const fetchState = useCallback(async () => {
    try {
      const data = await api.getControllerState();
      setState(data);
      if (data.status === 'DRAWING' && stagePhaseRef.current === 'IDLE' && !activeAnimationLockRef.current) {
        startStageCountdownRef.current({
          serial: data.next_serial,
          countdown_seconds: 5,
          candidate: data.current_candidate,
        });
      }
    } catch (err: any) {
      if (err.message === 'AUTH_REQUIRED') {
        setIsAuthenticated(false);
      }
    }
  }, []);
  fetchStateRef.current = fetchState;

  const fetchParticipants = useCallback(async () => {
    if (!isAuthenticated) return;
    setIsSearching(true);
    try {
      const res = await api.searchParticipants(searchQuery, searchType, searchStatus);
      setParticipantsList(res.participants);
    } catch {
      // Ignored
    } finally {
      setIsSearching(false);
    }
  }, [isAuthenticated, searchQuery, searchType, searchStatus]);

  const silentRefreshParticipants = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const res = await api.searchParticipants(searchQuery, searchType, searchStatus);
      setParticipantsList(res.participants);
    } catch {
      // Silent catch
    }
  }, [isAuthenticated, searchQuery, searchType, searchStatus]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchParticipants();
    }
  }, [isAuthenticated, fetchParticipants]);

  const handledControllerMsgSigRef = useRef<string>('');
  const silentRefreshRef = useRef(silentRefreshParticipants);
  silentRefreshRef.current = silentRefreshParticipants;

  // Handle WebSocket updates without full re-render
  useEffect(() => {
    if (!lastMessage) return;
    const sig = (lastMessage as any).id || `${lastMessage.type}_${lastMessage.timestamp}_${JSON.stringify(lastMessage.payload || '')}`;
    if (handledControllerMsgSigRef.current === sig) {
      return;
    }
    handledControllerMsgSigRef.current = sig;

    if (lastMessage.type === 'DRAW_START') {
      if (!activeAnimationLockRef.current && stagePhaseRef.current === 'IDLE') {
        startStageCountdownRef.current(lastMessage.payload);
      }
    } else if (lastMessage.type === 'STATE_UPDATED') {
      setState(lastMessage.payload);
      if (lastMessage.payload?.status === 'DRAWING' && stagePhaseRef.current === 'IDLE' && !activeAnimationLockRef.current) {
        startStageCountdownRef.current({
          serial: lastMessage.payload.next_serial,
          countdown_seconds: 5,
          candidate: lastMessage.payload.current_candidate,
        });
      } else if (lastMessage.payload?.status !== 'DRAWING' && stagePhaseRef.current === 'CANDIDATE_REVEAL') {
        setRevealedCandidate(lastMessage.payload.current_candidate);
      }
    } else if (
      lastMessage.type === 'WINNER_CONFIRMED' ||
      lastMessage.type === 'CANDIDATE_IGNORED' ||
      lastMessage.type === 'SESSION_RESET' ||
      lastMessage.type === 'RESET'
    ) {
      clearStageTimers();
      setStagePhase('IDLE');
      setRevealedCandidate(null);
      silentRefreshRef.current();
    }
  }, [lastMessage, startStageCountdown, clearStageTimers]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginSubmitting(true);
    try {
      await api.login(usernameInput, passwordInput);
      setIsAuthenticated(true);
      fetchState();
      fetchParticipants();
    } catch (err: any) {
      setLoginError(err.message || 'Login failed');
    } finally {
      setLoginSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await api.logout();
    setIsAuthenticated(false);
  };

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setActionMessage({ text, type });
    setTimeout(() => setActionMessage(null), 4000);
  };

  const getRemoteUrl = useCallback(() => {
    if (typeof window === 'undefined') return '/remote';
    const origin = window.location.origin;
    const token = getStoredToken();
    if (includeTokenInQr && token) {
      return `${origin}/remote?token=${encodeURIComponent(token)}`;
    }
    return `${origin}/remote`;
  }, [includeTokenInQr]);

  const handleCopyRemoteUrl = () => {
    const url = getRemoteUrl();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        setCopiedRemoteUrl(true);
        setTimeout(() => setCopiedRemoteUrl(false), 2500);
      });
    }
  };

  const handleStartDraw = async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    soundEngine.unlock();
    setActionLoading(true);
    try {
      const res = await api.startDraw();
      showToast(res.message, 'success');
      setState((prev) =>
        prev
          ? {
              ...prev,
              status: 'DRAWING',
              current_candidate: res.candidate || prev.current_candidate,
            }
          : prev
      );
      if (res.candidate) {
        startStageCountdown({
          serial: res.serial || (state?.next_serial ?? 1),
          countdown_seconds: res.countdown_seconds || 5,
          candidate: res.candidate,
        });
      }
      await fetchState();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmWinner = async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    clearStageTimers();
    setStagePhase('IDLE');
    setRevealedCandidate(null);
    setActionLoading(true);
    try {
      const res = await api.confirmWinner();
      showToast(res.message, 'success');
      setState((prev) =>
        prev
          ? {
              ...prev,
              current_candidate: null,
              completed_winners: prev.completed_winners + 1,
              next_serial: prev.next_serial + 1,
              status: prev.completed_winners + 1 >= prev.total_winners ? 'COMPLETED' : 'WINNER_CONFIRMED',
            }
          : prev
      );
      await fetchState();
      silentRefreshParticipants();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleIgnoreCandidate = async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    clearStageTimers();
    setStagePhase('IDLE');
    setRevealedCandidate(null);
    setActionLoading(true);
    try {
      const res = await api.ignoreCandidate(ignoreReason);
      showToast(res.message, 'info');
      setShowIgnoreModal(false);
      setState((prev) =>
        prev
          ? {
              ...prev,
              current_candidate: null,
              ignored_count: prev.ignored_count + 1,
              status: 'IGNORED',
            }
          : prev
      );
      await fetchState();
      silentRefreshParticipants();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleTogglePause = async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setActionLoading(true);
    try {
      if (state?.status === 'PAUSED') {
        const res = await api.resume();
        showToast(res.message, 'success');
      } else {
        const res = await api.pause();
        showToast(res.message, 'info');
      }
      await fetchState();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestoreInterrupted = async () => {
    setActionLoading(true);
    try {
      const res = await api.restoreInterrupted();
      showToast(res.message, 'success');
      await fetchState();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelInterrupted = async () => {
    setActionLoading(true);
    try {
      const res = await api.cancelInterrupted();
      showToast(res.message, 'info');
      await fetchState();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetSession = async () => {
    if (resetConfirmationText !== 'RESET') {
      setResetError('Please type "RESET" exactly to confirm.');
      return;
    }
    setActionLoading(true);
    setResetError('');
    try {
      const res = await api.resetSession(resetConfirmationText);
      showToast(res.message, 'success');
      setShowResetModal(false);
      setResetConfirmationText('');
      await fetchState();
      fetchParticipants();
    } catch (err: any) {
      setResetError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // 1. Loading State
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-slate-300">
        <div className="flex flex-col items-center gap-3">
          <MaterialIcon name="refresh" className="animate-spin text-3xl text-purple-400" />
          <p className="text-sm font-medium">Verifying controller authorization...</p>
        </div>
      </div>
    );
  }

  // 2. Authentication Screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="glass-panel w-full max-w-md p-8 md:p-10 rounded-3xl border border-purple-500/20 shadow-2xl relative">
          <div className="flex flex-col items-center text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-purple-600/20 border border-purple-400/40 flex items-center justify-center mb-4 text-purple-400 shadow-[0_0_20px_rgba(168,85,247,0.3)]">
              <MaterialIcon name="admin_panel_settings" size={32} />
            </div>
            <h2 className="text-2xl font-bold font-display text-white">Event Controller Login</h2>
            <p className="text-sm text-slate-400 mt-1">DUET CSE Fest 2026 Live Raffle Console</p>
          </div>

          {loginError && (
            <div className="mb-6 p-3.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs md:text-sm flex items-center gap-2">
              <MaterialIcon name="error" size={18} className="text-rose-400" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Controller Username
              </label>
              <input
                id="controller-username-input"
                type="text"
                required
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                placeholder="Controller Username"
                className="w-full px-4 py-3 rounded-xl bg-slate-900/60 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500 text-sm transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Controller Password
              </label>
              <input
                id="controller-password-input"
                type="password"
                required
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Enter password"
                className="w-full px-4 py-3 rounded-xl bg-slate-900/60 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500 text-sm transition"
              />
            </div>

            <button
              id="controller-login-submit"
              type="submit"
              disabled={loginSubmitting}
              className="w-full py-3.5 mt-2 rounded-xl font-bold text-sm tracking-wide bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg hover:shadow-purple-500/30 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loginSubmitting ? (
                <>
                  <MaterialIcon name="refresh" className="animate-spin text-lg" />
                  Authenticating...
                </>
              ) : (
                <>
                  <MaterialIcon name="lock_open" size={18} />
                  Authorize & Access Console
                </>
              )}
            </button>
          </form>

          <div className="mt-8 text-center text-xs text-slate-500">
            Protected live event console. All mutations are cryptographically validated and logged to audit.
          </div>
        </div>
      </div>
    );
  }

  // 3. Controller Operational Console
  return (
    <div id="controller-console-root" className="min-h-screen w-full p-4 md:p-8 lg:p-10 max-w-7xl mx-auto space-y-6">
      {/* Toast Notification */}
      {actionMessage && (
        <div
          className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-2xl glass-panel text-sm font-semibold shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top duration-300 ${
            actionMessage.type === 'success'
              ? 'border-emerald-500/40 text-emerald-300'
              : actionMessage.type === 'error'
              ? 'border-rose-500/40 text-rose-300'
              : 'border-cyan-500/40 text-cyan-300'
          }`}
        >
          <MaterialIcon
            name={actionMessage.type === 'success' ? 'check_circle' : actionMessage.type === 'error' ? 'error' : 'info'}
            size={20}
          />
          <span>{actionMessage.text}</span>
        </div>
      )}

      {/* Top Console Navigation Bar */}
      <header className="glass-panel p-5 rounded-3xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-pink-600 flex items-center justify-center text-white shadow-md">
            <MaterialIcon name="admin_panel_settings" size={26} />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-black font-display text-white">Event Controller Console</h1>
            <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
              <span>DUET CSE Fest 2026 •</span>
              <span className={`inline-flex items-center gap-1 font-mono text-[11px] ${
                isSupabaseRealtime ? 'text-emerald-400' : isConnected ? 'text-cyan-400' : 'text-amber-400'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                {isSupabaseRealtime ? 'Supabase Realtime WebSocket' : isConnected ? 'Synchronized' : 'Reconnecting...'}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            id="btn-open-verify-modal"
            onClick={() => {
              fetchRegistrations();
              setShowVerifyModal(true);
            }}
            className="px-3.5 py-2 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/40 text-xs font-bold flex items-center gap-1.5 shadow-sm transition relative"
            title="Review and verify participant self-registration requests"
          >
            <MaterialIcon name="how_to_reg" size={16} />
            <span>Verification Queue</span>
            {registrations.filter((r) => r.status === 'pending').length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-pink-500 text-white animate-pulse">
                {registrations.filter((r) => r.status === 'pending').length}
              </span>
            )}
          </button>

          <button
            id="btn-open-remote-modal"
            onClick={() => setShowRemoteModal(true)}
            className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-500/20 to-indigo-500/20 hover:from-cyan-500/30 hover:to-indigo-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-bold flex items-center gap-1.5 shadow-sm transition"
            title="Scan QR to open Mobile Remote"
          >
            <MaterialIcon name="qr_code_2" size={16} />
            Mobile Remote
          </button>

          <a
            id="link-to-excel-seeder"
            href="/controller/seed"
            className="px-3.5 py-2 rounded-xl glass-pill text-xs font-semibold text-cyan-300 hover:text-white border border-cyan-500/30 flex items-center gap-1.5 transition"
          >
            <MaterialIcon name="table_chart" size={16} />
            Excel Seeder
          </a>

          <a
            id="link-to-results"
            href="/results"
            className="px-3.5 py-2 rounded-xl glass-pill text-xs font-semibold text-slate-200 hover:text-white flex items-center gap-1.5 transition"
          >
            <MaterialIcon name="table_view" size={16} />
            Official Results
          </a>

          <a
            id="link-to-health"
            href="/health"
            className="px-3.5 py-2 rounded-xl glass-pill text-xs font-semibold text-slate-200 hover:text-white flex items-center gap-1.5 transition"
          >
            <MaterialIcon name="monitor_heart" size={16} />
            Health
          </a>

          <button
            id="controller-theme-toggle"
            onClick={toggleTheme}
            className="p-2 rounded-xl glass-pill text-slate-300 hover:text-white transition"
            title="Toggle theme"
          >
            <MaterialIcon name={isDark ? 'light_mode' : 'dark_mode'} size={18} />
          </button>

          <button
            id="controller-logout-button"
            onClick={handleLogout}
            className="px-3.5 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-xs font-semibold flex items-center gap-1.5 transition"
          >
            <MaterialIcon name="logout" size={16} />
            Logout
          </button>
        </div>
      </header>

      {/* A: Previous Session Detection Banner (Section 24) */}
      {state && state.completed_winners > 0 && state.status !== 'COMPLETED' && (
        <div className="glass-panel p-5 rounded-3xl border border-amber-500/30 bg-amber-500/10 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <MaterialIcon name="history" size={24} />
            </div>
            <div>
              <h3 className="text-sm md:text-base font-bold text-amber-300">Active Raffle Session In Progress</h3>
              <p className="text-xs text-slate-300">
                Progress: <strong className="text-white">{state.completed_winners} / {state.total_winners}</strong> winners confirmed. Last action: {state.last_action}.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowResetModal(true)}
              className="px-4 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 text-xs font-bold transition"
            >
              Start New Session...
            </button>
          </div>
        </div>
      )}

      {/* B: Interrupted Draw Detection Alert (Section 26) */}
      {state?.has_interrupted && state.current_candidate && (
        <div className="glass-panel p-6 rounded-3xl border border-rose-500/40 bg-rose-500/15 flex flex-col md:flex-row items-center justify-between gap-4 animate-pulse">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/30 text-rose-300 flex items-center justify-center">
              <MaterialIcon name="warning" size={28} />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-white">INTERRUPTED DRAW DETECTED</h3>
              <p className="text-xs text-rose-200">
                Server restarted while candidate <strong>{state.current_candidate.name}</strong> was awaiting confirmation.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 w-full md:w-auto">
            <button
              onClick={handleRestoreInterrupted}
              disabled={actionLoading}
              className="flex-1 md:flex-none px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg transition"
            >
              Restore Candidate
            </button>
            <button
              onClick={handleCancelInterrupted}
              disabled={actionLoading}
              className="flex-1 md:flex-none px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 font-semibold text-xs transition"
            >
              Cancel Draw
            </button>
          </div>
        </div>
      )}

      {/* Stats Metric Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
        <div className="glass-panel p-4 rounded-2xl">
          <span className="text-xs text-slate-400 font-medium">Session Status</span>
          <div className="text-base md:text-lg font-black font-display text-pink-400 mt-1 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-pink-400 animate-ping" />
            {state?.status || 'READY'}
          </div>
        </div>

        <div className="glass-panel p-4 rounded-2xl">
          <span className="text-xs text-slate-400 font-medium">Completed Winners</span>
          <div className="text-xl md:text-2xl font-black font-display text-white mt-1">
            {state?.completed_winners ?? 0} <span className="text-xs text-slate-400 font-normal">/ {state?.total_winners ?? 10}</span>
          </div>
        </div>

        <div className="glass-panel p-4 rounded-2xl">
          <span className="text-xs text-slate-400 font-medium">Eligible Pool</span>
          <div className="text-xl md:text-2xl font-black font-display text-cyan-300 mt-1">
            {state?.eligible_count ?? 0}
          </div>
        </div>

        <div className="glass-panel p-4 rounded-2xl">
          <span className="text-xs text-slate-400 font-medium">Total Pool</span>
          <div className="text-xl md:text-2xl font-black font-display text-slate-200 mt-1">
            {state?.total_participants ?? 0}
          </div>
        </div>

        <div className="glass-panel p-4 rounded-2xl">
          <span className="text-xs text-slate-400 font-medium">Ignored Candidates</span>
          <div className="text-xl md:text-2xl font-black font-display text-amber-400 mt-1">
            {state?.ignored_count ?? 0}
          </div>
        </div>

        <div className="glass-panel p-4 rounded-2xl">
          <span className="text-xs text-slate-400 font-medium">Next Serial</span>
          <div className="text-xl md:text-2xl font-black font-display text-purple-300 mt-1">
            #{state?.next_serial ?? 1}
          </div>
        </div>
      </div>

      {/* Main Draw Action & Decision Console */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Primary Draw Actions */}
        <div className="lg:col-span-7 glass-panel p-6 md:p-7 rounded-3xl flex flex-col space-y-5 self-start">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold font-display text-white flex items-center gap-2">
                <MaterialIcon name="play_circle" className="text-pink-400" />
                Live Draw Operations
              </h2>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.unlock();
                    setSoundEnabled(!soundEnabled);
                  }}
                  title={soundEnabled ? 'Mute Countdown Sound' : 'Unmute Countdown Sound'}
                  className="p-1.5 px-2.5 rounded-xl glass-pill text-slate-300 hover:text-white transition flex items-center gap-1.5 text-xs font-mono"
                >
                  <MaterialIcon name={soundEnabled ? 'volume_up' : 'volume_off'} size={16} className={soundEnabled ? 'text-cyan-400' : 'text-slate-500'} />
                  <span className="hidden sm:inline">{soundEnabled ? 'SOUND ON' : 'MUTED'}</span>
                </button>

                <span className="text-xs px-3 py-1 rounded-full font-bold uppercase tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  Lock: {state?.is_locked ? 'ACTIVE' : 'IDLE'}
                </span>
              </div>
            </div>

            {/* Candidate Card / Stage Presentation / Draw Countdown States */}
            {stagePhase === 'STAGE_INTRO' ? (
              <div className="w-full flex flex-col items-center justify-center animate-in fade-in zoom-in-95 duration-300 my-2">
                <DuetFestIntro size="compact" phaseText={`DUET CSE FEST 2026 • PRIZE #${stageSerial}`} />
              </div>
            ) : stagePhase === 'COUNTDOWN' ? (
              <div className="glass-capsule p-6 md:p-8 rounded-2xl border-2 border-cyan-400/50 text-center relative overflow-hidden animate-in fade-in zoom-in duration-300 shadow-[0_0_50px_rgba(6,182,212,0.25)]">
                {/* Header Pill */}
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-cyan-500/20 text-cyan-300 border border-cyan-400/30 mb-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                  DUET CSE FEST 2026 • PRIZE #{stageSerial}
                </div>

                {/* Glowing SVG Countdown Gauge */}
                <div className="flex flex-col items-center justify-center relative my-2">
                  {/* Shockwave ping on second change */}
                  <div
                    key={`controller-shockwave-${countdownNumber}`}
                    className="absolute w-44 h-44 md:w-52 md:h-52 rounded-full border-2 border-cyan-400/60 animate-ping opacity-35 pointer-events-none"
                  />

                  <div className="relative flex items-center justify-center w-44 h-44 md:w-52 md:h-52 my-1">
                    <svg className="w-full h-full -rotate-90" viewBox="0 0 200 200">
                      <defs>
                        <linearGradient id="controller-timer-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#06b6d4" />
                          <stop offset="50%" stopColor="#8b5cf6" />
                          <stop offset="100%" stopColor="#ec4899" />
                        </linearGradient>
                        <filter id="controller-timer-glow" x="-20%" y="-20%" width="140%" height="140%">
                          <feGaussianBlur stdDeviation="4" result="blur" />
                          <feComposite in="SourceGraphic" in2="blur" operator="over" />
                        </filter>
                      </defs>

                      {/* Background Track */}
                      <circle
                        cx="100"
                        cy="100"
                        r="84"
                        className="stroke-slate-700/30"
                        strokeWidth="10"
                        fill="transparent"
                      />

                      {/* Notched Dial Ring */}
                      <circle
                        cx="100"
                        cy="100"
                        r="72"
                        stroke="rgba(56, 189, 248, 0.2)"
                        strokeWidth="2"
                        strokeDasharray="3 7"
                        fill="transparent"
                      />

                      {/* Animated Progress Arc */}
                      <circle
                        cx="100"
                        cy="100"
                        r="84"
                        stroke="url(#controller-timer-gradient)"
                        strokeWidth="11"
                        strokeDasharray={2 * Math.PI * 84}
                        strokeDashoffset={(2 * Math.PI * 84) * (1 - (countdownTotal > 0 ? countdownNumber / countdownTotal : 1))}
                        strokeLinecap="round"
                        filter="url(#controller-timer-glow)"
                        className="transition-all duration-1000 ease-out"
                        fill="transparent"
                      />
                    </svg>

                    {/* Concentric Rotating Orbital Lines */}
                    <div className="absolute inset-3 rounded-full border border-dashed border-cyan-400/35 orbital-ring-1 pointer-events-none" />
                    <div className="absolute inset-6 rounded-full border border-purple-400/35 orbital-ring-2 pointer-events-none" />

                    {/* Center Exploding Countdown Number */}
                    <div className="absolute flex flex-col items-center justify-center select-none pointer-events-none">
                      <span
                        key={countdownNumber}
                        className="text-7xl md:text-8xl font-black font-display bg-gradient-to-b from-white via-cyan-100 to-cyan-400 bg-clip-text text-transparent drop-shadow-[0_0_40px_rgba(6,182,212,0.95)] animate-in zoom-in-50 duration-300 leading-none"
                      >
                        {countdownNumber}
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
                      style={{ width: `${(countdownNumber / (countdownTotal || 5)) * 100}%` }}
                    />
                  </div>

                  <div className="mt-3 flex flex-col items-center gap-1">
                    <span className="text-xs font-mono tracking-widest text-cyan-200 uppercase font-bold flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                      STAGE COUNTDOWN IN PROGRESS
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      Synchronized with Audience Projector Display
                    </span>
                  </div>
                </div>
              </div>
            ) : stagePhase === 'ROLLING' ? (
              <div className="glass-capsule p-6 md:p-8 rounded-2xl border-2 border-cyan-400/50 text-center relative overflow-hidden animate-in fade-in duration-200 shadow-[0_0_40px_rgba(6,182,212,0.2)]">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold tracking-wider text-cyan-300 bg-cyan-500/15 border border-cyan-400/30 mb-4">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                  PRIZE #{stageSerial} • ROLLING POOL
                </div>

                {(() => {
                  const fallbackItem = {
                    name: pendingCandidateRef.current?.name || 'DUET CSE FEST 2026',
                    id: pendingCandidateRef.current?.id ? `Roll: ${pendingCandidateRef.current.id}` : 'CSE Department',
                    type: pendingCandidateRef.current?.type || 'STUDENT',
                  };
                  const activePool = participantsList.length > 0 ? participantsList : [fallbackItem];
                  const currentRolling = activePool[rollingIndex % activePool.length] || activePool[0];

                  return (
                    <div className="flex flex-col items-center justify-center">
                      <div className="glass-panel w-full max-w-md p-6 rounded-2xl border border-cyan-400/50 shadow-xl relative overflow-hidden">
                        <div className="text-xs text-cyan-300 tracking-widest font-semibold uppercase mb-1.5">
                          {currentRolling.type || 'PARTICIPANT'}
                        </div>
                        <h3 className="text-2xl md:text-3xl font-extrabold text-white font-display tracking-tight">
                          {currentRolling.name}
                        </h3>
                        <p className="text-sm font-mono text-cyan-300 mt-1">
                          {currentRolling.id ? `Roll: ${currentRolling.id}` : (currentRolling as any).designation || 'DUET CSE'}
                        </p>
                      </div>
                      <div className="mt-4 flex items-center justify-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                        <span className="text-xs font-mono text-cyan-300 uppercase">Cryptographic Selection Finalizing...</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (revealedCandidate || state?.current_candidate) ? (
              (() => {
                const activeCandidate = revealedCandidate || state?.current_candidate;
                if (!activeCandidate) return null;
                return (
                  <div className="glass-capsule p-6 md:p-7 rounded-2xl border-2 border-pink-500/50 text-center relative overflow-hidden animate-in fade-in zoom-in-95 duration-300 shadow-[0_0_35px_rgba(236,72,153,0.2)]">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                      <span className="text-xs font-extrabold uppercase tracking-widest text-pink-400 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-pink-400 animate-pulse" />
                        SELECTED CANDIDATE • WINNER #{state?.next_serial ?? stageSerial}
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                        {activeCandidate.type}
                      </span>
                    </div>

                    <div className="py-2">
                      <h3 className="text-2xl md:text-4xl font-extrabold text-white font-display tracking-tight">
                        {activeCandidate.name}
                      </h3>

                      <p className="text-base md:text-lg font-mono text-cyan-300 font-semibold mt-1.5">
                        {activeCandidate.id
                          ? `Roll: ${activeCandidate.id}`
                          : activeCandidate.designation || 'DUET CSE'}
                      </p>
                    </div>

                    {/* Cryptographic Selection & Stage Sync Info Bar */}
                    <div className="mt-3 py-2 px-3.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs font-mono text-slate-300 flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-emerald-300">
                        <MaterialIcon name="verified" size={15} className="text-emerald-400" />
                        Zero-Modulo Bias Selected
                      </span>
                      <span className="text-[11px] text-cyan-400 font-sans font-medium flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                        Awaiting Controller Confirmation
                      </span>
                    </div>

                    {/* Controller Authority Decision Buttons */}
                    <div className="mt-5 flex flex-col sm:flex-row items-center justify-center gap-3">
                      <button
                        id="controller-confirm-winner-btn"
                        type="button"
                        onClick={handleConfirmWinner}
                        disabled={actionLoading}
                        className="w-full sm:w-auto flex-1 px-6 py-3.5 rounded-xl font-black text-sm tracking-wide bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 shadow-[0_0_25px_rgba(16,185,129,0.4)] transition hover:scale-[1.02] active:scale-98 flex items-center justify-center gap-2"
                      >
                        <MaterialIcon name="check_circle" size={20} />
                        PRESENT / CONFIRM WINNER #{state?.next_serial ?? stageSerial}
                      </button>

                      <button
                        id="controller-ignore-candidate-btn"
                        type="button"
                        onClick={() => setShowIgnoreModal(true)}
                        disabled={actionLoading}
                        className="w-full sm:w-auto px-5 py-3.5 rounded-xl font-bold text-sm tracking-wide bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 transition hover:scale-[1.02] active:scale-98 flex items-center justify-center gap-2"
                      >
                        <MaterialIcon name="person_off" size={20} />
                        IGNORE / ABSENT
                      </button>
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="border border-dashed border-slate-700/80 rounded-2xl p-7 text-center flex flex-col items-center justify-center bg-slate-950/20">
                <MaterialIcon name="casino" size={40} className="text-slate-600 mb-2" />
                <h4 className="text-base font-bold text-slate-300">Ready for Next Winner Draw</h4>
                <p className="text-xs text-slate-400 max-w-sm mt-1">
                  Click <strong>START DRAW</strong> below to start synchronized stage countdown and select Prize #{state?.next_serial ?? 1}.
                </p>
              </div>
            )}
          </div>

          {/* Action Button Strip */}
          <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-slate-800">
            {state?.status === 'WAITING_CONFIRMATION' || revealedCandidate || state?.current_candidate ? (
              <div className="flex-1 min-w-[200px] py-3.5 px-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-mono font-medium flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
                <span>
                  Winner #{state?.next_serial ?? stageSerial} selected. Confirm presence or skip using the action buttons above.
                </span>
              </div>
            ) : (
              <button
                id="controller-start-draw-btn"
                type="button"
                onClick={handleStartDraw}
                disabled={
                  actionLoading ||
                  state?.status === 'COMPLETED' ||
                  state?.status === 'DRAWING' ||
                  stagePhase === 'STAGE_INTRO' ||
                  stagePhase === 'COUNTDOWN' ||
                  stagePhase === 'ROLLING' ||
                  state?.status === 'PAUSED' ||
                  state?.status === 'INTERRUPTED'
                }
                className="flex-1 min-w-[180px] py-4 rounded-2xl font-black text-sm md:text-base tracking-wider uppercase bg-gradient-to-r from-purple-600 via-pink-600 to-rose-500 hover:from-purple-500 hover:to-rose-400 text-white shadow-[0_0_30px_rgba(236,72,153,0.4)] disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
              >
                <MaterialIcon name="casino" size={22} />
                {state?.status === 'DRAWING' || stagePhase === 'COUNTDOWN' || stagePhase === 'ROLLING' || stagePhase === 'STAGE_INTRO'
                  ? 'STAGE COUNTDOWN IN PROGRESS...'
                  : state?.status === 'COMPLETED'
                  ? 'ALL WINNERS DRAWN'
                  : `START DRAW FOR WINNER #${state?.next_serial ?? 1}`}
              </button>
            )}

            <button
              id="controller-pause-toggle-btn"
              type="button"
              onClick={handleTogglePause}
              disabled={actionLoading || state?.status === 'COMPLETED'}
              className="px-5 py-4 rounded-2xl glass-pill font-bold text-sm text-slate-200 hover:text-white transition flex items-center gap-2"
            >
              <MaterialIcon name={state?.status === 'PAUSED' ? 'play_arrow' : 'pause'} size={20} />
              {state?.status === 'PAUSED' ? 'Resume Raffle' : 'Pause'}
            </button>

            <button
              id="controller-reset-modal-btn"
              type="button"
              onClick={() => setShowResetModal(true)}
              className="px-4 py-4 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 font-semibold text-sm transition flex items-center gap-1.5"
            >
              <MaterialIcon name="restart_alt" size={20} />
              Reset
            </button>
          </div>
        </div>

        {/* Right Column: Participant Category Breakdown & Rules */}
        <div className="lg:col-span-5 glass-panel p-6 md:p-8 rounded-3xl flex flex-col justify-between space-y-6">
          <div>
            <h3 className="text-base font-bold font-display text-white mb-4 flex items-center gap-2">
              <MaterialIcon name="groups" className="text-cyan-400" />
              Participant Pool Composition
            </h3>

            <div className="space-y-3 text-sm">
              <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="w-3 h-3 rounded-full bg-cyan-400" />
                  <span className="text-slate-300 font-medium">CSE Students</span>
                </div>
                <span className="font-mono font-bold text-white">{state?.students_count ?? 0}</span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="w-3 h-3 rounded-full bg-purple-400" />
                  <span className="text-slate-300 font-medium">Faculty Members</span>
                </div>
                <span className="font-mono font-bold text-white">{state?.faculty_count ?? 0}</span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="w-3 h-3 rounded-full bg-amber-400" />
                  <span className="text-slate-300 font-medium">Guests</span>
                </div>
                <span className="font-mono font-bold text-white">{state?.guest_count ?? 0}</span>
              </div>
            </div>

            {/* Mobile Remote QR Code & Auto-Sync Card */}
            <div className="mt-6 p-5 rounded-2xl bg-gradient-to-br from-cyan-950/40 via-slate-900/60 to-indigo-950/40 border border-cyan-500/40 text-xs text-slate-300 space-y-3.5 shadow-lg relative overflow-hidden">
              <div className="flex items-center justify-between">
                <div className="font-extrabold text-cyan-300 uppercase tracking-wider flex items-center gap-2">
                  <MaterialIcon name="qr_code_2" size={20} className="text-cyan-400" />
                  <span>Mobile Remote Controller</span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Auto-Sync Active
                </span>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-4 pt-1">
                {/* QR Code Container in High-Contrast White Frame */}
                <div
                  id="desktop-controller-qr-code"
                  onClick={() => setShowRemoteModal(true)}
                  className="p-2.5 bg-white rounded-2xl shadow-xl hover:scale-105 transition cursor-pointer flex-shrink-0 group"
                  title="Click to enlarge QR Code for scanning"
                >
                  <QRCodeSVG
                    value={getRemoteUrl()}
                    size={96}
                    level="M"
                    includeMargin={false}
                  />
                </div>

                <div className="flex-1 space-y-2 text-center sm:text-left">
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Scan with any smartphone camera to control the live draw directly from the stage or auditorium with zero lag.
                  </p>
                  <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowRemoteModal(true)}
                      className="px-3 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 text-xs font-bold flex items-center gap-1.5 transition"
                    >
                      <MaterialIcon name="zoom_in" size={16} />
                      Enlarge QR
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyRemoteUrl}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition"
                    >
                      <MaterialIcon name={copiedRemoteUrl ? 'done' : 'content_copy'} size={14} className={copiedRemoteUrl ? 'text-emerald-400' : ''} />
                      {copiedRemoteUrl ? 'Copied Link!' : 'Copy Link'}
                    </button>
                    <a
                      href={getRemoteUrl()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1 transition"
                    >
                      <MaterialIcon name="open_in_new" size={14} />
                      Open
                    </a>
                  </div>
                </div>
              </div>
            </div>

            {/* Event Rules Box */}
            <div className="mt-6 p-4 rounded-2xl bg-purple-500/10 border border-purple-500/20 text-xs text-slate-300 space-y-2">
              <div className="font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
                <MaterialIcon name="verified_user" size={16} />
                Strict System Rules
              </div>
              <p>• One person can win only once. Eligible state is automatically updated to 0 upon confirmation.</p>
              <p>• Candidate must be present. If absent, click Ignore to preserve the winner serial for the next draw.</p>
              <p>• Tamper-evident cryptographic receipts and audit logs are recorded in Supabase on every mutation.</p>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <span>FastAPI/Express State Engine</span>
            <span>v1.0 Production Grade</span>
          </div>
        </div>
      </div>

      {/* Live Participant Search & Inspection Table (Section 48) */}
      <div className="glass-panel p-6 md:p-8 rounded-3xl space-y-5">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold font-display text-white flex items-center gap-2">
              <MaterialIcon name="search" className="text-purple-400" />
              Participant Directory & Eligibility Inspector
            </h3>
            <p className="text-xs text-slate-400">Search and verify any participant status in real-time</p>
          </div>

          {/* Search Controls */}
          <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
            <div className="relative flex-1 md:w-64">
              <input
                id="participant-search-input"
                type="text"
                placeholder="Search Roll, Name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-900/80 border border-slate-700 text-slate-200 placeholder-slate-500 text-xs focus:outline-none focus:border-purple-500 transition"
              />
              <MaterialIcon name="search" size={18} className="absolute left-2.5 top-2.5 text-slate-500" />
            </div>

            <select
              value={searchType}
              onChange={(e) => setSearchType(e.target.value)}
              className="px-3 py-2 rounded-xl bg-slate-900/80 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-purple-500"
            >
              <option value="all">All Roles</option>
              <option value="student">Student</option>
              <option value="faculty">Faculty</option>
              <option value="guest">Guest</option>
            </select>

            <select
              value={searchStatus}
              onChange={(e) => setSearchStatus(e.target.value)}
              className="px-3 py-2 rounded-xl bg-slate-900/80 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-purple-500"
            >
              <option value="all">All Status</option>
              <option value="eligible">Eligible Only</option>
              <option value="winner">Winners Only</option>
              <option value="ignored">Ignored Only</option>
            </select>

            <button
              id="btn-open-verify-modal-toolbar"
              type="button"
              onClick={() => {
                fetchRegistrations();
                setShowVerifyModal(true);
              }}
              className="px-3.5 py-2 rounded-xl bg-purple-600/25 hover:bg-purple-600/40 border border-purple-500/40 text-purple-200 text-xs font-bold font-mono transition flex items-center gap-1.5 shadow-sm whitespace-nowrap"
              title="Open participant registration verification queue"
            >
              <MaterialIcon name="how_to_reg" size={16} />
              <span>Verify Queue</span>
              {registrations.filter((r) => r.status === 'pending').length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-pink-500 text-white animate-pulse">
                  {registrations.filter((r) => r.status === 'pending').length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Directory Table */}
        <div className="overflow-x-auto rounded-2xl border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/80 text-slate-400 uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">ID / Roll</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Designation</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Verification & Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-medium">
              {participantsList.slice(0, 15).map((p, idx) => (
                <tr key={`${p.name}_${idx}`} className="hover:bg-white/5 transition">
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        p.type === 'student'
                          ? 'bg-cyan-500/20 text-cyan-300'
                          : p.type === 'faculty'
                          ? 'bg-purple-500/20 text-purple-300'
                          : 'bg-amber-500/20 text-amber-300'
                      }`}
                    >
                      {p.type}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-slate-300">{p.id || '—'}</td>
                  <td className="px-4 py-2.5 text-white font-semibold">{p.name}</td>
                  <td className="px-4 py-2.5 text-slate-400">{p.designation || 'Student'}</td>
                  <td className="px-4 py-2.5">
                    {p.status === 'winner' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                        <MaterialIcon name="emoji_events" size={14} className="mr-1" /> WINNER
                      </span>
                    ) : p.status === 'ignored' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                        <MaterialIcon name="block" size={14} className="mr-1" /> IGNORED
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                        <MaterialIcon name="check" size={14} className="mr-1" /> ELIGIBLE
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {p.status === 'winner' ? (
                      <span className="text-[11px] font-mono text-amber-400/80 font-semibold inline-flex items-center gap-1">
                        <MaterialIcon name="workspace_premium" size={14} /> Protected Winner
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={verifyingParticipantKey === `${p.name}_${p.id || ''}`}
                        onClick={() => handleVerifyParticipantEligibility(p, p.status === 'eligible' ? 0 : 1)}
                        className={`px-2.5 py-1 rounded-xl text-[11px] font-bold font-mono transition inline-flex items-center gap-1 ${
                          p.status === 'eligible'
                            ? 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30'
                            : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40'
                        }`}
                        title={p.status === 'eligible' ? 'Mark participant ineligible' : 'Verify and mark eligible for draw'}
                      >
                        <MaterialIcon
                          name={
                            verifyingParticipantKey === `${p.name}_${p.id || ''}`
                              ? 'refresh'
                              : p.status === 'eligible'
                              ? 'person_off'
                              : 'verified'
                          }
                          size={13}
                          className={verifyingParticipantKey === `${p.name}_${p.id || ''}` ? 'animate-spin' : ''}
                        />
                        <span>
                          {verifyingParticipantKey === `${p.name}_${p.id || ''}`
                            ? 'Updating...'
                            : p.status === 'eligible'
                            ? 'Revoke Eligibility'
                            : 'Verify / Restore'}
                        </span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {participantsList.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No matching participants found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Showing {Math.min(15, participantsList.length)} of {participantsList.length} participants</span>
          <span>Use search field to locate any roll or name</span>
        </div>
      </div>

      {/* Page Access Control & Restriction Manager */}
      <div className="glass-panel p-6 md:p-8 rounded-3xl space-y-6 border border-slate-700/60">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold font-display text-white flex items-center gap-2">
              <MaterialIcon name="visibility_off" className="text-amber-400" />
              Page Access & Public Banner Restriction Control
            </h3>
            <p className="text-xs text-slate-400">
              When a page is restricted, visitors will immediately see the official <strong>banner.jpg</strong> graphic and restriction announcement.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              id="btn-open-excel-seeder"
              href="/controller/seed"
              className="px-4 py-2.5 rounded-xl bg-cyan-600/30 hover:bg-cyan-600/40 border border-cyan-500/40 text-cyan-200 text-xs font-bold font-mono transition flex items-center gap-2 shadow-sm"
            >
              <MaterialIcon name="table_chart" size={18} />
              <span>EXCEL SEEDER (data.excel)</span>
            </a>

            <button
              onClick={() => setShowImportModal(true)}
              className="px-4 py-2.5 rounded-xl bg-purple-600/30 hover:bg-purple-600/40 border border-purple-500/40 text-purple-200 text-xs font-bold font-mono transition flex items-center gap-2 shadow-sm"
            >
              <MaterialIcon name="upload_file" size={18} />
              <span>JSON IMPORT</span>
            </button>
          </div>
        </div>

        {/* 5 Page & Self-Registration Access Toggles */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            { key: 'audience', label: 'Audience Stage', path: '/', icon: 'tv' },
            { key: 'participants', label: 'Participant Directory', path: '/participants', icon: 'people' },
            { key: 'self_registration', label: 'Self-Registration', path: '/participants#register', icon: 'how_to_reg' },
            { key: 'results', label: 'Official Results', path: '/results', icon: 'emoji_events' },
            { key: 'health', label: 'Health Dashboard', path: '/health', icon: 'monitor_heart' },
          ].map((item) => {
            const isSelfReg = item.key === 'self_registration';
            const isAllowed = isSelfReg
              ? pageAccess.self_registration
              : pageAccess[item.key as keyof typeof pageAccess];
            return (
              <div
                key={item.key}
                className={`p-4 rounded-2xl border transition flex flex-col justify-between space-y-3 ${
                  isAllowed
                    ? 'bg-slate-900/60 border-slate-700'
                    : 'bg-amber-950/20 border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.15)]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MaterialIcon name={item.icon} size={18} className={isAllowed ? 'text-slate-400' : 'text-amber-400'} />
                    <span className="font-bold text-sm text-white">{item.label}</span>
                  </div>
                  <span
                    className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                      isAllowed
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                    }`}
                  >
                    {isAllowed
                      ? isSelfReg
                        ? 'OPEN'
                        : 'PUBLIC'
                      : isSelfReg
                      ? 'CLOSED'
                      : 'RESTRICTED'}
                  </span>
                </div>

                <div className="text-xs text-slate-400 font-mono truncate">{item.path}</div>

                <button
                  type="button"
                  disabled={savingAccess}
                  onClick={() => handleTogglePageAccess(item.key as any)}
                  className={`w-full py-2 rounded-xl text-xs font-bold font-mono transition flex items-center justify-center gap-1.5 ${
                    isAllowed
                      ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                      : 'bg-amber-500/30 hover:bg-amber-500/40 text-amber-200 border border-amber-400/50'
                  }`}
                >
                  <MaterialIcon name={isAllowed ? 'lock' : 'lock_open'} size={15} />
                  <span>
                    {isSelfReg
                      ? isAllowed
                        ? 'Close Self-Reg'
                        : 'Open Self-Reg'
                      : isAllowed
                      ? 'Restrict Access'
                      : 'Restore Public Access'}
                  </span>
                </button>
              </div>
            );
          })}
        </div>

        {/* Custom Restriction Announcement Message */}
        <div className="pt-3 border-t border-slate-800 space-y-3">
          <label className="block text-xs font-mono font-bold text-slate-300 uppercase">
            Custom Restriction Message Displayed Alongside Banner
          </label>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <input
              type="text"
              value={pageAccess.restriction_message}
              onChange={(e) => setPageAccess({ ...pageAccess, restriction_message: e.target.value })}
              placeholder="e.g. This page is temporarily restricted by the event administrator. Please stay tuned."
              className="flex-1 px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs outline-none focus:border-amber-400 transition"
            />
            <button
              type="button"
              disabled={savingAccess}
              onClick={handleSaveRestrictionMessage}
              className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs font-mono transition shadow-md whitespace-nowrap active:scale-95"
            >
              Save Announcement
            </button>
          </div>
        </div>
      </div>

      {/* Modal: Participant Roster Import */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="max-w-xl w-full glass-capsule rounded-3xl p-6 sm:p-8 border border-purple-500/30 bg-slate-900/95 shadow-2xl text-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <MaterialIcon name="upload_file" size={22} className="text-purple-400" />
                <h3 className="text-lg font-bold text-white">Import Participants into Supabase</h3>
              </div>
              <button
                onClick={() => setShowImportModal(false)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition"
              >
                <MaterialIcon name="close" size={20} />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Paste participant records as JSON array or CSV lines. Imported records will be securely upserted to table <code>cse_fest_2026_participants</code> in Supabase.
            </p>

            <form onSubmit={handleImportSubmit} className="space-y-3">
              <textarea
                rows={8}
                value={importJsonText}
                onChange={(e) => setImportJsonText(e.target.value)}
                placeholder={`CSV Format (Name, ID, Category, Designation):\nSabbir Hossain, 2303001, student, 3rd Year\nProf. Dr. Shamsul Arefin, FAC-01, faculty, Professor\n\nOr JSON Format:\n[\n  { "name": "Fatima Mahmud", "external_id": "2303002", "type": "student" }\n]`}
                className="w-full p-3.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 font-mono text-xs outline-none focus:border-purple-400 transition"
              />

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isImporting || !importJsonText.trim()}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white text-xs font-bold font-mono transition shadow-md disabled:opacity-40 flex items-center gap-1.5"
                >
                  {isImporting ? (
                    <>
                      <MaterialIcon name="refresh" size={14} className="animate-spin" />
                      <span>IMPORTING...</span>
                    </>
                  ) : (
                    <span>IMPORT TO SUPABASE</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Ignore Candidate Confirmation */}
      {showIgnoreModal && state?.current_candidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-md p-6 rounded-3xl border border-rose-500/40 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <MaterialIcon name="warning" size={28} />
              <h3 className="text-lg font-bold text-white">IGNORE CANDIDATE?</h3>
            </div>

            <p className="text-sm text-slate-300">
              Are you sure you want to ignore <strong>{state.current_candidate.name}</strong>?
            </p>

            <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 text-xs text-slate-400">
              This participant will become <strong>ineligible (eligible = 0)</strong> for the remainder of this raffle session. Winner #{state.next_serial} will NOT be consumed.
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Reason for ignoring:</label>
              <select
                value={ignoreReason}
                onChange={(e) => setIgnoreReason(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:border-rose-500"
              >
                <option value="absent">Participant is absent on stage</option>
                <option value="disqualified">Disqualified by committee</option>
                <option value="declined">Declined acceptance</option>
              </select>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3">
              <button
                onClick={() => setShowIgnoreModal(false)}
                disabled={actionLoading}
                className="px-4 py-2.5 rounded-xl glass-pill text-sm font-semibold text-slate-300 hover:text-white"
              >
                Cancel
              </button>

              <button
                onClick={handleIgnoreCandidate}
                disabled={actionLoading}
                className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold shadow-lg transition"
              >
                {actionLoading ? 'Processing...' : 'Confirm Ignore'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Start New Session / Reset Confirmation (Section 25) */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-md p-6 rounded-3xl border border-rose-600/50 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-500">
              <MaterialIcon name="dangerous" size={32} />
              <div>
                <h3 className="text-lg font-black text-white">START NEW SESSION / RESET</h3>
                <p className="text-xs text-rose-300">Destructive operation requiring typed confirmation</p>
              </div>
            </div>

            <p className="text-xs md:text-sm text-slate-300">
              This will record a timestamped audit log in Supabase, restore all participant eligibility to 1, clear existing winner results, and reset the raffle to Winner #01.
            </p>

            {resetError && (
              <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs">
                {resetError}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Type <strong>RESET</strong> in uppercase to confirm:
              </label>
              <input
                id="reset-confirmation-input"
                type="text"
                placeholder="RESET"
                value={resetConfirmationText}
                onChange={(e) => setResetConfirmationText(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono text-sm focus:outline-none focus:border-rose-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3">
              <button
                onClick={() => {
                  setShowResetModal(false);
                  setResetConfirmationText('');
                  setResetError('');
                }}
                disabled={actionLoading}
                className="px-4 py-2.5 rounded-xl glass-pill text-sm font-semibold text-slate-300 hover:text-white"
              >
                Cancel
              </button>

              <button
                onClick={handleResetSession}
                disabled={actionLoading || resetConfirmationText !== 'RESET'}
                className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold shadow-lg transition"
              >
                {actionLoading ? 'Creating Backup & Resetting...' : 'Execute Reset'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Participant Self-Registration Verification Queue */}
      {showVerifyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="max-w-4xl w-full max-h-[90vh] flex flex-col rounded-3xl p-6 sm:p-8 border border-purple-500/40 bg-slate-900/95 shadow-2xl text-slate-200 space-y-5 overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-purple-500/20 text-purple-400 border border-purple-500/30 flex items-center justify-center">
                  <MaterialIcon name="how_to_reg" size={24} />
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-bold font-display text-white">
                    Participant Registration Verification Center
                  </h3>
                  <p className="text-xs text-slate-400">
                    Review and verify incoming self-registration requests from the public directory
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowVerifyModal(false)}
                className="p-2 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition"
                title="Close modal"
              >
                <MaterialIcon name="close" size={20} />
              </button>
            </div>

            {/* Metrics Ribbon & Batch Actions */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800">
                <span className="text-[10px] font-mono uppercase text-slate-400">Total Requests</span>
                <div className="text-xl font-black font-display text-white mt-0.5">{registrations.length}</div>
              </div>
              <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30">
                <span className="text-[10px] font-mono uppercase text-amber-400">Pending Review</span>
                <div className="text-xl font-black font-display text-amber-300 mt-0.5">
                  {registrations.filter((r) => r.status === 'pending').length}
                </div>
              </div>
              <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30">
                <span className="text-[10px] font-mono uppercase text-emerald-400">Approved & Enrolled</span>
                <div className="text-xl font-black font-display text-emerald-300 mt-0.5">
                  {registrations.filter((r) => r.status === 'approved').length}
                </div>
              </div>
              <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30">
                <span className="text-[10px] font-mono uppercase text-rose-400">Rejected</span>
                <div className="text-xl font-black font-display text-rose-300 mt-0.5">
                  {registrations.filter((r) => r.status === 'rejected').length}
                </div>
              </div>
            </div>

            {/* Filter and Search Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                {(['pending', 'approved', 'rejected', 'all'] as const).map((st) => {
                  const count =
                    st === 'all'
                      ? registrations.length
                      : registrations.filter((r) => r.status === st).length;
                  return (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setRegFilterStatus(st)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold font-mono transition capitalize flex items-center gap-1.5 ${
                        regFilterStatus === st
                          ? 'bg-purple-600 text-white shadow-md'
                          : 'bg-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <span>{st}</span>
                      <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/30 text-white font-mono">
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1 sm:w-56">
                  <input
                    type="text"
                    placeholder="Filter by name or roll..."
                    value={regSearchQuery}
                    onChange={(e) => setRegSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-200 placeholder-slate-500 text-xs focus:outline-none focus:border-purple-500 transition"
                  />
                  <MaterialIcon name="search" size={16} className="absolute left-2.5 top-2 text-slate-500" />
                </div>

                <button
                  type="button"
                  onClick={fetchRegistrations}
                  disabled={loadingRegistrations}
                  className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                  title="Refresh registrations"
                >
                  <MaterialIcon name="refresh" size={18} className={loadingRegistrations ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {/* Batch Action Bar */}
            {registrations.filter((r) => r.status === 'pending').length > 0 && (
              <div className="p-3 rounded-2xl bg-purple-950/30 border border-purple-500/30 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-purple-200 flex items-center gap-2">
                  <MaterialIcon name="bolt" size={18} className="text-purple-400" />
                  <span>
                    <strong>{registrations.filter((r) => r.status === 'pending').length}</strong> registrations waiting for verification
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={batchReviewing}
                    onClick={() => handleBatchReview('approve')}
                    className="px-3.5 py-1.5 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/40 text-emerald-200 border border-emerald-500/40 text-xs font-bold font-mono transition flex items-center gap-1 disabled:opacity-40"
                  >
                    <MaterialIcon name="done_all" size={15} />
                    <span>Approve All Pending</span>
                  </button>
                  <button
                    type="button"
                    disabled={batchReviewing}
                    onClick={() => handleBatchReview('reject')}
                    className="px-3.5 py-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-200 border border-rose-500/30 text-xs font-bold font-mono transition flex items-center gap-1 disabled:opacity-40"
                  >
                    <MaterialIcon name="remove_circle_outline" size={15} />
                    <span>Reject All Pending</span>
                  </button>
                </div>
              </div>
            )}

            {/* Requests List */}
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 max-h-[420px]">
              {registrations
                .filter((r) => {
                  const matchStatus = regFilterStatus === 'all' ? true : r.status === regFilterStatus;
                  const matchType = regFilterType === 'all' ? true : r.type === regFilterType;
                  const q = regSearchQuery.toLowerCase().trim();
                  const matchQuery =
                    !q ||
                    r.name.toLowerCase().includes(q) ||
                    (r.external_id && r.external_id.toLowerCase().includes(q));
                  return matchStatus && matchType && matchQuery;
                })
                .map((req) => (
                  <div
                    key={req.id}
                    className="p-3.5 rounded-2xl bg-slate-950/70 hover:bg-slate-950 border border-slate-800 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            req.type === 'student'
                              ? 'bg-cyan-500/20 text-cyan-300'
                              : req.type === 'faculty'
                              ? 'bg-purple-500/20 text-purple-300'
                              : 'bg-amber-500/20 text-amber-300'
                          }`}
                        >
                          {req.type}
                        </span>
                        <span className="text-sm font-bold text-white">{req.name}</span>
                        {req.external_id && (
                          <span className="font-mono text-xs text-slate-400 bg-slate-900 px-2 py-0.5 rounded-md border border-slate-800">
                            {req.external_id}
                          </span>
                        )}
                        <span
                          className={`text-[10px] font-bold font-mono uppercase px-2 py-0.5 rounded-full ${
                            req.status === 'approved'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : req.status === 'rejected'
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                          }`}
                        >
                          {req.status}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 flex items-center gap-3">
                        <span>Designation: {req.designation || 'Participant'}</span>
                        <span>•</span>
                        <span>
                          Registered: {new Date(req.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {req.review_notes && (
                          <>
                            <span>•</span>
                            <span className="italic text-slate-400">Note: {req.review_notes}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 self-end sm:self-center">
                      {req.status === 'pending' ? (
                        <>
                          <button
                            type="button"
                            disabled={reviewingId === req.id}
                            onClick={() => handleReviewRegistration(req.id, 'approve')}
                            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold font-mono transition flex items-center gap-1 shadow-sm disabled:opacity-40"
                          >
                            <MaterialIcon name="check" size={15} />
                            <span>{reviewingId === req.id ? 'Approving...' : 'Approve & Enroll'}</span>
                          </button>
                          <button
                            type="button"
                            disabled={reviewingId === req.id}
                            onClick={() => handleReviewRegistration(req.id, 'reject', 'Rejected by controller')}
                            className="px-3 py-1.5 rounded-xl bg-rose-600/30 hover:bg-rose-600/50 text-rose-200 border border-rose-500/40 text-xs font-bold font-mono transition flex items-center gap-1 disabled:opacity-40"
                          >
                            <MaterialIcon name="close" size={15} />
                            <span>Reject</span>
                          </button>
                        </>
                      ) : (
                        <div className="text-right">
                          <span className="text-[11px] font-mono text-slate-400">
                            {req.reviewed_by ? `Reviewed by ${req.reviewed_by}` : 'Processed'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

              {registrations.length === 0 && (
                <div className="py-12 text-center text-slate-500 text-xs font-mono space-y-2">
                  <MaterialIcon name="inbox" size={32} className="mx-auto text-slate-600" />
                  <p>No participant registration requests found.</p>
                  <p className="text-slate-600">
                    Participants can self-register on <code>/participants</code> when enabled.
                  </p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-800 text-xs">
              <span className="text-slate-400">
                Approved participants are immediately added to <code>cse_fest_2026_participants</code> and made eligible.
              </span>
              <button
                type="button"
                onClick={() => setShowVerifyModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition"
              >
                Close Queue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ENLARGED MOBILE REMOTE QR MODAL */}
      {showRemoteModal && (
        <div
          id="mobile-remote-qr-modal"
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in"
        >
          <div className="w-full max-w-md bg-slate-900 border border-cyan-500/40 rounded-3xl p-6 md:p-8 space-y-6 shadow-2xl relative text-center">
            <button
              onClick={() => setShowRemoteModal(false)}
              className="absolute top-4 right-4 p-2 rounded-xl text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition"
              title="Close modal"
            >
              <MaterialIcon name="close" size={20} />
            </button>

            <div className="flex flex-col items-center">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-500 to-indigo-600 text-white flex items-center justify-center mb-3 shadow-lg">
                <MaterialIcon name="phonelink_ring" size={28} />
              </div>
              <h3 className="text-xl font-black font-display text-white">Mobile Remote Controller</h3>
              <p className="text-xs text-slate-300 mt-1 max-w-xs leading-relaxed">
                Scan this QR code with any smartphone camera to open the live remote page. All actions auto-sync in real time.
              </p>
            </div>

            {/* Enlarged QR Code in pristine high-contrast card */}
            <div className="inline-block p-4 bg-white rounded-3xl shadow-2xl">
              <QRCodeSVG
                value={getRemoteUrl()}
                size={220}
                level="H"
                includeMargin={true}
              />
            </div>

            {/* Auto-Auth Option */}
            <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 text-left text-xs flex items-center justify-between">
              <div>
                <div className="font-bold text-white">One-Click Auto-Authentication</div>
                <div className="text-[11px] text-slate-400">Mobile device opens unlocked without re-entering password</div>
              </div>
              <input
                type="checkbox"
                id="toggle-include-token-qr"
                checked={includeTokenInQr}
                onChange={(e) => setIncludeTokenInQr(e.target.checked)}
                className="w-4 h-4 accent-cyan-500 cursor-pointer"
              />
            </div>

            {/* URL string & copy button */}
            <div className="flex items-center gap-2 p-2 bg-slate-950 rounded-xl border border-slate-800 text-xs">
              <span className="flex-1 font-mono text-slate-300 truncate px-2 text-left select-all">
                {typeof window !== 'undefined'
                  ? includeTokenInQr && getStoredToken()
                    ? `${window.location.origin}/remote?token=••••••••••••••••`
                    : `${window.location.origin}/remote`
                  : '/remote'}
              </span>
              <button
                type="button"
                onClick={handleCopyRemoteUrl}
                className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-extrabold flex items-center gap-1 transition"
                title="Copy secure link"
              >
                <MaterialIcon name={copiedRemoteUrl ? 'check' : 'content_copy'} size={14} />
                {copiedRemoteUrl ? 'Copied' : 'Copy'}
              </button>
            </div>

            <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Live WebSocket Synced
              </span>
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.open(getRemoteUrl(), '_blank', 'noopener,noreferrer');
                  }
                }}
                className="text-cyan-400 hover:underline flex items-center gap-1 bg-transparent border-0 cursor-pointer p-0 font-medium"
              >
                Open in New Tab <MaterialIcon name="arrow_forward" size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
