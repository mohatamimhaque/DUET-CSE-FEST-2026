import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MaterialIcon } from './MaterialIcon.tsx';
import { useTheme } from '../hooks/useTheme.ts';
import { WinnerResult, IgnoredCandidate } from '../types.ts';
import { api } from '../services/api.ts';
import { useWebSocket } from '../hooks/useWebSocket.ts';

export const ResultsPage: React.FC = () => {
  const { theme, toggleTheme, isDark } = useTheme();
  const [winners, setWinners] = useState<WinnerResult[]>([]);
  const [ignored, setIgnored] = useState<IgnoredCandidate[]>([]);
  const [eventName, setEventName] = useState<string>('DUET CSE Fest 2026');
  const [totalWinners, setTotalWinners] = useState<number>(10);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [exportNotice, setExportNotice] = useState<string>('');

  const { lastMessage } = useWebSocket('audience');

  const fetchResults = useCallback(async () => {
    try {
      const data = await api.getResults();
      setEventName(data.event || 'DUET CSE Fest 2026');
      setTotalWinners(data.total_winners || 10);
      setWinners(data.results || []);
      setIgnored(data.ignored || []);
    } catch {
      // Ignored
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  const handledMsgRef = useRef<string>('');

  // Live WebSocket refresh on winner confirmed or session reset
  useEffect(() => {
    if (!lastMessage) return;
    const sig = (lastMessage as any).id || `${lastMessage.type}_${lastMessage.timestamp}`;
    if (handledMsgRef.current === sig) return;
    handledMsgRef.current = sig;

    if (
      lastMessage.type === 'WINNER_CONFIRMED' ||
      lastMessage.type === 'CANDIDATE_IGNORED' ||
      lastMessage.type === 'RESET' ||
      lastMessage.type === 'COMPLETED'
    ) {
      fetchResults();
    }
  }, [lastMessage, fetchResults]);

  const handlePrint = () => {
    window.print();
  };

  const handleExportCSV = () => {
    try {
      const headers = ['Serial', 'Category', 'ID_Roll', 'Name', 'Designation', 'Drawn_At'];
      const rows = winners.map((w) => [
        `#${String(w.serial).padStart(2, '0')}`,
        `"${w.type.toUpperCase()}"`,
        `"${w.id || 'N/A'}"`,
        `"${w.name.replace(/"/g, '""')}"`,
        `"${(w.designation || 'DUET CSE').replace(/"/g, '""')}"`,
        `"${w.drawn_at}"`,
      ]);
      const csvString = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
      const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `DUET_CSE_Fest_2026_Official_Winners_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setExportNotice('CSV file downloaded successfully.');
      setTimeout(() => setExportNotice(''), 3000);
    } catch (err: any) {
      setExportNotice('Export failed: ' + err.message);
    }
  };

  const handleExportJSON = () => {
    try {
      const dataPayload = {
        event: eventName,
        total_winners: totalWinners,
        completed_winners: winners.length,
        exported_at: new Date().toISOString(),
        winners,
        ignored,
      };
      const jsonString = JSON.stringify(dataPayload, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `DUET_CSE_Fest_2026_Official_Results_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setExportNotice('JSON file downloaded successfully.');
      setTimeout(() => setExportNotice(''), 3000);
    } catch (err: any) {
      setExportNotice('Export failed: ' + err.message);
    }
  };

  const filteredWinners = winners.filter((w) => {
    if (!searchFilter) return true;
    const q = searchFilter.toLowerCase();
    return (
      w.name.toLowerCase().includes(q) ||
      (w.id && w.id.toLowerCase().includes(q)) ||
      (w.designation && w.designation.toLowerCase().includes(q)) ||
      w.type.toLowerCase().includes(q)
    );
  });

  return (
    <div id="results-page-root" className="min-h-screen w-full p-4 md:p-8 lg:p-12 max-w-6xl mx-auto space-y-8">
      {/* Toast Notice */}
      {exportNotice && (
        <div className="fixed top-6 right-6 z-50 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold shadow-xl animate-in fade-in duration-200 flex items-center gap-2">
          <MaterialIcon name="check_circle" size={16} />
          {exportNotice}
        </div>
      )}

      {/* Header Bar */}
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-slate-700/50 print:hidden">
        <div className="flex items-center space-x-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 to-yellow-300 flex items-center justify-center text-slate-950 shadow-lg">
            <MaterialIcon name="emoji_events" size={28} filled />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-black font-display text-white">
              {eventName} — Official Raffle Results
            </h1>
            <p className="text-xs md:text-sm text-slate-300 font-medium">
              Certified live event winner records • <strong className="text-white">{winners.length} of {totalWinners}</strong> winners drawn
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            id="download-csv-btn"
            onClick={handleExportCSV}
            className="px-4 py-2.5 rounded-xl glass-pill hover:bg-white/10 text-xs font-bold text-slate-200 hover:text-white flex items-center gap-2 transition cursor-pointer"
            title="Download formatted CSV spreadsheet (Winners Only)"
          >
            <MaterialIcon name="download" size={18} className="text-emerald-400" />
            Export CSV
          </button>

          <button
            id="download-json-btn"
            onClick={handleExportJSON}
            className="px-4 py-2.5 rounded-xl glass-pill hover:bg-white/10 text-xs font-bold text-slate-200 hover:text-white flex items-center gap-2 transition cursor-pointer"
            title="Download full JSON dataset"
          >
            <MaterialIcon name="data_object" size={18} className="text-cyan-400" />
            Export JSON
          </button>

          <button
            id="print-results-btn"
            onClick={handlePrint}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white text-xs font-bold shadow-md flex items-center gap-2 transition cursor-pointer"
          >
            <MaterialIcon name="print" size={18} />
            Export PDF / Print
          </button>

          <a
            id="results-participants-link"
            href="/participants"
            className="px-3.5 py-2.5 rounded-xl glass-pill text-xs font-bold text-cyan-300 hover:text-white flex items-center gap-1.5 transition"
          >
            <MaterialIcon name="groups" size={16} />
            Check Eligibility
          </a>

          <a
            id="results-controller-link"
            href="/controller"
            className="px-3.5 py-2.5 rounded-xl glass-pill text-xs font-bold text-slate-200 hover:text-white flex items-center gap-1.5 transition"
          >
            <MaterialIcon name="admin_panel_settings" size={16} />
            Controller
          </a>

          <button
            id="results-theme-toggle"
            onClick={toggleTheme}
            className="p-2.5 rounded-xl glass-pill text-slate-300 hover:text-white transition cursor-pointer"
            title="Toggle theme"
          >
            <MaterialIcon name={isDark ? 'light_mode' : 'dark_mode'} size={18} />
          </button>
        </div>
      </header>

      {/* Official Executive Print / PDF Header (Visible ONLY on PDF export & Print) */}
      <div className="hidden print:block border-b-2 border-black pb-5 mb-6 text-center">
        <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-gray-700">
          Dhaka University of Engineering & Technology, Gazipur
        </div>
        <div className="text-sm font-extrabold text-black uppercase tracking-wider mt-0.5">
          Department of Computer Science and Engineering
        </div>
        <div className="text-xl font-black text-black tracking-tight mt-2 uppercase">
          DUET CSE FEST 2026 — OFFICIAL CERTIFIED WINNERS RECORD
        </div>
        <div className="flex items-center justify-between text-xs text-gray-800 mt-4 px-2 pt-2 border-t border-gray-300">
          <span>Official Winners Drawn: <strong>{winners.length} of {totalWinners}</strong></span>
          <span>Certified Date: <strong>{new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</strong></span>
          <span>Verification: <strong>AUTHENTICATED RECORD</strong></span>
        </div>
      </div>

      {/* Search Input & Live Counter */}
      <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
        <div className="relative w-full max-w-sm">
          <input
            id="results-search-input"
            type="text"
            placeholder="Search winner name, roll, designation..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900/80 border border-slate-700 text-slate-200 placeholder-slate-400 text-xs md:text-sm focus:outline-none focus:border-purple-500 transition"
          />
          <MaterialIcon name="search" size={20} className="absolute left-3 top-2.5 text-slate-400" />
        </div>

        <div className="text-xs text-slate-300 font-medium">
          Showing <strong className="text-white">{filteredWinners.length}</strong> confirmed winner(s)
        </div>
      </div>

      {/* Official Winners Table */}
      <div className="glass-panel rounded-3xl overflow-hidden border border-slate-700/60 print:border print:shadow-none">
        <div className="p-5 md:p-6 bg-slate-900/40 border-b border-slate-700/60 flex items-center justify-between">
          <h2 className="text-base md:text-lg font-bold font-display text-white print:text-black flex items-center gap-2">
            <MaterialIcon name="military_tech" className="text-amber-400" />
            Official Certified Winners List
          </h2>
          <span className="text-xs font-semibold px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 print:hidden">
            Official Records
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs md:text-sm">
            <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-700/60 print:text-gray-700">
              <tr>
                <th className="px-6 py-4">Serial</th>
                <th className="px-6 py-4">Category</th>
                <th className="px-6 py-4">Roll / Designation</th>
                <th className="px-6 py-4">Full Name</th>
                <th className="px-6 py-4 text-right">Timestamp Drawn</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-medium">
              {filteredWinners.map((winner) => (
                <tr key={winner.serial} className="hover:bg-white/5 transition print:hover:bg-transparent">
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center px-3 py-1 rounded-lg font-mono font-black text-xs md:text-sm bg-amber-500/20 text-amber-300 border border-amber-400/40 print:text-black print:border-black">
                      #{String(winner.serial).padStart(2, '0')}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-block px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider ${
                        winner.type === 'student'
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                          : winner.type === 'faculty'
                          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      } print:text-black print:border-none`}
                    >
                      {winner.type}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-mono text-slate-300 print:text-black font-semibold">
                    {winner.id || winner.designation || '—'}
                  </td>
                  <td className="px-6 py-4 font-bold text-white print:text-black text-sm md:text-base">
                    {winner.name}
                  </td>
                  <td className="px-6 py-4 text-right text-slate-300 print:text-gray-600 text-xs font-mono">
                    {new Date(winner.drawn_at).toLocaleString()}
                  </td>
                </tr>
              ))}

              {winners.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                    No winners have been confirmed yet. The raffle draw will update here live.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ignored / Absent Candidates Table (HIDDEN IN PDF EXPORT & PRINT) */}
      {ignored.length > 0 && (
        <div className="glass-panel rounded-3xl overflow-hidden border border-slate-700/60 print:hidden">
          <div className="p-5 md:p-6 bg-slate-900/40 border-b border-slate-700/60 flex items-center justify-between">
            <h3 className="text-base font-bold font-display text-slate-300 flex items-center gap-2">
              <MaterialIcon name="person_off" className="text-rose-400" />
              Ignored / Absent Candidates
            </h3>
            <span className="text-xs text-slate-400">
              Ineligible for session • Winner serial not consumed
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs md:text-sm">
              <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-700/60">
                <tr>
                  <th className="px-6 py-3">Role</th>
                  <th className="px-6 py-3">ID / Designation</th>
                  <th className="px-6 py-3">Candidate Name</th>
                  <th className="px-6 py-3">Reason</th>
                  <th className="px-6 py-3 text-right">Drawn At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium text-slate-300">
                {ignored.map((item, idx) => (
                  <tr key={idx} className="hover:bg-white/5 transition">
                    <td className="px-6 py-3 uppercase text-[11px] font-bold text-slate-400">{item.type}</td>
                    <td className="px-6 py-3 font-mono">{item.id || item.designation || '—'}</td>
                    <td className="px-6 py-3 font-semibold text-slate-200">{item.name}</td>
                    <td className="px-6 py-3">
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                        {item.reason}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-right text-slate-300 text-xs font-mono">
                      {new Date(item.drawn_at).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Official Signatures & Verification Block (Visible ONLY on PDF export & Print) */}
      <div className="hidden print:grid grid-cols-2 gap-16 pt-16 mt-10 border-t border-gray-400 break-inside-avoid text-xs text-black">
        <div className="flex flex-col items-center text-center">
          <div className="w-56 border-b border-black mb-2" />
          <div className="font-bold text-sm">Convener / Head of Department</div>
          <div className="text-gray-700 text-xs">Department of Computer Science and Engineering, DUET</div>
        </div>
        <div className="flex flex-col items-center text-center">
          <div className="w-56 border-b border-black mb-2" />
          <div className="font-bold text-sm">Event Controller & Scrutiny Lead</div>
          <div className="text-gray-700 text-xs">DUET CSE Fest 2026 Organizing Committee</div>
        </div>
      </div>

      {/* Certification Footer */}
      <footer className="pt-6 border-t border-slate-700/50 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-3 print:hidden">
        <span>DUET CSE Fest 2026 Executive Committee & Technical Committee</span>
        <span>Secure Randomness Powered by Fast Python/Node.js Cryptography Engine</span>
      </footer>
    </div>
  );
};
