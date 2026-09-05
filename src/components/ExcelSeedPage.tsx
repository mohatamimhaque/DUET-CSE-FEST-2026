import React, { useState, useEffect, useRef } from 'react';
import { MaterialIcon } from './MaterialIcon.tsx';
import { api, setStoredToken, getStoredToken } from '../services/api.ts';

interface NormalizedParticipantRow {
  rowIndex: number;
  rawSerial: string;
  studentId: string;
  name: string;
  type: 'student' | 'faculty' | 'guest';
  designation: string;
  department: string;
  isValid: boolean;
  validationError?: string;
  validationWarning?: string;
}

interface ExcelSeedData {
  fileName: string;
  fileSize: number;
  foundInRoot: boolean;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  counts: {
    students: number;
    faculty: number;
    guests: number;
  };
  rows: NormalizedParticipantRow[];
  headers: string[];
}

export const ExcelSeedPage: React.FC = () => {
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [authChecking, setAuthChecking] = useState<boolean>(true);
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [loginError, setLoginError] = useState<string>('');
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);

  // Data & Preview state
  const [data, setData] = useState<ExcelSeedData | null>(null);
  const [dbStatus, setDbStatus] = useState<{
    connected: boolean;
    current_participants: number;
    is_empty: boolean;
  } | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string>('');

  // Upload to DB modal state
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [uploadMode, setUploadMode] = useState<'append' | 'replace'>('append');
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadResult, setUploadResult] = useState<{
    success: boolean;
    inserted: number;
    updated: number;
    skipped: number;
    errors: number;
    message: string;
  } | null>(null);

  // Filter & Search state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'student' | 'faculty' | 'guest' | 'invalid'>('all');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);

  // File input ref for client-side file selection
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState<boolean>(false);

  // Initial Auth Check
  useEffect(() => {
    const token = getStoredToken();
    if (token) {
      setIsAuthenticated(true);
      fetchPreview();
    } else {
      setAuthChecking(false);
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setIsLoggingIn(true);
    try {
      const res = await api.controllerLogin(username, password);
      if (res.token) {
        setStoredToken(res.token);
        setIsAuthenticated(true);
        fetchPreview();
      } else {
        setLoginError('Invalid login response from server.');
      }
    } catch (err: any) {
      setLoginError(err.message || 'Authentication failed. Please check credentials.');
    } finally {
      setIsLoggingIn(false);
      setAuthChecking(false);
    }
  };

  const fetchPreview = async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const res = await api.getExcelSeedPreview();
      setData(res.data);
      setDbStatus(res.dbStatus);
    } catch (err: any) {
      if (err.message?.includes('403') || err.message?.includes('Forbidden') || err.message?.includes('Access Denied')) {
        setIsAuthenticated(false);
        setStoredToken(null);
      } else {
        setLoadError(err.message || 'Failed to read root Excel file.');
      }
    } finally {
      setIsLoading(false);
      setAuthChecking(false);
    }
  };

  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        setIsLoading(true);
        setLoadError('');
        const buffer = e.target?.result as ArrayBuffer;
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);

        const res = await api.parseUploadedExcel(base64, file.name);
        setData(res.data);
        setDbStatus(res.dbStatus);
        setCurrentPage(1);
      } catch (err: any) {
        setLoadError(err.message || 'Failed to parse selected Excel file.');
      } finally {
        setIsLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleCommitUpload = async () => {
    if (!data || !data.rows || data.rows.length === 0) return;
    setIsUploading(true);
    setUploadResult(null);

    try {
      const res = await api.commitExcelSeed(data.rows, uploadMode);
      setUploadResult(res);
      // Refresh DB stats
      const statusRes = await api.getExcelSeedPreview();
      setDbStatus(statusRes.dbStatus);
    } catch (err: any) {
      setUploadResult({
        success: false,
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: data.rows.length,
        message: err.message || 'Failed to commit participants to database.',
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Filtered rows
  const filteredRows = (data?.rows || []).filter((r) => {
    if (typeFilter === 'student' && r.type !== 'student') return false;
    if (typeFilter === 'faculty' && r.type !== 'faculty') return false;
    if (typeFilter === 'guest' && r.type !== 'guest') return false;
    if (typeFilter === 'invalid' && r.isValid) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchName = r.name.toLowerCase().includes(q);
      const matchSerial = r.rawSerial.toLowerCase().includes(q);
      const matchDesig = r.designation.toLowerCase().includes(q);
      if (!matchName && !matchSerial && !matchDesig) return false;
    }
    return true;
  });

  const totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
  const paginatedRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Authentication Gate
  if (!isAuthenticated && !authChecking) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 font-sans">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute -top-24 -right-24 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <MaterialIcon name="table_chart" size={28} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">Excel Participant Seeder</h1>
              <p className="text-xs text-slate-400">Controller Access Authorization Required</p>
            </div>
          </div>

          <p className="text-sm text-slate-400 mb-6">
            This administrative tool parses <code className="text-cyan-400 bg-slate-800 px-1.5 py-0.5 rounded">data.excel</code> from the server root and commits verified participants directly to Supabase.
          </p>

          {loginError && (
            <div className="mb-4 p-3 rounded-lg bg-red-950/60 border border-red-800/60 text-red-300 text-xs flex items-center gap-2">
              <MaterialIcon name="error" size={18} className="text-red-400 flex-shrink-0" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Controller Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-cyan-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Controller Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter controller password"
                required
                className="w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-cyan-500 transition-colors"
              />
            </div>
            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-sm rounded-lg shadow-lg shadow-cyan-900/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isLoggingIn ? (
                <>
                  <MaterialIcon name="sync" className="animate-spin" size={18} />
                  <span>Authenticating...</span>
                </>
              ) : (
                <>
                  <MaterialIcon name="lock_open" size={18} />
                  <span>Authenticate & Open Seeder</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-slate-800 text-center">
            <a
              href="/controller"
              className="text-xs text-slate-400 hover:text-slate-200 transition-colors inline-flex items-center gap-1"
            >
              <MaterialIcon name="arrow_back" size={14} />
              Return to Controller Console
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans pb-16">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 lg:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <a
              href="/controller"
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors flex items-center justify-center"
              title="Return to Controller Console"
            >
              <MaterialIcon name="arrow_back" size={20} />
            </a>
            <div className="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-inner">
              <MaterialIcon name="table_chart" size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-white tracking-tight">Excel Participant Seeder</h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider bg-cyan-950/80 border border-cyan-800 text-cyan-300">
                  CONTROLLER ONLY
                </span>
              </div>
              <p className="text-xs text-slate-400">DUET CSE Fest 2026 • Automated Root File Ingestion</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Database Status Indicator */}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-xs">
              <span
                className={`w-2 h-2 rounded-full ${
                  dbStatus?.connected ? 'bg-emerald-400 shadow-sm shadow-emerald-400' : 'bg-rose-500'
                }`}
              />
              <span className="text-slate-300 font-medium">
                Supabase:{' '}
                {dbStatus ? `${dbStatus.current_participants} participants in DB` : 'Checking...'}
              </span>
            </div>

            <button
              onClick={fetchPreview}
              disabled={isLoading}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors flex items-center gap-1.5 disabled:opacity-50"
              title="Re-scan root folder for data.excel"
            >
              <MaterialIcon name="refresh" size={16} className={isLoading ? 'animate-spin' : ''} />
              <span>Re-scan Root</span>
            </button>

            <a
              href="/controller"
              className="px-3.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-md shadow-cyan-950/50 transition-all flex items-center gap-1.5"
            >
              <MaterialIcon name="tune" size={16} />
              <span>Controller Console</span>
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 lg:px-8 pt-6 space-y-6">
        {/* Error Alert */}
        {loadError && (
          <div className="p-4 rounded-xl bg-red-950/50 border border-red-800 text-red-200 text-sm flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <MaterialIcon name="warning" size={20} className="text-red-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold">Error Reading Excel Data</p>
                <p className="text-xs text-red-300 mt-0.5">{loadError}</p>
              </div>
            </div>
            <button
              onClick={fetchPreview}
              className="px-2.5 py-1 bg-red-900/60 hover:bg-red-800 border border-red-700 rounded text-xs font-medium text-white transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Source File & Drag-Drop Uploader Header */}
        <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
            {/* Left: Detected File Info */}
            <div className="lg:col-span-2 space-y-2">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  <MaterialIcon name="file_present" size={18} />
                </span>
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                  Active Source File
                </span>
                {data?.foundInRoot && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                    SERVER ROOT FOLDER
                  </span>
                )}
              </div>
              <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2 font-mono">
                {data?.fileName || 'data.excel'}
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed max-w-2xl">
                Columns recognized: <code className="text-cyan-400 bg-slate-950 px-1 py-0.5 rounded">serial</code>,{' '}
                <code className="text-cyan-400 bg-slate-950 px-1 py-0.5 rounded">name</code>,{' '}
                <code className="text-cyan-400 bg-slate-950 px-1 py-0.5 rounded">type</code>,{' '}
                <code className="text-cyan-400 bg-slate-950 px-1 py-0.5 rounded">designation</code>.
                Rule enforced: <strong>Student ID</strong> is populated for Students; left blank for Faculty and Guests.
              </p>
            </div>

            {/* Right: Drag-and-drop or select new excel file */}
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${
                dragActive
                  ? 'border-cyan-400 bg-cyan-950/30'
                  : 'border-slate-700 hover:border-slate-500 bg-slate-950/50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.excel,.csv"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileUpload(e.target.files[0]);
                  }
                }}
              />
              <MaterialIcon name="cloud_upload" size={24} className="text-slate-400 mx-auto mb-1" />
              <p className="text-xs font-semibold text-slate-200">Drag & drop or Click to choose Excel</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Supports .xlsx, .xls, .excel</p>
            </div>
          </div>
        </section>

        {/* Bento Summary Stats */}
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-sm">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-xs font-semibold uppercase">Total Rows</span>
              <MaterialIcon name="format_list_numbered" size={16} className="text-slate-400" />
            </div>
            <div className="text-2xl font-black text-white font-mono">{data?.totalRows ?? 0}</div>
            <p className="text-[11px] text-slate-500 mt-0.5">Scanned from file</p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-sm">
            <div className="flex items-center justify-between text-cyan-400 mb-1">
              <span className="text-xs font-semibold uppercase">Students</span>
              <MaterialIcon name="school" size={16} className="text-cyan-400" />
            </div>
            <div className="text-2xl font-black text-cyan-300 font-mono">
              {data?.counts?.students ?? 0}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">With Student IDs</p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-sm">
            <div className="flex items-center justify-between text-purple-400 mb-1">
              <span className="text-xs font-semibold uppercase">Faculty</span>
              <MaterialIcon name="badge" size={16} className="text-purple-400" />
            </div>
            <div className="text-2xl font-black text-purple-300 font-mono">
              {data?.counts?.faculty ?? 0}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">Academic roles</p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-sm">
            <div className="flex items-center justify-between text-amber-400 mb-1">
              <span className="text-xs font-semibold uppercase">Guests</span>
              <MaterialIcon name="person" size={16} className="text-amber-400" />
            </div>
            <div className="text-2xl font-black text-amber-300 font-mono">
              {data?.counts?.guests ?? 0}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">Distinguished guests</p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-sm">
            <div className="flex items-center justify-between text-emerald-400 mb-1">
              <span className="text-xs font-semibold uppercase">Valid Ready</span>
              <MaterialIcon name="check_circle" size={16} className="text-emerald-400" />
            </div>
            <div className="text-2xl font-black text-emerald-400 font-mono">
              {data?.validRows ?? 0}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">100% compliant</p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-sm">
            <div className="flex items-center justify-between text-red-400 mb-1">
              <span className="text-xs font-semibold uppercase">Errors</span>
              <MaterialIcon name="error_outline" size={16} className="text-red-400" />
            </div>
            <div className="text-2xl font-black text-red-400 font-mono">
              {data?.invalidRows ?? 0}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">Missing name/ID</p>
          </div>
        </section>

        {/* Primary Action Button Bar */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-white">Commit Participants to Database</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Ready to write {data?.validRows ?? 0} verified records to <code className="text-slate-300 font-mono">cse_fest_2026_participants</code>.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowUploadModal(true)}
              disabled={!data || data.validRows === 0}
              className="px-5 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-sm font-bold shadow-lg shadow-emerald-950/50 transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <MaterialIcon name="cloud_upload" size={20} />
              <span>Upload to Database ({data?.validRows ?? 0} rows)</span>
            </button>
          </div>
        </section>

        {/* Preview Table & Filtering Controls */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
          {/* Filter Toolbar */}
          <div className="p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => {
                  setTypeFilter('all');
                  setCurrentPage(1);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  typeFilter === 'all'
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                All ({data?.totalRows ?? 0})
              </button>
              <button
                onClick={() => {
                  setTypeFilter('student');
                  setCurrentPage(1);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  typeFilter === 'student'
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                Students ({data?.counts?.students ?? 0})
              </button>
              <button
                onClick={() => {
                  setTypeFilter('faculty');
                  setCurrentPage(1);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  typeFilter === 'faculty'
                    ? 'bg-purple-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                Faculty ({data?.counts?.faculty ?? 0})
              </button>
              <button
                onClick={() => {
                  setTypeFilter('guest');
                  setCurrentPage(1);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  typeFilter === 'guest'
                    ? 'bg-amber-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                Guests ({data?.counts?.guests ?? 0})
              </button>
              {data && data.invalidRows > 0 && (
                <button
                  onClick={() => {
                    setTypeFilter('invalid');
                    setCurrentPage(1);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    typeFilter === 'invalid'
                      ? 'bg-rose-600 text-white'
                      : 'bg-slate-800 text-rose-300 hover:bg-slate-700'
                  }`}
                >
                  Errors ({data.invalidRows})
                </button>
              )}
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <MaterialIcon
                  name="search"
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="text"
                  placeholder="Filter by name or roll..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-300 px-2 py-1.5 focus:outline-none"
              >
                <option value={15}>15 / page</option>
                <option value={20}>20 / page</option>
                <option value={50}>50 / page</option>
                <option value={100}>100 / page</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-3 px-4 w-12 text-center">#</th>
                  <th className="py-3 px-4">Serial / Student ID</th>
                  <th className="py-3 px-4">Participant Name</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Designation</th>
                  <th className="py-3 px-4">Dept</th>
                  <th className="py-3 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {paginatedRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-500">
                      <MaterialIcon name="inbox" size={32} className="mx-auto mb-2 opacity-50" />
                      <p>No participant records matched your filter.</p>
                    </td>
                  </tr>
                ) : (
                  paginatedRows.map((row) => (
                    <tr
                      key={row.rowIndex}
                      className={`hover:bg-slate-800/40 transition-colors ${
                        !row.isValid ? 'bg-red-950/20' : ''
                      }`}
                    >
                      <td className="py-2.5 px-4 text-center font-mono text-slate-500">
                        {row.rowIndex}
                      </td>
                      <td className="py-2.5 px-4">
                        {row.type === 'student' ? (
                          row.studentId ? (
                            <span className="font-mono font-bold text-cyan-300 bg-cyan-950/70 border border-cyan-800 px-2 py-0.5 rounded text-xs">
                              {row.studentId}
                            </span>
                          ) : (
                            <span className="font-mono text-red-400 bg-red-950/60 border border-red-800 px-2 py-0.5 rounded text-xs">
                              MISSING ID
                            </span>
                          )
                        ) : (
                          <span className="text-slate-500 font-mono italic">— (Blank)</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-white">
                        {row.name || <span className="text-red-400 italic">Missing Name</span>}
                      </td>
                      <td className="py-2.5 px-4">
                        {row.type === 'student' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                            <MaterialIcon name="school" size={12} />
                            STUDENT
                          </span>
                        )}
                        {row.type === 'faculty' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-500/10 text-purple-300 border border-purple-500/30">
                            <MaterialIcon name="badge" size={12} />
                            FACULTY
                          </span>
                        )}
                        {row.type === 'guest' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-300 border border-amber-500/30">
                            <MaterialIcon name="person" size={12} />
                            GUEST
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-slate-300">
                        {row.type === 'student' ? (
                          <span className="text-slate-300">Student</span>
                        ) : (
                          <span className="font-medium text-slate-200">{row.designation}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-400">{row.department}</td>
                      <td className="py-2.5 px-4 text-center">
                        {row.isValid ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                            <MaterialIcon name="check_circle" size={16} />
                            <span>Valid</span>
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 text-red-400 font-medium cursor-help"
                            title={row.validationError}
                          >
                            <MaterialIcon name="cancel" size={16} />
                            <span>Error</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="p-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
            <div>
              Showing {filteredRows.length > 0 ? (currentPage - 1) * pageSize + 1 : 0} to{' '}
              {Math.min(currentPage * pageSize, filteredRows.length)} of {filteredRows.length} rows
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white disabled:opacity-40 transition-colors flex items-center gap-1"
              >
                <MaterialIcon name="chevron_left" size={16} />
                <span>Prev</span>
              </button>

              <span className="px-2 font-mono text-slate-300">
                {currentPage} / {totalPages}
              </span>

              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white disabled:opacity-40 transition-colors flex items-center gap-1"
              >
                <span>Next</span>
                <MaterialIcon name="chevron_right" size={16} />
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Confirmation & Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <MaterialIcon name="cloud_upload" size={22} />
                </div>
                <h3 className="text-lg font-bold text-white">Upload to Supabase Database</h3>
              </div>
              <button
                onClick={() => {
                  if (!isUploading) {
                    setShowUploadModal(false);
                    setUploadResult(null);
                  }
                }}
                disabled={isUploading}
                className="text-slate-400 hover:text-white p-1"
              >
                <MaterialIcon name="close" size={20} />
              </button>
            </div>

            {uploadResult ? (
              <div className="space-y-4">
                <div
                  className={`p-4 rounded-xl border ${
                    uploadResult.success
                      ? 'bg-emerald-950/40 border-emerald-800 text-emerald-200'
                      : 'bg-red-950/40 border-red-800 text-red-200'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <MaterialIcon
                      name={uploadResult.success ? 'check_circle' : 'error'}
                      size={22}
                      className={uploadResult.success ? 'text-emerald-400' : 'text-red-400'}
                    />
                    <div>
                      <p className="font-bold text-sm">
                        {uploadResult.success ? 'Upload Completed Successfully' : 'Upload Encountered Errors'}
                      </p>
                      <p className="text-xs mt-1 leading-relaxed">{uploadResult.message}</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                    <p className="text-slate-400 font-semibold">Inserted</p>
                    <p className="text-lg font-bold text-emerald-400 font-mono">{uploadResult.inserted}</p>
                  </div>
                  <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                    <p className="text-slate-400 font-semibold">Skipped</p>
                    <p className="text-lg font-bold text-slate-400 font-mono">{uploadResult.skipped}</p>
                  </div>
                  <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                    <p className="text-slate-400 font-semibold">Errors</p>
                    <p className="text-lg font-bold text-red-400 font-mono">{uploadResult.errors}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <a
                    href="/controller"
                    className="flex-1 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs rounded-lg transition-all text-center flex items-center justify-center gap-1.5"
                  >
                    <MaterialIcon name="tune" size={16} />
                    <span>Go to Controller Console</span>
                  </a>
                  <button
                    onClick={() => {
                      setShowUploadModal(false);
                      setUploadResult(null);
                      fetchPreview();
                    }}
                    className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-slate-300 leading-relaxed">
                  You are about to insert <strong>{data?.validRows}</strong> valid participant records into table <code className="text-cyan-400 bg-slate-950 px-1 py-0.5 rounded font-mono">cse_fest_2026_participants</code>.
                </p>

                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block">
                    Upload Ingestion Mode
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setUploadMode('append')}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        uploadMode === 'append'
                          ? 'bg-cyan-950/40 border-cyan-500 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-xs">
                        <MaterialIcon name="add_circle" size={16} className="text-cyan-400" />
                        <span>Append / Upsert</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Adds new participants alongside existing records.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setUploadMode('replace')}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        uploadMode === 'replace'
                          ? 'bg-rose-950/40 border-rose-500 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-xs text-rose-300">
                        <MaterialIcon name="restart_alt" size={16} className="text-rose-400" />
                        <span>Fresh Overwrite</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Clears existing participants and performs clean seed.
                      </p>
                    </button>
                  </div>
                </div>

                <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setShowUploadModal(false)}
                    disabled={isUploading}
                    className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition-colors"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={handleCommitUpload}
                    disabled={isUploading}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow-lg shadow-emerald-950/50 transition-all flex items-center gap-2 disabled:opacity-50"
                  >
                    {isUploading ? (
                      <>
                        <MaterialIcon name="sync" size={16} className="animate-spin" />
                        <span>Uploading to Supabase...</span>
                      </>
                    ) : (
                      <>
                        <MaterialIcon name="check" size={16} />
                        <span>Confirm & Write to DB</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
