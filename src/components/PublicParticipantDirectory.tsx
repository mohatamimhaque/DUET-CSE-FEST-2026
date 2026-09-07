import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api.ts';
import { Participant } from '../types.ts';
import { MaterialIcon } from './MaterialIcon.tsx';

interface ParticipantRow extends Participant {
  status: 'eligible' | 'winner' | 'ignored';
  winning_serial?: number;
}

export const PublicParticipantDirectory: React.FC = () => {
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(15);
  const [totalRecords, setTotalRecords] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [counts, setCounts] = useState<{ total: number; eligible: number; winner: number; ignored: number }>({
    total: 0,
    eligible: 0,
    winner: 0,
    ignored: 0,
  });

  // Self-Registration Modal State
  const [selfRegEnabled, setSelfRegEnabled] = useState<boolean>(true);
  const [showRegisterModal, setShowRegisterModal] = useState<boolean>(false);
  const [regName, setRegName] = useState<string>('');
  const [regId, setRegId] = useState<string>('');
  const [regType, setRegType] = useState<string>('student');
  const [regDesignation, setRegDesignation] = useState<string>('');
  const [regSubmitting, setRegSubmitting] = useState<boolean>(false);
  const [regFeedback, setRegFeedback] = useState<{ success?: boolean; message?: string } | null>(null);

  // Participant Name Correction Modal State
  const [editConfig, setEditConfig] = useState<{ allow_participant_edit: boolean; allowed_edit_series: string[] }>({
    allow_participant_edit: true,
    allowed_edit_series: ['20', '21', '22', '23', '24'],
  });
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [editStudentId, setEditStudentId] = useState<string>('');
  const [editCurrentName, setEditCurrentName] = useState<string>('');
  const [editRequestedName, setEditRequestedName] = useState<string>('');
  const [editReason, setEditReason] = useState<string>('');
  const [editSubmitting, setEditSubmitting] = useState<boolean>(false);
  const [editFeedback, setEditFeedback] = useState<{ success?: boolean; message?: string } | null>(null);

  const getStudentSeries = (id?: string | null): string => {
    if (!id) return '';
    const clean = String(id).trim();
    const m = clean.match(/^\d{2}/);
    return m ? m[0] : clean.slice(0, 2);
  };

  const isSeriesAllowed = (series: string): boolean => {
    if (!editConfig.allow_participant_edit) return false;
    const allowed = editConfig.allowed_edit_series || [];
    if (allowed.length === 0 || allowed.includes('*') || allowed.includes('all')) return true;
    return allowed.includes(series);
  };

  const handleOpenEditModal = (p?: ParticipantRow) => {
    if (p) {
      setEditStudentId(p.id || '');
      setEditCurrentName(p.name || '');
      setEditRequestedName(p.name || '');
    } else {
      setEditStudentId('');
      setEditCurrentName('');
      setEditRequestedName('');
    }
    setEditReason('');
    setEditFeedback(null);
    setShowEditModal(true);
  };

  // Check if self-registration and edit settings are enabled by controller
  useEffect(() => {
    let isMounted = true;
    const checkSettings = async () => {
      try {
        const [pageRes, editRes] = await Promise.all([
          api.getPageAccessStatus('participants'),
          api.getParticipantEditConfig(),
        ]);
        if (isMounted) {
          if (pageRes.settings) {
            setSelfRegEnabled(pageRes.settings.self_registration !== false);
            if (pageRes.settings.allow_participant_edit !== undefined) {
              setEditConfig((prev) => ({
                ...prev,
                allow_participant_edit: pageRes.settings.allow_participant_edit !== false,
                allowed_edit_series: pageRes.settings.allowed_edit_series || prev.allowed_edit_series,
              }));
            }
          }
          if (editRes) {
            setEditConfig({
              allow_participant_edit: editRes.allow_participant_edit !== false,
              allowed_edit_series: editRes.allowed_edit_series || ['20', '21', '22', '23', '24'],
            });
          }
        }
      } catch {
        // Fallback
      }
    };

    checkSettings();

    // Listen to real-time events for instant update
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource('/api/public/events');
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'PAGE_ACCESS_UPDATED' && data.payload) {
            if (data.payload.self_registration !== undefined) {
              setSelfRegEnabled(data.payload.self_registration !== false);
            }
            if (data.payload.allow_participant_edit !== undefined || data.payload.allowed_edit_series !== undefined) {
              setEditConfig({
                allow_participant_edit: data.payload.allow_participant_edit !== false,
                allowed_edit_series: data.payload.allowed_edit_series || ['20', '21', '22', '23', '24'],
              });
            }
          }
          if (data.type === 'PARTICIPANTS_UPDATED') {
            fetchData();
          }
        } catch {}
      };
    } catch {}

    return () => {
      isMounted = false;
      if (eventSource) eventSource.close();
    };
  }, []);

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editConfig.allow_participant_edit) {
      setEditFeedback({
        success: false,
        message: 'Student name corrections are currently closed by the event controller.',
      });
      return;
    }
    const cleanId = editStudentId.trim();
    const cleanReq = editRequestedName.trim();
    if (!cleanId || !cleanReq) {
      setEditFeedback({ success: false, message: 'Student ID and requested name are required.' });
      return;
    }
    const series = getStudentSeries(cleanId);
    if (!isSeriesAllowed(series)) {
      setEditFeedback({
        success: false,
        message: `Series ${series || '??'} is not currently authorized for name editing.`,
      });
      return;
    }
    if (editCurrentName && cleanReq.toLowerCase() === editCurrentName.trim().toLowerCase()) {
      setEditFeedback({
        success: false,
        message: 'Requested name must be different from the currently registered name.',
      });
      return;
    }

    setEditSubmitting(true);
    setEditFeedback(null);
    try {
      const res = await api.requestParticipantEdit({
        student_id: cleanId,
        current_name: editCurrentName.trim() || undefined,
        requested_name: cleanReq,
        reason: editReason.trim() || undefined,
      });
      setEditFeedback({ success: true, message: res.message });
      setEditReason('');
    } catch (err: any) {
      setEditFeedback({ success: false, message: err.message });
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selfRegEnabled) {
      setRegFeedback({ success: false, message: 'Self-registration is currently closed by the administrator.' });
      return;
    }
    if (!regName.trim()) return;
    setRegSubmitting(true);
    setRegFeedback(null);
    try {
      const res = await api.registerParticipant({
        name: regName.trim(),
        external_id: regId.trim() || undefined,
        type: regType,
        designation: regDesignation.trim() || undefined,
      });
      setRegFeedback({ success: true, message: res.message });
      setRegName('');
      setRegId('');
      setRegDesignation('');
      fetchData();
    } catch (err: any) {
      setRegFeedback({ success: false, message: err.message });
    } finally {
      setRegSubmitting(false);
    }
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getPublicParticipants({
        q: searchQuery,
        type: selectedType,
        status: selectedStatus,
        page: currentPage,
        limit: pageSize,
      });

      setParticipants(res.participants);
      setTotalRecords(res.filtered_total);
      setTotalPages(res.total_pages);
      if (res.counts) {
        setCounts(res.counts);
      }
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  }, [searchQuery, selectedType, selectedStatus, currentPage, pageSize]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset to page 1 on filter or search change
  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    setCurrentPage(1);
  };

  const handleTypeChange = (val: string) => {
    setSelectedType(val);
    setCurrentPage(1);
  };

  const handleStatusChange = (val: string) => {
    setSelectedStatus(val);
    setCurrentPage(1);
  };

  return (
    <div className="min-h-screen w-full bg-[#070c18] text-slate-100 flex flex-col p-4 sm:p-6 md:p-10 relative overflow-hidden">
      {/* Background Volumetric Glows */}
      <div className="absolute inset-0 pointer-events-none -z-10 flex items-center justify-center">
        <div className="w-[60vw] h-[60vw] max-w-[800px] max-h-[800px] rounded-full bg-cyan-600/10 blur-[140px]" />
        <div className="w-[50vw] h-[50vw] max-w-[700px] max-h-[700px] rounded-full bg-purple-600/10 blur-[130px]" />
      </div>

      <div className="w-full max-w-6xl mx-auto flex-1 flex flex-col space-y-6">
        {/* Navigation / Top Bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-cyan-500/20">
          <div className="flex items-center gap-3">
            <a
              href="/"
              className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-700/80 text-cyan-300 transition flex items-center gap-1.5 text-xs font-mono font-bold"
              title="Return to Main Stage"
            >
              <MaterialIcon name="arrow_back" size={18} />
              <span>STAGE</span>
            </a>

            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold tracking-widest text-cyan-400 uppercase">
                  DUET CSE FEST 2026
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-400/30">
                  PUBLIC VERIFICATION
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-black font-display text-white tracking-tight">
                Participant Eligibility Directory
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            {editConfig.allow_participant_edit && (
              <button
                type="button"
                onClick={() => handleOpenEditModal()}
                className="px-3.5 py-2 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/40 text-purple-300 hover:text-white text-xs font-bold font-mono transition flex items-center gap-1.5 shadow-sm"
                title="Submit a student name correction for controller verification"
              >
                <MaterialIcon name="edit" size={16} />
                <span>NAME CORRECTION</span>
              </button>
            )}

            {selfRegEnabled ? (
              <button
                type="button"
                onClick={() => {
                  setRegFeedback(null);
                  setShowRegisterModal(true);
                }}
                className="px-3.5 py-2 rounded-xl bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 text-cyan-300 text-xs font-bold font-mono transition flex items-center gap-1.5 shadow-sm"
              >
                <MaterialIcon name="person_add" size={16} />
                <span>REGISTER ENTRY</span>
              </button>
            ) : (
              <div
                className="px-3 py-1.5 rounded-xl bg-slate-900/90 border border-amber-500/30 text-amber-300 text-xs font-bold font-mono flex items-center gap-1.5 shadow-sm"
                title="Participant self-registration is closed by the event administrator"
              >
                <MaterialIcon name="lock" size={15} className="text-amber-400" />
                <span>REGISTRATION CLOSED</span>
              </div>
            )}

            <a
              href="/results"
              className="px-3.5 py-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-700/80 text-amber-300 hover:text-amber-200 text-xs font-bold font-mono transition flex items-center gap-1.5"
            >
              <MaterialIcon name="emoji_events" size={16} />
              <span>OFFICIAL WINNERS</span>
            </a>

            <button
              type="button"
              onClick={fetchData}
              title="Refresh Directory"
              className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-white transition"
            >
              <MaterialIcon name="refresh" size={18} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Metric Summary Ribbon */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <div className="glass-panel p-4 rounded-2xl border border-cyan-500/20">
            <span className="text-[11px] font-mono tracking-wider text-slate-400 uppercase">Total Pool</span>
            <div className="text-xl sm:text-2xl font-black font-display text-white mt-0.5">
              {counts.total}
            </div>
          </div>

          <div className="glass-panel p-4 rounded-2xl border border-emerald-500/30">
            <span className="text-[11px] font-mono tracking-wider text-emerald-400 uppercase">Eligible for Draw</span>
            <div className="text-xl sm:text-2xl font-black font-display text-emerald-300 mt-0.5">
              {counts.eligible}
            </div>
          </div>

          <div className="glass-panel p-4 rounded-2xl border border-amber-500/30">
            <span className="text-[11px] font-mono tracking-wider text-amber-400 uppercase">Confirmed Winners</span>
            <div className="text-xl sm:text-2xl font-black font-display text-amber-300 mt-0.5">
              {counts.winner}
            </div>
          </div>

          <div className="glass-panel p-4 rounded-2xl border border-rose-500/30">
            <span className="text-[11px] font-mono tracking-wider text-rose-400 uppercase">Disqualified / Absent</span>
            <div className="text-xl sm:text-2xl font-black font-display text-rose-300 mt-0.5">
              {counts.ignored}
            </div>
          </div>
        </div>

        {/* Student Name Edit Announcement Banner */}
        {editConfig.allow_participant_edit ? (
          <div className="p-3.5 sm:p-4 rounded-2xl bg-cyan-950/40 border border-cyan-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-start sm:items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-400/30 shrink-0">
                <MaterialIcon name="how_to_reg" size={18} />
              </div>
              <div>
                <span className="font-bold text-white">Student Name Verification & Correction: </span>
                <span className="text-slate-300">
                  Spotted a typo or wrong spelling in your name? Find your entry in the list and click{' '}
                  <strong className="text-cyan-300">Edit Name</strong>. Requests are verified by the controller before updating the official table.
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto font-mono text-[11px]">
              <span className="text-slate-400">Allowed Series:</span>
              <span className="px-2.5 py-1 rounded-lg bg-slate-900/90 text-cyan-300 font-bold border border-cyan-500/30">
                {editConfig.allowed_edit_series?.includes('*') || editConfig.allowed_edit_series?.includes('all')
                  ? 'All Series (*)'
                  : (editConfig.allowed_edit_series || []).map((s) => `${s}`).join(', ') || 'None'}
              </span>
            </div>
          </div>
        ) : (
          <div className="p-3 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-center justify-between gap-3 text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <MaterialIcon name="lock" size={16} className="text-slate-500" />
              <span>Student name editing is currently turned off by the event administrator.</span>
            </div>
          </div>
        )}

        {/* Search & Filtering Toolbar */}
        <div className="glass-panel p-4 sm:p-5 rounded-2xl border border-cyan-500/25 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1">
            <input
              id="public-participant-search-input"
              type="text"
              placeholder="Search by Roll Number, Student ID, or Name..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900/90 border border-slate-700/80 text-white placeholder-slate-400 text-sm focus:outline-none focus:border-cyan-400 transition"
            />
            <MaterialIcon name="search" size={20} className="absolute left-3 top-3 text-cyan-400" />
            {searchQuery && (
              <button
                type="button"
                onClick={() => handleSearchChange('')}
                className="absolute right-3 top-3 text-slate-400 hover:text-white"
              >
                <MaterialIcon name="close" size={16} />
              </button>
            )}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={selectedType}
              onChange={(e) => handleTypeChange(e.target.value)}
              className="px-3.5 py-2.5 rounded-xl bg-slate-900/90 border border-slate-700/80 text-slate-200 text-xs font-semibold focus:outline-none focus:border-cyan-400"
            >
              <option value="all">All Roles</option>
              <option value="student">Students</option>
              <option value="faculty">Faculty</option>
              <option value="guest">Guests</option>
            </select>

            <select
              value={selectedStatus}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="px-3.5 py-2.5 rounded-xl bg-slate-900/90 border border-slate-700/80 text-slate-200 text-xs font-semibold focus:outline-none focus:border-cyan-400"
            >
              <option value="all">All Status</option>
              <option value="eligible">Eligible Only</option>
              <option value="winner">Winners Only</option>
              <option value="ignored">Ineligible / Ignored</option>
            </select>

            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="px-3 py-2.5 rounded-xl bg-slate-900/90 border border-slate-700/80 text-slate-300 text-xs font-semibold focus:outline-none focus:border-cyan-400"
            >
              <option value={15}>15 / page</option>
              <option value={30}>30 / page</option>
              <option value={50}>50 / page</option>
            </select>
          </div>
        </div>

        {/* Directory Table Card */}
        <div className="glass-panel rounded-2xl sm:rounded-3xl border border-cyan-500/20 overflow-hidden shadow-xl flex-1 flex flex-col">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-900/80 text-slate-400 uppercase tracking-wider text-xs font-mono border-b border-slate-800">
                <tr>
                  <th className="px-5 py-3.5">ID / Roll</th>
                  <th className="px-5 py-3.5">Participant Name</th>
                  <th className="px-5 py-3.5">Category</th>
                  <th className="px-5 py-3.5">Designation</th>
                  <th className="px-5 py-3.5 text-right">Raffle Status</th>
                  <th className="px-5 py-3.5 text-center">Name Edit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium text-slate-200">
                {participants.map((p, idx) => (
                  <tr key={`${p.name}_${p.id || idx}`} className="hover:bg-cyan-500/5 transition">
                    <td className="px-5 py-3.5 font-mono text-cyan-300 font-bold">
                      {p.id || '—'}
                    </td>
                    <td className="px-5 py-3.5 font-semibold text-white">
                      {p.name}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider ${
                          p.type === 'student'
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/30'
                            : p.type === 'faculty'
                            ? 'bg-purple-500/20 text-purple-300 border border-purple-400/30'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-400/30'
                        }`}
                      >
                        {p.type}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-400 text-xs">
                      {p.designation || (p.type === 'student' ? 'Student' : 'DUET CSE')}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {p.status === 'winner' ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-amber-500/20 text-amber-300 border border-amber-400/50 shadow-[0_0_12px_rgba(245,158,11,0.25)]">
                          <MaterialIcon name="emoji_events" size={15} className="text-amber-400" />
                          WINNER #{p.winning_serial || ''}
                        </span>
                      ) : p.status === 'ignored' ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                          <MaterialIcon name="close" size={14} className="text-rose-400" />
                          INELIGIBLE
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                          <MaterialIcon name="check" size={14} className="text-emerald-400" />
                          ELIGIBLE FOR DRAW
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      {p.type === 'student' ? (
                        (() => {
                          const series = getStudentSeries(p.id);
                          const isAllowed = isSeriesAllowed(series);

                          if (!editConfig.allow_participant_edit) {
                            return (
                              <span
                                className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-500 italic"
                                title="Name editing disabled by controller"
                              >
                                <MaterialIcon name="lock" size={13} />
                                <span>Closed</span>
                              </span>
                            );
                          }

                          if (!isAllowed) {
                            return (
                              <span
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900/80 border border-slate-700/60 text-slate-500 text-[11px] font-mono cursor-not-allowed"
                                title={`Series ${series || '??'} name editing is not enabled`}
                              >
                                <MaterialIcon name="lock" size={13} />
                                <span>S-{series || '??'} Locked</span>
                              </span>
                            );
                          }

                          return (
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(p)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/40 text-cyan-300 hover:text-white text-xs font-bold font-mono transition shadow-sm"
                              title={`Found a typo? Request name correction for roll ${p.id || ''}`}
                            >
                              <MaterialIcon name="edit" size={13} />
                              <span>Edit Name</span>
                            </button>
                          );
                        })()
                      ) : (
                        <span
                          className="text-[11px] text-slate-600 font-mono italic"
                          title="Name editing is restricted to students only"
                        >
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                ))}

                {participants.length === 0 && !loading && (
                  <tr>
                    <td colSpan={6} className="px-6 py-14 text-center text-slate-400">
                      <MaterialIcon
                        name={counts.total === 0 ? 'storage' : 'search_off'}
                        size={36}
                        className="mx-auto text-slate-500 mb-2"
                      />
                      <p className="font-semibold text-slate-300">
                        {counts.total === 0 ? 'Database is empty' : 'No matching participants found'}
                      </p>
                      <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                        {counts.total === 0
                          ? 'No participants are currently loaded in the database. Use the Register Entry button above or import participants via the controller.'
                          : 'Try modifying your search query or removing active status filters.'}
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <div className="p-4 sm:p-5 border-t border-slate-800/80 bg-slate-900/40 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400 mt-auto">
            <div>
              Showing{' '}
              <span className="font-bold text-white">
                {totalRecords > 0 ? (currentPage - 1) * pageSize + 1 : 0}
              </span>{' '}
              to{' '}
              <span className="font-bold text-white">
                {Math.min(currentPage * pageSize, totalRecords)}
              </span>{' '}
              of <span className="font-bold text-cyan-300">{totalRecords}</span> entries
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCurrentPage(1)}
                disabled={currentPage <= 1 || loading}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed font-mono transition"
                title="First Page"
              >
                ««
              </button>

              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1 || loading}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed font-mono transition flex items-center gap-1"
              >
                <MaterialIcon name="chevron_left" size={16} />
                <span>Prev</span>
              </button>

              <span className="px-3 py-1.5 rounded-lg bg-cyan-950/40 border border-cyan-400/40 text-cyan-300 font-mono font-bold">
                Page {currentPage} of {totalPages}
              </span>

              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages || loading}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed font-mono transition flex items-center gap-1"
              >
                <span>Next</span>
                <MaterialIcon name="chevron_right" size={16} />
              </button>

              <button
                type="button"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage >= totalPages || loading}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed font-mono transition"
                title="Last Page"
              >
                »»
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Self-Registration Modal */}
      {showRegisterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="max-w-md w-full glass-capsule rounded-3xl p-6 sm:p-8 border border-cyan-500/30 bg-slate-900/95 shadow-2xl text-slate-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <MaterialIcon name="badge" size={20} className="text-cyan-400" />
                <h3 className="text-lg font-bold text-white">Register for CSE Fest Raffle</h3>
              </div>
              <button
                onClick={() => setShowRegisterModal(false)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition"
              >
                <MaterialIcon name="close" size={20} />
              </button>
            </div>

            <form onSubmit={handleRegisterSubmit} className="space-y-4 mt-5">
              {!selfRegEnabled && (
                <div className="p-3 rounded-xl text-xs flex items-start gap-2 bg-amber-500/20 border border-amber-500/40 text-amber-300">
                  <MaterialIcon name="lock" size={16} className="shrink-0 mt-0.5" />
                  <span>Participant self-registration is currently closed by the event administrator. New submissions cannot be accepted at this time.</span>
                </div>
              )}

              {regFeedback && (
                <div
                  className={`p-3 rounded-xl text-xs flex items-start gap-2 ${
                    regFeedback.success
                      ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
                      : 'bg-rose-500/20 border border-rose-500/40 text-rose-300'
                  }`}
                >
                  <MaterialIcon
                    name={regFeedback.success ? 'check_circle' : 'error'}
                    size={16}
                    className="shrink-0 mt-0.5"
                  />
                  <span>{regFeedback.message}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-mono font-bold text-slate-400 uppercase mb-1">
                  Full Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  placeholder="e.g. Abdullah Al Mamun"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-cyan-400 text-white text-sm outline-none transition"
                />
              </div>

              <div>
                <label className="block text-xs font-mono font-bold text-slate-400 uppercase mb-1">
                  Category <span className="text-rose-400">*</span>
                </label>
                <select
                  value={regType}
                  onChange={(e) => setRegType(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-cyan-400 text-white text-sm outline-none transition"
                >
                  <option value="student">Student</option>
                  <option value="faculty">Faculty Member</option>
                  <option value="guest">Guest</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-mono font-bold text-slate-400 uppercase mb-1">
                  Student Roll / Employee ID
                </label>
                <input
                  type="text"
                  value={regId}
                  onChange={(e) => setRegId(e.target.value)}
                  placeholder={regType === 'student' ? 'e.g. 2303042' : 'e.g. EMP-1092'}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-cyan-400 text-white text-sm outline-none transition"
                />
              </div>

              {regType !== 'student' && (
                <div>
                  <label className="block text-xs font-mono font-bold text-slate-400 uppercase mb-1">
                    Designation / Role
                  </label>
                  <input
                    type="text"
                    value={regDesignation}
                    onChange={(e) => setRegDesignation(e.target.value)}
                    placeholder="e.g. Assistant Professor or Senior Tech"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-cyan-400 text-white text-sm outline-none transition"
                  />
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowRegisterModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!selfRegEnabled || regSubmitting || !regName.trim()}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-bold font-mono transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {regSubmitting ? (
                    <>
                      <MaterialIcon name="refresh" size={14} className="animate-spin" />
                      <span>SUBMITTING...</span>
                    </>
                  ) : (
                    <span>SUBMIT REGISTRATION</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Student Name Correction Request */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="max-w-md w-full rounded-2xl sm:rounded-3xl p-6 sm:p-7 border border-cyan-500/40 bg-slate-900 shadow-2xl text-slate-200 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 flex items-center justify-center">
                  <MaterialIcon name="edit_note" size={22} />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold font-display text-white">
                    Request Name Correction
                  </h3>
                  <p className="text-xs text-slate-400">
                    Submit verified spelling update for student participant
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition"
              >
                <MaterialIcon name="close" size={20} />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-4">
              {editFeedback && (
                <div
                  className={`p-3 rounded-xl text-xs flex items-start gap-2 border ${
                    editFeedback.success
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                  }`}
                >
                  <MaterialIcon
                    name={editFeedback.success ? 'check_circle' : 'error'}
                    size={16}
                    className="shrink-0 mt-0.5"
                  />
                  <span>{editFeedback.message}</span>
                </div>
              )}

              {/* Student Roll / ID */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-mono font-bold text-slate-400 uppercase">
                    Student ID / Roll <span className="text-rose-400">*</span>
                  </label>
                  {editStudentId && (
                    <span className="text-[11px] font-mono text-cyan-400">
                      Series: {getStudentSeries(editStudentId) || '??'}
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  required
                  value={editStudentId}
                  onChange={(e) => setEditStudentId(e.target.value)}
                  placeholder="e.g. 2303042"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-cyan-400 text-white font-mono text-sm outline-none transition"
                />
              </div>

              {/* Current Name (if prefilled) */}
              {editCurrentName && (
                <div>
                  <label className="block text-xs font-mono font-bold text-slate-400 uppercase mb-1">
                    Current Registered Name
                  </label>
                  <div className="px-3.5 py-2 rounded-xl bg-slate-950/60 border border-slate-800 text-slate-400 text-sm font-medium">
                    {editCurrentName}
                  </div>
                </div>
              )}

              {/* Requested / Corrected Name */}
              <div>
                <label className="block text-xs font-mono font-bold text-slate-400 uppercase mb-1">
                  Corrected Full Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editRequestedName}
                  onChange={(e) => setEditRequestedName(e.target.value)}
                  placeholder="Enter your exact official name"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-cyan-500/50 focus:border-cyan-400 text-white text-sm outline-none transition shadow-sm"
                />
              </div>

              {/* Optional Reason / Note */}
              <div>
                <label className="block text-xs font-mono font-bold text-slate-400 uppercase mb-1">
                  Reason for Correction (Optional)
                </label>
                <input
                  type="text"
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="e.g. Typo in first name, spelling mismatch"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-cyan-400 text-white text-sm outline-none transition"
                />
              </div>

              {/* Notice regarding controller review */}
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs flex items-start gap-2">
                <MaterialIcon name="verified_user" size={16} className="text-amber-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Controller Verification Required:</strong> Your name edit will not take effect immediately. It is submitted to the event controller who must verify and approve it before the official database is updated.
                </span>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    !editConfig.allow_participant_edit ||
                    editSubmitting ||
                    !editStudentId.trim() ||
                    !editRequestedName.trim()
                  }
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-bold font-mono transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {editSubmitting ? (
                    <>
                      <MaterialIcon name="refresh" size={14} className="animate-spin" />
                      <span>SUBMITTING...</span>
                    </>
                  ) : (
                    <span>SUBMIT CORRECTION</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
