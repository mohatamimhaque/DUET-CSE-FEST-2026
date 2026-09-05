import React from 'react';

interface RestrictedPageBannerProps {
  pageName?: string;
  message?: string;
}

export const RestrictedPageBanner: React.FC<RestrictedPageBannerProps> = () => {
  return (
    <div
      id="restricted-banner-view"
      className="min-h-screen w-full bg-[#020617] flex items-center justify-center p-2 sm:p-6 md:p-8 select-none overflow-hidden relative"
    >
      {/* Ambient background glow matching Fest aesthetic */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center -z-10 overflow-hidden">
        <div className="w-[600px] h-[350px] rounded-full bg-cyan-600/10 blur-[140px]" />
        <div className="w-[500px] h-[300px] rounded-full bg-blue-900/15 blur-[120px]" />
      </div>

      {/* Only Event Banner Display */}
      <div className="w-full max-w-6xl flex items-center justify-center">
        <div className="relative w-full aspect-[1376/768] max-h-[92vh] rounded-2xl sm:rounded-3xl overflow-hidden border border-cyan-500/20 bg-slate-950 shadow-[0_0_80px_rgba(6,182,212,0.18)]">
          <img
            id="event-restricted-banner-img"
            src="/banner.jpg"
            alt="DUET CSE Fest 2026 Raffle Draw Banner"
            className="w-full h-full object-contain object-center"
          />
        </div>
      </div>
    </div>
  );
};

