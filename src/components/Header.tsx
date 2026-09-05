import React from 'react';
import { FolderCode, CheckCircle2 } from 'lucide-react';

export const Header: React.FC = () => {
  return (
    <header className="border-b border-stone-200 bg-stone-50/80 backdrop-blur-xs">
      <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-stone-900 text-stone-50 flex items-center justify-center shadow-xs">
            <FolderCode className="w-5 h-5 text-stone-200" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-stone-900 tracking-tight">Project Workspace</h1>
            <p className="text-xs text-stone-500">React 19 • TypeScript • Tailwind CSS</p>
          </div>
        </div>

        <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          <span>Structure Ready</span>
        </div>
      </div>
    </header>
  );
};
