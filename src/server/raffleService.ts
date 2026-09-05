import crypto from 'crypto';
import { AppConfig } from './config.ts';
import {
  Participant,
  WinnerResult,
  IgnoredCandidate,
  SessionState,
  PublicDrawState,
  ControllerState,
} from '../types.ts';
import { supabaseRepository } from './supabaseRepository.ts';
import { selectCandidateCryptographically, computePoolFingerprint } from './cryptoEngine.ts';
import { wsManager } from './websocketManager.ts';

export class RaffleService {
  private config: AppConfig;
  private isLocked: boolean = false;
  private session: SessionState;
  private participants: Participant[] = [];
  private lastWinner: WinnerResult | null = null;
  private lastEntropyProof: any = null;

  constructor(config: AppConfig) {
    this.config = config;

    // Initial session placeholder
    this.session = {
      event: config.EVENT_NAME,
      status: 'READY',
      total_winners: config.TOTAL_WINNERS,
      completed_winners: 0,
      next_serial: 1,
      current_candidate: null,
      last_action: 'SESSION_INITIALIZED',
      updated_at: new Date().toISOString(),
      is_db_empty: true,
    };

    // Async hydration from Supabase
    this.initAsync();
  }

  private async initAsync() {
    try {
      this.participants = await supabaseRepository.getParticipants();
      const existingSession = await supabaseRepository.getSession();
      const resultsData = await supabaseRepository.getResults();

      if (existingSession) {
        this.session = existingSession;
      }
      this.session.is_db_empty = this.participants.length === 0;

      if (resultsData.results.length > 0) {
        this.lastWinner = resultsData.results[resultsData.results.length - 1];
      }

      await supabaseRepository.appendAudit('SYSTEM_SERVICE_HYDRATED', {
        participants_count: this.participants.length,
        completed_winners: this.session.completed_winners,
        is_db_empty: this.session.is_db_empty,
      });

      console.log(
        `[RaffleService] Initialized with ${this.participants.length} participants (DB Empty: ${this.session.is_db_empty})`
      );
    } catch (err: any) {
      console.error('[RaffleService] Hydration error:', err.message);
    }
  }

  public async reloadParticipants(): Promise<Participant[]> {
    this.participants = await supabaseRepository.getParticipants();
    this.session.is_db_empty = this.participants.length === 0;
    return this.participants;
  }

  public getPublicState(): PublicDrawState {
    const candidatePresentation = this.session.current_candidate
      ? {
          type: this.session.current_candidate.type,
          id: this.session.current_candidate.id,
          name: this.session.current_candidate.name,
          designation: this.session.current_candidate.designation,
        }
      : null;

    return {
      event: this.session.event,
      status: this.session.status,
      total_winners: this.session.total_winners,
      completed_winners: this.session.completed_winners,
      next_serial: this.session.next_serial,
      current_candidate: candidatePresentation,
      last_winner: this.lastWinner,
      last_action: this.session.last_action,
      is_db_empty: this.participants.length === 0,
    };
  }

  public async getControllerState(): Promise<ControllerState> {
    const total = this.participants.length;
    const isDbEmpty = total === 0;
    let eligibleCount = 0;
    let studentCount = 0;
    let facultyCount = 0;
    let guestCount = 0;

    for (const p of this.participants) {
      if (p.eligible === 1) eligibleCount++;
      if (p.type === 'student') studentCount++;
      else if (p.type === 'faculty') facultyCount++;
      else if (p.type === 'guest') guestCount++;
    }

    const resultsData = await supabaseRepository.getResults();
    const pageAccess = await supabaseRepository.getPageAccessSettings();
    const visitorAnalytics = supabaseRepository.getVisitorAnalytics();
    const registrationRequests = await supabaseRepository.getRegistrationRequests();
    const pendingRegCount = registrationRequests.filter((r) => r.status === 'pending').length;

    return {
      ...this.session,
      is_db_empty: isDbEmpty,
      eligible_count: eligibleCount,
      total_participants: total,
      students_count: studentCount,
      faculty_count: facultyCount,
      guest_count: guestCount,
      winners_count: resultsData.results.length,
      ignored_count: resultsData.ignored.length,
      is_locked: this.isLocked,
      has_interrupted: this.session.status === 'INTERRUPTED',
      winners: resultsData.results,
      page_access: pageAccess,
      visitor_analytics: visitorAnalytics,
      pending_registrations_count: pendingRegCount,
    };
  }

  public getRollingPool(limit = 150): Array<{ name: string; id: string; type: string }> {
    const eligible = this.participants.filter((p) => p.eligible === 1);
    if (eligible.length === 0) {
      return [];
    }
    return eligible.slice(0, limit).map((p) => ({
      name: p.name,
      id: p.id ? `Roll: ${p.id}` : p.designation || 'DUET CSE',
      type: p.type.toUpperCase(),
    }));
  }

  public async startDraw(): Promise<{ success: boolean; message: string; candidate?: Participant }> {
    if (this.isLocked) {
      return { success: false, message: 'DRAW_IN_PROGRESS: Another draw operation is currently locked.' };
    }

    if (this.participants.length === 0) {
      return {
        success: false,
        message: 'DATABASE_EMPTY: The participant database in Supabase is empty. Please import participants before drawing.',
      };
    }

    if (this.session.status === 'COMPLETED' || this.session.completed_winners >= this.session.total_winners) {
      return { success: false, message: 'RAFFLE_COMPLETED: All target winners have already been drawn.' };
    }

    if (this.session.status === 'WAITING_CONFIRMATION' && this.session.current_candidate) {
      return {
        success: false,
        message: 'WAITING_CONFIRMATION: A candidate is currently awaiting confirmation or ignore decision.',
      };
    }

    if (this.session.status === 'PAUSED') {
      return { success: false, message: 'DRAW_PAUSED: The raffle is currently paused. Please resume first.' };
    }

    if (this.session.status === 'INTERRUPTED') {
      return {
        success: false,
        message: 'INTERRUPTED_DRAW: An interrupted draw was detected. Please restore or cancel candidate first.',
      };
    }

    // Refresh participants from Supabase repository
    await this.reloadParticipants();
    const filteredEligible = this.participants.filter((p) => p.eligible === 1);

    if (filteredEligible.length === 0) {
      return { success: false, message: 'NO_ELIGIBLE_PARTICIPANTS: No eligible candidates remain in the pool.' };
    }

    // Fisher-Yates multi-pass pre-shuffle
    const shufflePasses = this.config.SHUFFLE_PASSES || 7;
    const shuffledPool = [...filteredEligible];
    const totalEligible = shuffledPool.length;

    for (let pass = 1; pass <= shufflePasses; pass++) {
      for (let i = totalEligible - 1; i > 0; i--) {
        const j = crypto.randomInt(0, i + 1);
        const temp = shuffledPool[i];
        shuffledPool[i] = shuffledPool[j];
        shuffledPool[j] = temp;
      }
    }

    this.isLocked = true;

    try {
      // Cryptographically secure zero-modulo-bias rejection sampling selection
      const cryptoResult = selectCandidateCryptographically(
        shuffledPool,
        this.config.SECRET_KEY,
        this.session.last_action
      );

      const selectedCandidate = cryptoResult.selectedParticipant;
      this.lastEntropyProof = cryptoResult.entropyProof;

      // Update and persist state
      this.session.status = 'DRAWING';
      this.session.current_candidate = selectedCandidate;
      this.session.last_action = `CANDIDATE_SELECTED_ROUND_${this.session.next_serial}`;
      this.session.updated_at = new Date().toISOString();
      await supabaseRepository.saveSession(this.session);

      await supabaseRepository.appendAudit('DRAW_STARTED_CRYPTOGRAPHIC_SELECTION', {
        next_serial: this.session.next_serial,
        shuffle_passes: shufflePasses,
        eligible_pool_size: shuffledPool.length,
        selected_index: cryptoResult.selectedIndex,
        entropy_proof: cryptoResult.entropyProof,
        selected_candidate: {
          name: selectedCandidate.name,
          id: selectedCandidate.id,
          type: selectedCandidate.type,
        },
        countdown_seconds: this.config.DRAW_COUNTDOWN_SECONDS,
      });

      // Broadcast candidate payload to audience
      const candidatePayload = {
        type: selectedCandidate.type,
        id: selectedCandidate.id,
        name: selectedCandidate.name,
        designation: selectedCandidate.designation,
        serial: this.session.next_serial,
      };

      const drawStartPayload = {
        serial: this.session.next_serial,
        countdown_seconds: this.config.DRAW_COUNTDOWN_SECONDS,
        name_roll_ms: this.config.NAME_ROLL_DURATION_MS,
        shuffle_passes: shufflePasses,
        candidate: candidatePayload,
      };

      wsManager.broadcastAudience('DRAW_START', drawStartPayload);
      wsManager.broadcastController('DRAW_START', drawStartPayload);

      const controllerState = await this.getControllerState();
      wsManager.broadcastController('STATE_UPDATED', controllerState);

      // Sequence transition for stage presentation
      const sequenceDurationMs = 1000 + this.config.DRAW_COUNTDOWN_SECONDS * 1000 + 2000;
      setTimeout(async () => {
        if (this.session.status === 'DRAWING' && this.session.current_candidate) {
          this.session.status = 'WAITING_CONFIRMATION';
          this.session.last_action = 'CANDIDATE_REVEALED_ON_STAGE';
          this.session.updated_at = new Date().toISOString();
          await supabaseRepository.saveSession(this.session);

          await supabaseRepository.appendAudit('CANDIDATE_REVEALED_FOR_DECISION', {
            name: selectedCandidate.name,
            id: selectedCandidate.id,
            type: selectedCandidate.type,
            serial: this.session.next_serial,
          });

          wsManager.broadcastAudience('CANDIDATE_SELECTED', candidatePayload);
          const updatedCtrlState = await this.getControllerState();
          wsManager.broadcastController('STATE_UPDATED', updatedCtrlState);
        }
      }, sequenceDurationMs);

      return {
        success: true,
        message: `Draw pipeline executed: candidate ${selectedCandidate.name} chosen with zero-modulo-bias cryptographic selection.`,
        candidate: selectedCandidate,
      };
    } finally {
      this.isLocked = false;
    }
  }

  public async confirmWinner(): Promise<{ success: boolean; message: string; winner?: WinnerResult }> {
    if (this.isLocked) {
      return { success: false, message: 'DRAW_IN_PROGRESS: Server is processing another transaction.' };
    }

    if (!this.session.current_candidate) {
      return { success: false, message: 'NO_CANDIDATE: No candidate is currently selected to confirm.' };
    }

    if (
      this.session.status !== 'WAITING_CONFIRMATION' &&
      this.session.status !== 'CANDIDATE_SELECTED' &&
      this.session.status !== 'DRAWING'
    ) {
      return { success: false, message: `INVALID_STATE: Cannot confirm in current state (${this.session.status}).` };
    }

    this.isLocked = true;

    try {
      const candidate = this.session.current_candidate;

      // 1. Mark participant ineligible in Supabase (eligible = 0)
      await supabaseRepository.markParticipantIneligible(candidate);
      await this.reloadParticipants();

      // 3. Record official winner in Supabase
      const winner: WinnerResult = {
        serial: this.session.next_serial,
        type: candidate.type,
        id: candidate.id,
        name: candidate.name,
        designation: candidate.designation,
        status: 'winner',
        drawn_at: new Date().toISOString(),
      };

      await supabaseRepository.saveWinner(winner, this.lastEntropyProof);
      this.lastWinner = winner;

      // 4. Update session
      this.session.completed_winners += 1;
      this.session.next_serial += 1;
      this.session.current_candidate = null;
      this.session.status =
        this.session.completed_winners >= this.session.total_winners ? 'COMPLETED' : 'WINNER_CONFIRMED';
      this.session.last_action = `WINNER_#${winner.serial}_CONFIRMED`;
      this.session.updated_at = new Date().toISOString();
      await supabaseRepository.saveSession(this.session);

      // 5. Audit
      await supabaseRepository.appendAudit('WINNER_CONFIRMED', {
        serial: winner.serial,
        name: winner.name,
        id: winner.id,
        type: winner.type,
        completed_winners: this.session.completed_winners,
        total_winners: this.session.total_winners,
      });

      // 6. Broadcast
      wsManager.broadcastAudience('WINNER_CONFIRMED', {
        winner,
        completed_winners: this.session.completed_winners,
        total_winners: this.session.total_winners,
        is_completed: this.session.status === 'COMPLETED',
      });

      const ctrlState = await this.getControllerState();
      wsManager.broadcastController('STATE_UPDATED', ctrlState);

      return {
        success: true,
        message: `Winner #${winner.serial} confirmed and committed to Supabase.`,
        winner,
      };
    } finally {
      this.isLocked = false;
    }
  }

  public async ignoreCandidate(reason: string = 'absent'): Promise<{ success: boolean; message: string }> {
    if (this.isLocked) {
      return { success: false, message: 'DRAW_IN_PROGRESS: Server is processing another transaction.' };
    }

    if (!this.session.current_candidate) {
      return { success: false, message: 'NO_CANDIDATE: No candidate is currently selected to ignore.' };
    }

    this.isLocked = true;

    try {
      const candidate = this.session.current_candidate;

      // Mark ineligible in Supabase (eligible = 0)
      await supabaseRepository.markParticipantIneligible(candidate);
      await this.reloadParticipants();

      // Record in ignored table
      const ignoredRecord: IgnoredCandidate = {
        serial: null,
        type: candidate.type,
        id: candidate.id,
        name: candidate.name,
        designation: candidate.designation,
        status: 'ignored',
        reason,
        drawn_at: new Date().toISOString(),
      };
      await supabaseRepository.saveIgnored(ignoredRecord);

      // Reset candidate, keep same serial number!
      this.session.current_candidate = null;
      this.session.status = 'IGNORED';
      this.session.last_action = `CANDIDATE_${candidate.name}_IGNORED`;
      this.session.updated_at = new Date().toISOString();
      await supabaseRepository.saveSession(this.session);

      await supabaseRepository.appendAudit('CANDIDATE_IGNORED', {
        name: candidate.name,
        id: candidate.id,
        type: candidate.type,
        reason,
      });

      // Broadcast
      wsManager.broadcastAudience('CANDIDATE_IGNORED', {
        name: candidate.name,
        reason,
        next_serial: this.session.next_serial,
      });

      const ctrlState = await this.getControllerState();
      wsManager.broadcastController('STATE_UPDATED', ctrlState);

      return {
        success: true,
        message: `Candidate ${candidate.name} has been marked as ignored and ineligible in Supabase.`,
      };
    } finally {
      this.isLocked = false;
    }
  }

  public async pause(): Promise<{ success: boolean; message: string }> {
    if (this.session.status === 'PAUSED') {
      return { success: true, message: 'Already paused.' };
    }
    this.session.status = 'PAUSED';
    this.session.last_action = 'DRAW_PAUSED';
    this.session.updated_at = new Date().toISOString();
    await supabaseRepository.saveSession(this.session);
    await supabaseRepository.appendAudit('DRAW_PAUSED');

    wsManager.broadcastAudience('PAUSED', {});
    const ctrlState = await this.getControllerState();
    wsManager.broadcastController('STATE_UPDATED', ctrlState);
    return { success: true, message: 'Raffle paused.' };
  }

  public async resume(): Promise<{ success: boolean; message: string }> {
    if (this.session.status !== 'PAUSED') {
      return { success: true, message: 'Raffle is not paused.' };
    }
    this.session.status = this.session.current_candidate ? 'WAITING_CONFIRMATION' : 'READY';
    this.session.last_action = 'DRAW_RESUMED';
    this.session.updated_at = new Date().toISOString();
    await supabaseRepository.saveSession(this.session);
    await supabaseRepository.appendAudit('DRAW_RESUMED');

    wsManager.broadcastAudience('RESUMED', {});
    const ctrlState = await this.getControllerState();
    wsManager.broadcastController('STATE_UPDATED', ctrlState);
    return { success: true, message: 'Raffle resumed.' };
  }

  public async restoreInterrupted(): Promise<{ success: boolean; message: string }> {
    if (this.session.status !== 'INTERRUPTED' || !this.session.current_candidate) {
      return { success: false, message: 'No interrupted candidate to restore.' };
    }
    this.session.status = 'WAITING_CONFIRMATION';
    this.session.last_action = 'INTERRUPTED_CANDIDATE_RESTORED';
    this.session.updated_at = new Date().toISOString();
    await supabaseRepository.saveSession(this.session);
    await supabaseRepository.appendAudit('INTERRUPTED_CANDIDATE_RESTORED', {
      candidate: this.session.current_candidate,
    });

    wsManager.broadcastAudience('CANDIDATE_SELECTED', {
      type: this.session.current_candidate.type,
      id: this.session.current_candidate.id,
      name: this.session.current_candidate.name,
      designation: this.session.current_candidate.designation,
      serial: this.session.next_serial,
    });
    const ctrlState = await this.getControllerState();
    wsManager.broadcastController('STATE_UPDATED', ctrlState);
    return { success: true, message: 'Interrupted candidate restored to active state.' };
  }

  public async cancelInterrupted(): Promise<{ success: boolean; message: string }> {
    if (this.session.status !== 'INTERRUPTED') {
      return { success: false, message: 'No interrupted draw to cancel.' };
    }
    const oldCandidate = this.session.current_candidate;
    this.session.current_candidate = null;
    this.session.status = 'READY';
    this.session.last_action = 'INTERRUPTED_DRAW_CANCELLED';
    this.session.updated_at = new Date().toISOString();
    await supabaseRepository.saveSession(this.session);
    await supabaseRepository.appendAudit('INTERRUPTED_DRAW_CANCELLED', { candidate: oldCandidate });

    wsManager.broadcastAudience('RESET', {});
    const ctrlState = await this.getControllerState();
    wsManager.broadcastController('STATE_UPDATED', ctrlState);
    return { success: true, message: 'Interrupted draw cancelled. Participant remains eligible.' };
  }

  public async resetSession(
    typedConfirmation: string
  ): Promise<{ success: boolean; message: string }> {
    if (typedConfirmation !== 'RESET') {
      return {
        success: false,
        message: 'CONFIRMATION_MISMATCH: You must explicitly type "RESET" to confirm resetting the raffle session.',
      };
    }

    // Restore all participant eligibility in Supabase
    await supabaseRepository.restoreAllEligibility();
    await this.reloadParticipants();

    // Clear results in Supabase
    await supabaseRepository.clearResults();
    this.lastWinner = null;

    // Reset session in Supabase
    this.session = {
      event: this.config.EVENT_NAME,
      status: 'READY',
      total_winners: this.config.TOTAL_WINNERS,
      completed_winners: 0,
      next_serial: 1,
      current_candidate: null,
      last_action: 'SESSION_RESET_TO_INITIAL',
      updated_at: new Date().toISOString(),
      is_db_empty: this.participants.length === 0,
    };
    await supabaseRepository.saveSession(this.session);

    await supabaseRepository.appendAudit('SESSION_RESET', { reset_at: new Date().toISOString() });

    wsManager.broadcastAudience('RESET', { message: 'A new raffle session has been initiated.' });
    const ctrlState = await this.getControllerState();
    wsManager.broadcastController('STATE_UPDATED', ctrlState);

    return {
      success: true,
      message: 'Raffle session reset successfully. All winner results cleared and participants restored.',
    };
  }

  public async setParticipantEligibility(
    candidate: { id?: string | null; name: string; type?: string },
    eligible: number
  ): Promise<{ success: boolean; message: string }> {
    const res = await supabaseRepository.setParticipantEligibility(candidate, eligible);
    await this.reloadParticipants();
    const ctrlState = await this.getControllerState();
    wsManager.broadcastController('STATE_UPDATED', ctrlState);
    return res;
  }

  public async searchParticipants(
    query: string | { q?: string; type?: string; status?: string } = '',
    type: string = 'all',
    status: string = 'all'
  ) {
    let qStr = '';
    let tStr = type;
    let sStr = status;

    if (typeof query === 'object' && query !== null) {
      qStr = query.q || '';
      tStr = query.type || 'all';
      sStr = query.status || 'all';
    } else {
      qStr = String(query || '');
    }

    const resultsData = await supabaseRepository.getResults();

    const winnerIds = new Set(
      resultsData.results.filter((w) => !!w.id).map((w) => String(w.id).trim().toLowerCase())
    );
    const winnerCombosWithoutId = new Set(
      resultsData.results
        .filter((w) => !w.id)
        .map((w) => `${w.name.trim().toLowerCase()}_${w.type.toLowerCase()}`)
    );
    const winnerSerialMap = new Map<string, number>();
    resultsData.results.forEach((w) => {
      if (w.id) {
        winnerSerialMap.set(`id_${String(w.id).trim().toLowerCase()}`, w.serial);
      } else {
        winnerSerialMap.set(`combo_${w.name.trim().toLowerCase()}_${w.type.toLowerCase()}`, w.serial);
      }
    });

    const ignoredIds = new Set(
      resultsData.ignored.filter((i) => !!i.id).map((i) => String(i.id).trim().toLowerCase())
    );
    const ignoredCombosWithoutId = new Set(
      resultsData.ignored
        .filter((i) => !i.id)
        .map((i) => `${i.name.trim().toLowerCase()}_${i.type.toLowerCase()}`)
    );

    const q = qStr.trim().toLowerCase();

    let eligibleTotal = 0;
    let winnerTotal = 0;
    let ignoredTotal = 0;

    const allMapped = this.participants.map((p) => {
      const pIdNorm = p.id ? String(p.id).trim().toLowerCase() : '';
      const pCombo = `${p.name.trim().toLowerCase()}_${p.type.toLowerCase()}`;

      let isWinner = false;
      let winSerial: number | undefined = undefined;

      if (pIdNorm) {
        if (winnerIds.has(pIdNorm)) {
          isWinner = true;
          winSerial = winnerSerialMap.get(`id_${pIdNorm}`);
        }
      } else if (winnerCombosWithoutId.has(pCombo)) {
        isWinner = true;
        winSerial = winnerSerialMap.get(`combo_${pCombo}`);
      }

      let isIgnored = false;
      if (!isWinner) {
        if (pIdNorm) {
          isIgnored = ignoredIds.has(pIdNorm) || p.eligible === 0;
        } else {
          isIgnored = ignoredCombosWithoutId.has(pCombo) || p.eligible === 0;
        }
      }

      let derivedStatus: 'eligible' | 'winner' | 'ignored' = 'eligible';

      if (isWinner) {
        derivedStatus = 'winner';
        winnerTotal++;
      } else if (isIgnored) {
        derivedStatus = 'ignored';
        ignoredTotal++;
      } else {
        derivedStatus = 'eligible';
        eligibleTotal++;
      }

      return {
        ...p,
        status: derivedStatus,
        winning_serial: winSerial,
      };
    });

    const filtered = allMapped.filter((p) => {
      if (tStr && tStr !== 'all' && p.type.toLowerCase() !== tStr.toLowerCase()) return false;

      if (sStr === 'eligible' && p.status !== 'eligible') return false;
      if (sStr === 'winner' && p.status !== 'winner') return false;
      if (sStr === 'ignored' && p.status !== 'ignored') return false;

      if (q) {
        const matchId = p.id ? String(p.id).toLowerCase().includes(q) : false;
        const matchName = p.name.toLowerCase().includes(q);
        const matchDesig = p.designation ? p.designation.toLowerCase().includes(q) : false;
        if (!matchId && !matchName && !matchDesig) return false;
      }

      return true;
    });

    return {
      total: allMapped.length,
      filtered_total: filtered.length,
      is_db_empty: allMapped.length === 0,
      counts: {
        total: allMapped.length,
        eligible: eligibleTotal,
        winner: winnerTotal,
        ignored: ignoredTotal,
      },
      participants: filtered,
    };
  }

  public async searchParticipantsPaginated(params: {
    q?: string;
    type?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 15));
    const searchRes = await this.searchParticipants(
      params.q || '',
      params.type || 'all',
      params.status || 'all'
    );
    const filteredTotal = searchRes.filtered_total ?? searchRes.participants.length;
    const totalPages = Math.max(1, Math.ceil(filteredTotal / limit));
    const offset = (page - 1) * limit;
    const paginatedParticipants = searchRes.participants.slice(offset, offset + limit);

    return {
      total: searchRes.total,
      filtered_total: filteredTotal,
      is_db_empty: searchRes.is_db_empty,
      page,
      limit,
      total_pages: totalPages,
      counts: searchRes.counts,
      participants: paginatedParticipants,
    };
  }
}
