'use client';

import MovementLogsTab from '@/components/project-tabs/MovementLogsTab';

export default function MovementLogsPage() {
  return (
    <div className="p-8 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Global Movement Logs</h1>
          <p className="text-slate-600 mt-1">Track all material movements across the system</p>
        </div>
        <MovementLogsTab />
      </div>
    </div>
  );
} 
