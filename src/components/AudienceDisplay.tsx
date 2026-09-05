import React, { useState, useEffect, useRef, useCallback } from 'react';
import confetti from 'canvas-confetti';
import { MaterialIcon } from './MaterialIcon.tsx';
import { DuetFestIntro } from './DuetFestIntro.tsx';
import { soundEngine } from '../utils/audio.ts';
import { useWebSocket } from '../hooks/useWebSocket.ts';
import { useTheme } from '../hooks/useTheme.ts';
import { PublicDrawState, PublicEventInfo } from '../types.ts';
import { api } from '../services/api.ts';

// Real participants are loaded strictly from Supabase via /api/public/roll-pool
type StagePhase =
  | 'IDLE'
  | 'STAGE_INTRO'
  | 'COUNTDOWN'
  | 'ROLLING'
  | 'CANDIDATE_REVEAL'
  | 'WINNER_CONFIRMED'
  | 'CANDIDATE_IGNORED'
  | 'COMPLETED';

export const AudienceDisplay: React.FC = () => {
  const { toggleTheme, isDark } = useTheme();
  const { isConnected, lastMessage, isSupabaseRealtime } = useWebSocket('audience');

  const [eventInfo, setEventInfo] = useState<PublicEventInfo | null>(null);
  const [drawState, setDrawState] = useState<PublicDrawState | null>(null);
  const [audioEnabled, setAudioEnabled] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Dynamic Stage Presentation State
  const [stagePhase, setStagePhase] = useState<StagePhase>('IDLE');
  const [stageSerial, setStageSerial] = useState<number>(1);
  const [countdownTotal, setCountdownTotal] = useState<number>(5);
  const [countdownNumber, setCountdownNumber] = useState<number>(5);
  const [shufflePasses, setShufflePasses] = useState<number>(7);
  const [rollingIndex, setRollingIndex] = useState<number>(0);
  const [realParticipants, setRealParticipants] = useState<{ name: string; id: string; type: string }[]>([]);
  const realParticipantsRef = useRef<{ name: string; id: string; type: string }[]>([]);
  const [displayedCandidate, setDisplayedCandidate] = useState<any>(null);
  const [displayedWinner, setDisplayedWinner] = useState<any>(null);
  const [ignoredInfo, setIgnoredInfo] = useState<{ name: string; reason: string; next_serial: number } | null>(null);

  // Synchronized persistent refs to completely prevent re-render loops
  const eventInfoRef = useRef<PublicEventInfo | null>(eventInfo);
  eventInfoRef.current = eventInfo;

  const drawStateRef = useRef<PublicDrawState | null>(drawState);
  drawStateRef.current = drawState;

  const stagePhaseRef = useRef<StagePhase>(stagePhase);
  stagePhaseRef.current = stagePhase;

  const stageSerialRef = useRef<number>(stageSerial);
  stageSerialRef.current = stageSerial;

  const audioEnabledRef = useRef<boolean>(audioEnabled);
  audioEnabledRef.current = audioEnabled;

  const pendingCandidateRef = useRef<any>(null);
  const countTimerRef = useRef<NodeJS.Timeout | null>(null);
  const rollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const stageSequenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activeAnimationLockRef = useRef<boolean>(false);
  const confettiCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const confettiInstanceRef = useRef<confetti.CreateTypes | null>(null);
  const handledMessageSigRef = useRef<string>('');

  const clearAllStageTimers = useCallback(() => {
    if (countTimerRef.current) {
      clearInterval(countTimerRef.current);
      countTimerRef.current = null;
    }
    if (rollingIntervalRef.current) {
      clearInterval(rollingIntervalRef.current);
      rollingIntervalRef.current = null;
    }
    if (stageSequenceTimeoutRef.current) {
      clearTimeout(stageSequenceTimeoutRef.current);
      stageSequenceTimeoutRef.current = null;
    }
  }, []);

  // Clean up confetti instance on unmount
  useEffect(() => {
    return () => {
      try {
        if (confettiInstanceRef.current) {
          confettiInstanceRef.current.reset();
        }
      } catch {}
    };
  }, []);

  // Continuous multi-stage celebration confetti
  const triggerGrandConfetti = useCallback(() => {
    try {
      if (!confettiInstanceRef.current) {
        if (confettiCanvasRef.current && typeof confettiCanvasRef.current.getContext === 'function') {
          confettiInstanceRef.current = confetti.create(confettiCanvasRef.current, {
            resize: true,
            useWorker: false,
          });
        } else {
          confettiInstanceRef.current = confetti.create(undefined, {
            resize: true,
            useWorker: false,
          });
        }
      }

      const fire = confettiInstanceRef.current;
      if (!fire) return;

      const end = Date.now() + 3500;
      const colors = ['#f59e0b', '#fbbf24', '#06b6d4', '#ec4899', '#ffffff', '#10b981'];

      // Left cannon
      fire({
        particleCount: 50,
        angle: 60,
        spread: 70,
        origin: { x: 0.1, y: 0.65 },
        colors,
      });
      // Right cannon
      fire({
        particleCount: 50,
        angle: 120,
        spread: 70,
        origin: { x: 0.9, y: 0.65 },
        colors,
      });
      // Center blast
      fire({
        particleCount: 75,
        spread: 100,
        origin: { x: 0.5, y: 0.5 },
        colors,
      });

      (function frame() {
        try {
          fire({
            particleCount: 4,
            angle: 60,
            spread: 55,
            origin: { x: 0, y: 0.7 },
            colors,
          });
          fire({
            particleCount: 4,
            angle: 120,
            spread: 55,
            origin: { x: 1, y: 0.7 },
            colors,
          });

          if (Date.now() < end) {
            requestAnimationFrame(frame);
          }
        } catch {}
      })();
    } catch (err) {
      console.warn('Celebration confetti handled safely:', err);
    }
  }, []);

  // Complete Theatrical Draw Start Animation Sequence (Stable reference via refs)
  const handleDrawStartSequence = useCallback((payload: any) => {
    // Only guard against double-triggering if already in active COUNTDOWN or ROLLING phase
    if (stagePhaseRef.current === 'COUNTDOWN' || stagePhaseRef.current === 'ROLLING') return;
    activeAnimationLockRef.current = true;

    clearAllStageTimers();

    setDisplayedCandidate(null);
    setDisplayedWinner(null);
    setIgnoredInfo(null);

    const candidate = payload.candidate;
    pendingCandidateRef.current = candidate;

    const currentEvent = eventInfoRef.current;
    const currentDraw = drawStateRef.current;

    const serial = payload.serial || currentDraw?.next_serial || 1;
    const cdSeconds = payload.countdown_seconds ?? currentEvent?.countdown_seconds ?? 5;
    const passes = payload.shuffle_passes ?? currentEvent?.shuffle_passes ?? 7;

    const now = Date.now();
    const countdownEndMs = payload.countdown_end_ms || (now + cdSeconds * 1000);
    const rollDurationMs = payload.roll_duration_ms || 2200;
    const revealTimeMs = payload.reveal_time_ms || (countdownEndMs + rollDurationMs);

    setStageSerial(serial);
    setCountdownTotal(cdSeconds);
    setShufflePasses(passes);

    const startRollingPhase = () => {
      // PHASE 2: CYCLOTRON ROLLING SIMULATION
      setStagePhase('ROLLING');
      let rIdx = 0;
      const fallbackRollingItem = candidate
        ? { name: candidate.name, id: candidate.id ? `Roll: ${candidate.id}` : 'DUET CSE', type: candidate.type || 'PARTICIPANT' }
        : { name: 'Selecting candidate...', id: 'DUET CSE FEST 2026', type: 'DRAW' };
      const activePool = realParticipantsRef.current.length > 0 ? realParticipantsRef.current : [fallbackRollingItem];
      const poolLength = Math.max(1, activePool.length);
      const rollTimer = setInterval(() => {
        rIdx = (rIdx + 1) % poolLength;
        setRollingIndex(rIdx);
        if (audioEnabledRef.current && currentEvent?.beep_enabled !== false) {
          soundEngine.playTickSound();
        }
      }, 60);
      rollingIntervalRef.current = rollTimer;

      // Roll until revealTimeMs (matching server clock precisely)
      const rollRemainingMs = Math.max(600, revealTimeMs - Date.now());
      stageSequenceTimeoutRef.current = setTimeout(() => {
        if (rollingIntervalRef.current) {
          clearInterval(rollingIntervalRef.current);
          rollingIntervalRef.current = null;
        }
        activeAnimationLockRef.current = false;

        // PHASE 3: CANDIDATE REVEAL
        const revealedCandidate = pendingCandidateRef.current || candidate;
        setDisplayedCandidate(revealedCandidate);
        setStagePhase('CANDIDATE_REVEAL');
        if (audioEnabledRef.current && currentEvent?.beep_enabled !== false) {
          soundEngine.playCandidateSelectSound();
        }
      }, rollRemainingMs);
    };

    // Calculate initial remaining seconds based on server target timestamp
    const initialRemainingMs = countdownEndMs - Date.now();
    if (initialRemainingMs <= 100) {
      // If countdown already elapsed, jump straight to rolling phase
      startRollingPhase();
      return;
    }

    const initialSec = Math.max(1, Math.ceil(initialRemainingMs / 1000));
    setCountdownNumber(initialSec);

    // PHASE 1: HIGH-ENERGY NEON CIRCULAR COUNTDOWN (RUNS FIRST FOR ALL SERIALS)
    setStagePhase('COUNTDOWN');
    if (audioEnabledRef.current && currentEvent?.beep_enabled !== false) {
      soundEngine.playCountdownBeep(initialSec);
    }

    let lastBeepSec = initialSec;
    // 50ms high-resolution timer checking absolute time delta (drift-free)
    countTimerRef.current = setInterval(() => {
      const remainingMs = countdownEndMs - Date.now();
      const currentSec = Math.ceil(remainingMs / 1000);

      if (remainingMs > 0) {
        if (currentSec !== lastBeepSec && currentSec > 0) {
          lastBeepSec = currentSec;
          setCountdownNumber(currentSec);
          if (audioEnabledRef.current && currentEvent?.beep_enabled !== false) {
            soundEngine.playCountdownBeep(currentSec);
          }
        }
      } else {
        if (countTimerRef.current) {
          clearInterval(countTimerRef.current);
          countTimerRef.current = null;
        }
        startRollingPhase();
      }
    }, 50);
  }, [clearAllStageTimers]);

  // Initial event config & real participant pool loading
  useEffect(() => {
    api.getPublicEvent().then(setEventInfo).catch(() => {});
    api
      .getRollPool()
      .then((res) => {
        if (res.pool && res.pool.length > 0) {
          setRealParticipants(res.pool);
          realParticipantsRef.current = res.pool;
        }
      })
      .catch(() => {
        api
          .getPublicParticipants({ limit: 150 })
          .then((res) => {
            if (res.participants && res.participants.length > 0) {
              const mapped = res.participants.map((p) => ({
                name: p.name,
                id: p.id ? `Roll: ${p.id}` : p.designation || 'DUET CSE',
                type: p.type.toUpperCase(),
              }));
              setRealParticipants(mapped);
              realParticipantsRef.current = mapped;
            }
          })
          .catch(() => {});
      });
  }, []);

  // Real-time State Synchronization & 2-Second Fallback Polling (Fixed empty dependency array)
  useEffect(() => {
    let isMounted = true;

    const syncState = async () => {
      try {
        const fresh = await api.getPublicDrawState();
        if (!isMounted) return;

        const currentPhase = stagePhaseRef.current;
        const currentEvent = eventInfoRef.current;

        // If fresh state is drawing and we are not in active countdown/rolling, kick off animation sequence
        if (
          fresh.status === 'DRAWING' &&
          !activeAnimationLockRef.current &&
          currentPhase !== 'COUNTDOWN' &&
          currentPhase !== 'ROLLING' &&
          currentPhase !== 'CANDIDATE_REVEAL'
        ) {
          handleDrawStartSequence({
            serial: fresh.next_serial,
            candidate: fresh.current_candidate,
            countdown_seconds: currentEvent?.countdown_seconds || 5,
            shuffle_passes: currentEvent?.shuffle_passes || 7,
          });
        } else if (
          fresh.status === 'WAITING_CONFIRMATION' &&
          !activeAnimationLockRef.current &&
          currentPhase !== 'CANDIDATE_REVEAL' &&
          currentPhase !== 'COUNTDOWN' &&
          currentPhase !== 'ROLLING' &&
          fresh.current_candidate
        ) {
          setDisplayedCandidate(fresh.current_candidate);
          setStageSerial(fresh.next_serial);
          setStagePhase('CANDIDATE_REVEAL');
        } else if (
          fresh.status === 'WINNER_CONFIRMED' &&
          fresh.last_winner &&
          currentPhase !== 'WINNER_CONFIRMED'
        ) {
          setDisplayedWinner(fresh.last_winner);
          setStagePhase('WINNER_CONFIRMED');
          if (currentEvent?.confetti_enabled !== false) {
            triggerGrandConfetti();
          }
          if (audioEnabledRef.current && currentEvent?.beep_enabled !== false) {
            soundEngine.playWinnerCelebration();
          }
        } else if (fresh.status === 'COMPLETED' && currentPhase !== 'COMPLETED') {
          setStagePhase('COMPLETED');
        } else if (
          fresh.status === 'READY' &&
          currentPhase !== 'IDLE' &&
          !activeAnimationLockRef.current &&
          currentPhase !== 'COUNTDOWN' &&
          currentPhase !== 'ROLLING'
        ) {
          setStagePhase('IDLE');
          setDisplayedCandidate(null);
          setDisplayedWinner(null);
        }

        setDrawState((prev) => {
          if (
            prev &&
            prev.status === fresh.status &&
            prev.completed_winners === fresh.completed_winners &&
            prev.next_serial === fresh.next_serial &&
            prev.current_candidate?.id === fresh.current_candidate?.id &&
            prev.last_winner?.id === fresh.last_winner?.id
          ) {
            return prev;
          }
          return fresh;
        });
      } catch {
        // Fallback polling error suppressed
      }
    };

    // Initial check
    syncState();

    // 1.5-second interval ensures no state is missed even on network drops
    const intervalId = setInterval(syncState, 1500);

    const onWake = () => {
      if (document.visibilityState === 'visible') {
        syncState();
      }
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('online', onWake);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('online', onWake);
    };
  }, [handleDrawStartSequence, triggerGrandConfetti]);

  // Synchronize Push Messages (WebSocket & SSE) - Protected against duplicate execution
  useEffect(() => {
    if (!lastMessage) return;

    const sig = (lastMessage as any).id || `${lastMessage.type}_${lastMessage.timestamp}_${JSON.stringify(lastMessage.payload || '')}`;
    if (handledMessageSigRef.current === sig) {
      return;
    }
    handledMessageSigRef.current = sig;

    const { type, payload } = lastMessage;
    const currentEvent = eventInfoRef.current;

    if (type === 'DRAW_START') {
      handleDrawStartSequence(payload);
    } else if (type === 'CANDIDATE_SELECTED') {
      if (!activeAnimationLockRef.current) {
        setDisplayedCandidate(payload);
        setStageSerial(payload.serial || stageSerialRef.current);
        setStagePhase('CANDIDATE_REVEAL');
      }
    } else if (type === 'WINNER_CONFIRMED') {
      clearAllStageTimers();
      activeAnimationLockRef.current = false;

      setDisplayedWinner(payload.winner);
      setStagePhase('WINNER_CONFIRMED');

      // Continuous Multi-Stage Confetti Celebration
      if (currentEvent?.confetti_enabled !== false) {
        triggerGrandConfetti();
      }

      if (audioEnabledRef.current && currentEvent?.beep_enabled !== false) {
        soundEngine.playWinnerCelebration();
      }

      setDrawState((prev) =>
        prev
          ? {
              ...prev,
              status: payload.is_completed ? 'COMPLETED' : 'WINNER_CONFIRMED',
              completed_winners: payload.completed_winners,
              next_serial: payload.completed_winners + 1,
              current_candidate: null,
              last_winner: payload.winner,
            }
          : null
      );

      // Smoothly return stage back to IDLE after celebration so audience is ready for next draw
      stageSequenceTimeoutRef.current = setTimeout(() => {
        if (stagePhaseRef.current === 'WINNER_CONFIRMED' && !payload.is_completed) {
          setStagePhase('IDLE');
          setDisplayedCandidate(null);
          setDisplayedWinner(null);
        }
      }, 4500);
    } else if (type === 'CANDIDATE_IGNORED') {
      clearAllStageTimers();
      activeAnimationLockRef.current = false;

      setIgnoredInfo({
        name: payload.name,
        reason: payload.reason,
        next_serial: payload.next_serial,
      });
      setStagePhase('CANDIDATE_IGNORED');

      if (audioEnabledRef.current && currentEvent?.beep_enabled !== false) {
        soundEngine.playIgnoreSound();
      }

      // Smoothly return back to ready state after 3.2 seconds
      setTimeout(() => {
        setStagePhase('IDLE');
        setDisplayedCandidate(null);
        setIgnoredInfo(null);
      }, 3200);

      setDrawState((prev) =>
        prev
          ? {
              ...prev,
              status: 'READY',
              current_candidate: null,
              next_serial: payload.next_serial,
            }
          : null
      );
    } else if (type === 'PAUSED') {
      setDrawState((prev) => (prev ? { ...prev, status: 'PAUSED' } : null));
    } else if (type === 'RESUMED') {
      setDrawState((prev) => (prev ? { ...prev, status: 'READY' } : null));
    } else if (type === 'DRAW_STATE' || type === 'STATE_UPDATED') {
      const state = payload;
      if (!state) return;
      setDrawState(state);
      if (
        state.status === 'DRAWING' &&
        !activeAnimationLockRef.current &&
        stagePhaseRef.current !== 'COUNTDOWN' &&
        stagePhaseRef.current !== 'ROLLING' &&
        stagePhaseRef.current !== 'CANDIDATE_REVEAL'
      ) {
        handleDrawStartSequence({
          serial: state.next_serial,
          candidate: state.current_candidate,
          countdown_seconds: currentEvent?.countdown_seconds || 5,
          shuffle_passes: currentEvent?.shuffle_passes || 7,
        });
      } else if (
        state.status === 'WAITING_CONFIRMATION' &&
        !activeAnimationLockRef.current &&
        stagePhaseRef.current !== 'CANDIDATE_REVEAL' &&
        stagePhaseRef.current !== 'COUNTDOWN' &&
        stagePhaseRef.current !== 'ROLLING' &&
        state.current_candidate
      ) {
        setDisplayedCandidate(state.current_candidate);
        setStageSerial(state.next_serial);
        setStagePhase('CANDIDATE_REVEAL');
      } else if (
        state.status === 'WINNER_CONFIRMED' &&
        state.last_winner &&
        stagePhaseRef.current !== 'WINNER_CONFIRMED'
      ) {
        setDisplayedWinner(state.last_winner);
        setStagePhase('WINNER_CONFIRMED');
        if (currentEvent?.confetti_enabled !== false) {
          triggerGrandConfetti();
        }
      } else if (
        state.status === 'READY' &&
        stagePhaseRef.current !== 'IDLE' &&
        !activeAnimationLockRef.current &&
        stagePhaseRef.current !== 'COUNTDOWN' &&
        stagePhaseRef.current !== 'ROLLING'
      ) {
        setStagePhase('IDLE');
        setDisplayedCandidate(null);
        setDisplayedWinner(null);
      }
    } else if (type === 'RESET') {
      clearAllStageTimers();
      activeAnimationLockRef.current = false;
      setStagePhase('IDLE');
      setDisplayedCandidate(null);
      setDisplayedWinner(null);
      setIgnoredInfo(null);
      api.getPublicDrawState().then(setDrawState).catch(() => {});
    }
  }, [lastMessage, handleDrawStartSequence, triggerGrandConfetti, clearAllStageTimers]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const toggleAudio = () => {
    soundEngine.unlock();
    const next = !audioEnabled;
    setAudioEnabled(next);
    soundEngine.setEnabled(next);
  };

  // Keyboard shortcuts: 'F' = Fullscreen, 'T' = Toggle Theme, 'M' = Audio Mute
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      } else if (e.key === 't' || e.key === 'T') {
        toggleTheme();
      } else if (e.key === 'm' || e.key === 'M') {
        toggleAudio();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [audioEnabled, isFullscreen, isDark]);

  // Progress calculations for circular countdown gauge
  const circleRadius = 78;
  const circumference = 2 * Math.PI * circleRadius;
  const progressPercent = countdownTotal > 0 ? countdownNumber / countdownTotal : 1;
  const strokeDashoffset = circumference * (1 - progressPercent);

  return (
    <div
      id="audience-stage-root"
      onClick={() => soundEngine.unlock()}
      onDoubleClick={toggleFullscreen}
      className="relative min-h-screen w-full flex flex-col justify-center items-center overflow-hidden select-none p-4 sm:p-8"
    >
      {/* Full-screen dedicated Confetti Canvas */}
      <canvas
        ref={confettiCanvasRef}
        id="audience-confetti-canvas"
        className="fixed inset-0 pointer-events-none z-50 w-full h-full"
      />

      {/* 1. Volumetric Background Atmosphere & Geometric Grid */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden flex items-center justify-center">
        {/* Geometric Lattice Mesh */}
        <div className="absolute inset-0 opacity-15">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="stage-grid-pattern-hd" width="48" height="48" patternUnits="userSpaceOnUse">
                <path d="M24 0 L48 24 L24 48 L0 24 Z" fill="none" stroke="#38bdf8" strokeWidth="0.5" />
                <circle cx="24" cy="24" r="2" fill="none" stroke="#818cf8" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#stage-grid-pattern-hd)" />
          </svg>
        </div>

        {/* Ambient Volumetric Halos */}
        <div className="absolute w-[80vw] h-[80vw] max-w-[1200px] max-h-[1200px] rounded-full bg-cyan-600/10 blur-[150px]" />
        <div className="absolute w-[60vw] h-[60vw] max-w-[900px] max-h-[900px] rounded-full bg-purple-600/15 blur-[140px]" />
        {stagePhase === 'WINNER_CONFIRMED' && (
          <div className="absolute w-[70vw] h-[70vw] max-w-[1000px] max-h-[1000px] rounded-full bg-amber-500/20 blur-[130px] animate-pulse" />
        )}
      </div>

      {/* Floating Status & Controls in Header */}
      <div className="fixed top-4 left-4 right-4 z-50 flex items-center justify-between pointer-events-none">
        {/* Real-time Connection Indicator */}
        <div className="pointer-events-auto inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/80 backdrop-blur-md border border-slate-700/60 shadow-lg text-xs font-mono">
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400 animate-ping'}`} />
          <span className="text-slate-300 font-semibold tracking-wider">
            {isSupabaseRealtime ? 'SUPABASE REALTIME' : isConnected ? 'LIVE SYNCED' : 'CONNECTING...'}
          </span>
        </div>

        {/* Audio & Fullscreen Buttons */}
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            onClick={toggleAudio}
            title={audioEnabled ? 'Mute Audio (M)' : 'Unmute Audio (M)'}
            className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/60 backdrop-blur-md transition shadow-md"
          >
            <MaterialIcon name={audioEnabled ? 'volume_up' : 'volume_off'} size={18} />
          </button>

          <button
            onClick={toggleFullscreen}
            title="Fullscreen (F)"
            className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/60 backdrop-blur-md transition shadow-md"
          >
            <MaterialIcon name={isFullscreen ? 'fullscreen_exit' : 'fullscreen'} size={18} />
          </button>
        </div>
      </div>

      {/* 2. Main Stage Centerpiece Container */}
      <main className="relative z-10 w-full max-w-4xl flex items-center justify-center my-auto">

        {/* PHASE 1: DUET CSE FEST 2026 STAGE INTRO (FIRST 1.0 SECOND) */}
        {stagePhase === 'STAGE_INTRO' && (
          <div className="w-full flex flex-col items-center justify-center animate-in fade-in zoom-in-95 duration-300">
            <DuetFestIntro phaseText={`DUET CSE FEST 2026 • PRIZE #${stageSerial}`} />
          </div>
        )}

        {/* PHASE 2: HIGH-ENERGY NEON CIRCULAR COUNTDOWN */}
        {stagePhase === 'COUNTDOWN' && (
          <div className="w-full glass-capsule rounded-3xl md:rounded-[44px] p-8 md:p-14 text-center overflow-hidden animate-in fade-in zoom-in duration-300 border-2 border-cyan-400/50 shadow-[0_0_80px_rgba(6,182,212,0.35)]">
            {/* Header Pill */}
            <div className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-xs md:text-sm font-bold tracking-widest text-cyan-300 bg-cyan-500/20 border border-cyan-400/40 mb-6 shadow-[0_0_20px_rgba(6,182,212,0.3)]">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
              DUET CSE FEST 2026 • PRIZE #{stageSerial}
            </div>

            {/* Circular Glowing SVG Countdown Gauge */}
            <div className="flex flex-col items-center justify-center relative">
              {/* Outer Shockwave Ripple on each second */}
              <div
                key={`shockwave-${countdownNumber}`}
                className="absolute w-64 h-64 md:w-80 md:h-80 rounded-full border-2 border-cyan-400/60 animate-ping opacity-40 pointer-events-none"
              />

              <div className="relative flex items-center justify-center w-64 h-64 md:w-76 md:h-76 my-4">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 200 200">
                  <defs>
                    <linearGradient id="timer-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#06b6d4" />
                      <stop offset="50%" stopColor="#8b5cf6" />
                      <stop offset="100%" stopColor="#ec4899" />
                    </linearGradient>
                    <filter id="timer-glow" x="-20%" y="-20%" width="140%" height="140%">
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
                    stroke="url(#timer-gradient)"
                    strokeWidth="11"
                    strokeDasharray={2 * Math.PI * 84}
                    strokeDashoffset={(2 * Math.PI * 84) * (1 - (countdownTotal > 0 ? countdownNumber / countdownTotal : 1))}
                    strokeLinecap="round"
                    filter="url(#timer-glow)"
                    className="transition-all duration-1000 ease-out"
                    fill="transparent"
                  />
                </svg>

                {/* Concentric Rotating Orbital Lines */}
                <div className="absolute inset-4 rounded-full border border-dashed border-cyan-400/35 orbital-ring-1 pointer-events-none" />
                <div className="absolute inset-8 rounded-full border border-purple-400/35 orbital-ring-2 pointer-events-none" />

                {/* Center Exploding Countdown Number with Shockwave Flash */}
                <div className="absolute flex flex-col items-center justify-center select-none pointer-events-none">
                  <span
                    key={countdownNumber}
                    className="text-8xl md:text-9xl font-black font-display bg-gradient-to-b from-white via-cyan-100 to-cyan-400 bg-clip-text text-transparent drop-shadow-[0_0_40px_rgba(6,182,212,0.95)] animate-in zoom-in-50 duration-300 leading-none"
                  >
                    {countdownNumber}
                  </span>
                  <span className="text-[11px] font-mono tracking-widest text-cyan-300/80 uppercase mt-1">
                    SECONDS
                  </span>
                </div>
              </div>

              {/* Linear Progress Bar */}
              <div className="w-full max-w-xs h-2 bg-slate-800 rounded-full overflow-hidden mt-3 border border-slate-700/60 p-0.5">
                <div
                  className="h-full bg-gradient-to-r from-cyan-400 via-purple-500 to-pink-500 rounded-full transition-all duration-1000 ease-out shadow-[0_0_12px_#06b6d4]"
                  style={{ width: `${(countdownNumber / (countdownTotal || 5)) * 100}%` }}
                />
              </div>

              <div className="mt-4 flex flex-col items-center gap-1.5">
                <span className="text-xs md:text-sm font-mono tracking-widest text-cyan-200/90 uppercase font-bold flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                  DRAW IN PROGRESS
                </span>
                <span className="text-xs text-slate-300 font-mono">
                  Selecting candidate from verified participants pool...
                </span>
              </div>
            </div>
          </div>
        )}

        {/* PHASE 3: HIGH-SPEED CYCLOTRON ROLLING SIMULATION */}
        {stagePhase === 'ROLLING' && (
          <div className="w-full glass-capsule rounded-3xl md:rounded-[40px] p-8 md:p-14 text-center overflow-hidden animate-in fade-in duration-200">
            {/* Header Pill */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs md:text-sm font-semibold tracking-wider text-cyan-300 bg-cyan-500/15 border border-cyan-400/30 mb-6">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
              PRIZE #{stageSerial} • ROLLING POOL
            </div>

            {/* Rolling Participant HUD Card */}
            {(() => {
              const activeCandidate = displayedCandidate || pendingCandidateRef.current;
              const fallbackItem = {
                name: activeCandidate?.name || 'DUET CSE Fest 2026',
                id: activeCandidate?.id ? `Roll: ${activeCandidate.id}` : 'CSE Department',
                type: activeCandidate?.type || 'PARTICIPANT',
              };
              const activePool = realParticipants.length > 0 ? realParticipants : [fallbackItem];
              const currentRolling = activePool[rollingIndex % activePool.length] || activePool[0];
              return (
                <div className="flex flex-col items-center justify-center">
                  <div className="glass-panel w-full max-w-lg p-6 md:p-8 rounded-2xl border border-cyan-400/50 shadow-2xl relative overflow-hidden">
                    <div className="text-xs text-cyan-300 tracking-widest font-semibold uppercase mb-2">
                      {currentRolling.type}
                    </div>
                    <h3 className="text-3xl md:text-5xl font-extrabold text-white font-display tracking-tight">
                      {currentRolling.name}
                    </h3>
                    <div className="mt-3 text-base md:text-lg font-mono text-cyan-300 font-semibold">
                      {currentRolling.id}
                    </div>
                  </div>

                  <div className="mt-6 flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
                    <span className="text-xs md:text-sm text-slate-300 font-mono tracking-wider">
                      Finalizing selection for Prize #{stageSerial}...
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* PHASE 4: DRAMATIC CANDIDATE REVEAL */}
        {stagePhase === 'CANDIDATE_REVEAL' && displayedCandidate && (
          <div className="w-full glass-capsule rounded-3xl md:rounded-[40px] p-8 md:p-14 text-center overflow-hidden animate-in fade-in zoom-in-95 duration-500">
            {/* Pill Header */}
            <div className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-xs md:text-sm font-bold tracking-widest text-cyan-300 bg-cyan-500/20 border border-cyan-400/40 mb-6 shadow-[0_0_20px_rgba(6,182,212,0.3)]">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
              SELECTED CANDIDATE • WINNER #{stageSerial}
            </div>

            {/* Candidate Content Box */}
            <div className="flex flex-col items-center">
              <div className="mb-4">
                <span
                  className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold tracking-wider uppercase border ${
                    displayedCandidate.type?.toLowerCase() === 'student'
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/40'
                      : displayedCandidate.type?.toLowerCase() === 'faculty'
                      ? 'bg-purple-500/20 text-purple-300 border-purple-400/40'
                      : 'bg-amber-500/20 text-amber-300 border-amber-400/40'
                  }`}
                >
                  <MaterialIcon
                    name={
                      displayedCandidate.type?.toLowerCase() === 'student'
                        ? 'school'
                        : displayedCandidate.type?.toLowerCase() === 'faculty'
                        ? 'workspace_premium'
                        : 'badge'
                    }
                    size={16}
                  />
                  {displayedCandidate.type?.toLowerCase() === 'faculty'
                    ? 'Faculty Member'
                    : displayedCandidate.type?.toLowerCase() === 'guest'
                    ? 'Guest'
                    : 'Student'}
                </span>
              </div>

              <h2 className="text-4xl sm:text-6xl md:text-7xl font-black text-white font-display tracking-tight leading-tight max-w-2xl drop-shadow-md">
                {displayedCandidate.name}
              </h2>

              <div className="mt-4">
                <span className="inline-block px-5 py-2 rounded-xl bg-slate-800/90 border border-slate-700 text-cyan-300 font-mono text-base md:text-xl font-bold tracking-wider shadow-inner">
                  {displayedCandidate.id ? `Roll: ${displayedCandidate.id}` : displayedCandidate.designation || 'DUET'}
                </span>
              </div>

              <div className="mt-8 flex items-center justify-center text-xs md:text-sm text-slate-300 gap-2.5 font-medium">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                Awaiting Event Controller Confirmation On Stage
              </div>
            </div>
          </div>
        )}

        {/* PHASE 5: UPGRADED OFFICIAL WINNER CELEBRATION CARD */}
        {stagePhase === 'WINNER_CONFIRMED' && displayedWinner && (
          <div className="w-full relative glass-capsule rounded-3xl md:rounded-[44px] p-8 md:p-14 text-center overflow-hidden animate-in fade-in zoom-in-95 duration-500 border-2 border-amber-400/60 shadow-[0_0_100px_rgba(245,158,11,0.45)]">
            {/* Background Radiant Sunburst Glow */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center -z-10">
              <div className="w-[500px] h-[500px] rounded-full bg-gradient-to-tr from-amber-500/20 via-yellow-400/25 to-transparent blur-[80px]" />
            </div>

            {/* Golden 3D Trophy Emblem with Multi-Layer Orbital Rings */}
            <div className="relative mb-6 flex items-center justify-center">
              {/* Outer pulsing ring */}
              <div className="absolute w-28 h-28 rounded-full bg-amber-400/20 animate-ping pointer-events-none" />

              {/* Dashed Golden Orbital Ring */}
              <div className="relative w-24 h-24 md:w-28 md:h-28 rounded-full border-2 border-dashed border-amber-300/60 flex items-center justify-center p-2 animate-spin [animation-duration:16s]">
                <div className="w-full h-full rounded-full border border-amber-400/40" />
              </div>

              {/* Center Metallic 3D Gold Trophy */}
              <div className="absolute w-20 h-20 md:w-24 md:h-24 rounded-full bg-gradient-to-tr from-amber-600 via-yellow-400 to-amber-300 flex items-center justify-center shadow-[0_0_50px_rgba(245,158,11,0.9)] transform hover:scale-105 transition-transform">
                <MaterialIcon name="emoji_events" size={46} className="text-slate-950 drop-shadow" />
              </div>
            </div>

            {/* Luxury Verification Ribbon */}
            <div className="flex items-center justify-center gap-2 mb-3">
              <span className="text-amber-300 text-lg animate-bounce">✨</span>
              <div className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-xs md:text-sm font-black tracking-widest text-amber-200 bg-amber-500/25 border border-amber-400/70 shadow-[0_0_25px_rgba(245,158,11,0.45)]">
                ★ OFFICIAL WINNER #{displayedWinner.serial} VERIFIED ★
              </div>
              <span className="text-amber-300 text-lg animate-bounce [animation-delay:200ms]">✨</span>
            </div>

            {/* Winner Name in Radiant Gold-Foil Typography */}
            <h1 className="text-5xl sm:text-7xl md:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-100 via-yellow-200 to-amber-400 font-display tracking-tight leading-tight my-4 drop-shadow-[0_0_45px_rgba(245,158,11,0.7)]">
              {displayedWinner.name}
            </h1>

            {/* Participant Category & ID Metadata Badges */}
            <div className="flex flex-wrap items-center justify-center gap-3 my-4">
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500/20 border border-amber-400/60 text-amber-200 font-bold text-sm md:text-base tracking-wide uppercase shadow-sm">
                <MaterialIcon
                  name={
                    displayedWinner.type?.toLowerCase() === 'student'
                      ? 'school'
                      : displayedWinner.type?.toLowerCase() === 'faculty'
                      ? 'workspace_premium'
                      : 'badge'
                  }
                  size={20}
                  className="text-amber-300"
                />
                {displayedWinner.type?.toLowerCase() === 'faculty'
                  ? 'Faculty Member'
                  : displayedWinner.type?.toLowerCase() === 'guest'
                  ? 'Guest'
                  : 'Student'}
              </span>

              <span className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-slate-900/90 border border-cyan-500/50 text-cyan-300 font-mono text-base md:text-lg font-bold shadow-sm">
                <MaterialIcon name="tag" size={18} className="text-cyan-400" />
                {displayedWinner.id ? `Roll: ${displayedWinner.id}` : displayedWinner.designation || 'DUET'}
              </span>
            </div>

            {/* Footer Guidance / Next Draw Status */}
            <p className="text-xs md:text-sm text-slate-300 mt-4 font-medium">
              {drawState?.status === 'COMPLETED'
                ? '🎉 ALL WINNERS OFFICIALLY CONFIRMED • CONGRATULATIONS TO EVERYONE!'
                : `Next Prize Draw: Winner #${drawState?.next_serial ?? stageSerial + 1} of ${
                    eventInfo?.total_winners ?? 10
                  }`}
            </p>

            {/* Replay Celebration Button */}
            <div className="mt-5">
              <button
                onClick={triggerGrandConfetti}
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-semibold text-amber-200 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/40 transition active:scale-95 shadow-sm"
              >
                <MaterialIcon name="celebration" size={16} />
                Celebrate Again
              </button>
            </div>
          </div>
        )}

        {/* PHASE 6: CANDIDATE IGNORED / ABSENT REDRAW */}
        {stagePhase === 'CANDIDATE_IGNORED' && ignoredInfo && (
          <div className="w-full glass-capsule rounded-3xl md:rounded-[40px] p-8 md:p-14 text-center overflow-hidden animate-in fade-in zoom-in duration-300 border border-rose-500/50 shadow-[0_0_60px_rgba(244,63,94,0.35)]">
            <div className="w-16 h-16 md:w-20 md:h-20 mx-auto rounded-full bg-rose-500/20 border border-rose-500/40 flex items-center justify-center mb-5">
              <MaterialIcon name="person_remove" size={40} className="text-rose-400" />
            </div>

            <div className="inline-flex items-center gap-2 px-4 py-1 rounded-full text-xs font-bold tracking-wider text-rose-300 bg-rose-500/20 border border-rose-400/40 mb-4">
              CANDIDATE DISQUALIFIED / ABSENT
            </div>

            <h3 className="text-3xl md:text-5xl font-extrabold text-white font-display">
              {ignoredInfo.name}
            </h3>

            <p className="text-sm md:text-base text-rose-300/90 font-medium mt-3">
              Reason: {ignoredInfo.reason}
            </p>

            <p className="text-xs md:text-sm text-slate-400 mt-6">
              Returning to stage queue for Prize #{ignoredInfo.next_serial}...
            </p>
          </div>
        )}

        {/* PHASE 7: RAFFLE COMPLETED */}
        {stagePhase === 'COMPLETED' && (
          <div className="w-full glass-capsule rounded-3xl md:rounded-[40px] p-8 md:p-14 text-center overflow-hidden animate-in fade-in duration-400">
            <div className="flex flex-col items-center justify-center py-6">
              <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-gradient-to-tr from-cyan-500 to-purple-500 flex items-center justify-center shadow-[0_0_40px_rgba(6,182,212,0.6)] mb-6">
                <MaterialIcon name="celebration" size={40} className="text-white" />
              </div>
              <h2 className="text-3xl md:text-5xl font-extrabold text-white font-display tracking-tight stage-title-gradient">
                RAFFLE COMPLETED!
              </h2>
              <p className="text-sm md:text-lg text-slate-300 mt-3 max-w-md">
                All {eventInfo?.total_winners || 10} winners of DUET CSE Fest 2026 have been officially drawn and confirmed.
              </p>
            </div>
          </div>
        )}

        {/* PHASE 8: IDLE / READY FOR DRAW */}
        {stagePhase === 'IDLE' && (
          <div className="w-full flex flex-col items-center justify-center animate-in fade-in duration-400">
            {drawState?.is_db_empty ? (
              <div className="glass-capsule rounded-3xl p-8 max-w-lg text-center border border-amber-500/30">
                <div className="w-12 h-12 mx-auto rounded-full bg-amber-500/20 text-amber-300 flex items-center justify-center mb-3">
                  <MaterialIcon name="storage" size={26} />
                </div>
                <h3 className="text-xl font-bold text-white mb-1">Database is Empty</h3>
                <p className="text-sm text-slate-300">
                  No participants are registered in the Supabase database. Please import the official participant roster in the controller console.
                </p>
                <div className="mt-4">
                  <a
                    href="/participants"
                    className="inline-block px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-mono font-bold text-cyan-300 border border-slate-700 transition"
                  >
                    View Participant Directory
                  </a>
                </div>
              </div>
            ) : (
              <>
                <DuetFestIntro
                  phaseText={
                    drawState?.status === 'PAUSED'
                      ? 'RAFFLE CURRENTLY PAUSED BY CONTROLLER'
                      : `READY • NEXT: WINNER #${String(drawState?.next_serial ?? stageSerial).padStart(2, '0')} OF ${
                          eventInfo?.total_winners ?? 10
                        }`
                  }
                />

                <div className="mt-4 flex items-center justify-center gap-3">
                  <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
                  <span className="text-xs sm:text-sm font-mono tracking-widest text-slate-300 uppercase">
                    {drawState?.status === 'PAUSED'
                      ? 'Awaiting Controller Resume'
                      : 'Stage Standby • Awaiting Controller Trigger'}
                  </span>
                </div>
              </>
            )}
          </div>
        )}

      </main>

      {/* Audience Page Credit Badge */}
      <footer className="fixed bottom-3 right-4 z-40 select-none pointer-events-none">
        <div className="text-[11px] sm:text-xs font-mono tracking-wider text-slate-400/90 bg-slate-900/80 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-slate-700/60 shadow-lg flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400/80 shadow-[0_0_6px_#22d3ee]" />
          <span>credit:</span>
          <span className="text-cyan-300 font-semibold lowercase tracking-normal">mohatamim</span>
        </div>
      </footer>
    </div>
  );
};
