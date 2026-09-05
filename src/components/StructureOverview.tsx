import React from 'react';
import { FolderTree, FileCode2, Layers, Cpu, ArrowUpCircle } from 'lucide-react';
import { WorkspaceModule } from '../types';

const modules: WorkspaceModule[] = [
  {
    id: 'components',
    name: 'Components',
    path: 'src/components/',
    description: 'Place your custom UI components, layouts, and interactive widgets here.',
    status: 'ready',
  },
  {
    id: 'types',
    name: 'TypeScript Types',
    path: 'src/types.ts',
    description: 'Define your interfaces, data models, state types, and shared enumerations.',
    status: 'ready',
  },
  {
    id: 'utils',
    name: 'Utilities & Helpers',
    path: 'src/lib/utils.ts',
    description: 'Shared helper functions, formatters, and utility libraries.',
    status: 'ready',
  },
  {
    id: 'entry',
    name: 'Main Application Entry',
    path: 'src/App.tsx',
    description: 'Core application container ready to be replaced with your root component.',
    status: 'pending',
  },
];

export const StructureOverview: React.FC = () => {
  return (
    <div className="space-y-6">
      {/* Upload Callout */}
      <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-xs">
        <div className="flex items-start gap-4">
          <div className="p-2.5 rounded-lg bg-stone-100 text-stone-700">
            <ArrowUpCircle className="w-6 h-6 text-stone-700" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-stone-900">
              Ready for your existing code
            </h2>
            <p className="text-sm text-stone-600 leading-relaxed">
              Upload your files via the chat or file explorer, or paste code snippets directly.
              The project structure, dependencies, and Tailwind configuration are initialized.
            </p>
          </div>
        </div>
      </div>

      {/* Directory Structure Grid */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <FolderTree className="w-4 h-4 text-stone-500" />
          <h3 className="text-xs font-semibold tracking-wider text-stone-500 uppercase">
            Initialized Architecture
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {modules.map((item) => (
            <div
              key={item.id}
              className="p-4 rounded-xl border border-stone-200 bg-white hover:border-stone-300 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <FileCode2 className="w-4 h-4 text-stone-600" />
                  <span className="text-sm font-medium text-stone-900">{item.name}</span>
                </div>
                <code className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-stone-100 text-stone-600">
                  {item.path}
                </code>
              </div>
              <p className="text-xs text-stone-500 leading-relaxed">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Stack Badges */}
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
        <div className="flex items-center gap-2 mb-2 text-stone-600">
          <Cpu className="w-4 h-4" />
          <span className="text-xs font-medium uppercase tracking-wider text-stone-500">
            Environment & Libraries
          </span>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2.5 py-1 rounded-md bg-white border border-stone-200 text-stone-700 font-mono">
            React 19
          </span>
          <span className="px-2.5 py-1 rounded-md bg-white border border-stone-200 text-stone-700 font-mono">
            TypeScript 5.8
          </span>
          <span className="px-2.5 py-1 rounded-md bg-white border border-stone-200 text-stone-700 font-mono">
            Tailwind CSS 4
          </span>
          <span className="px-2.5 py-1 rounded-md bg-white border border-stone-200 text-stone-700 font-mono">
            Vite 6
          </span>
          <span className="px-2.5 py-1 rounded-md bg-white border border-stone-200 text-stone-700 font-mono">
            lucide-react
          </span>
          <span className="px-2.5 py-1 rounded-md bg-white border border-stone-200 text-stone-700 font-mono">
            motion
          </span>
        </div>
      </div>
    </div>
  );
};
