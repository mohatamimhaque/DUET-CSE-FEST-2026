import React from 'react';

interface DuetFestIntroProps {
  phaseText?: string;
  size?: 'normal' | 'large' | 'compact';
}

export const DuetFestIntro: React.FC<DuetFestIntroProps> = ({
  phaseText = 'READY • NEXT: WINNER #01 OF 10',
  size = 'normal',
}) => {
  const isCompact = size === 'compact';

  return (
    <div className={`relative w-full ${isCompact ? 'max-w-xl p-2' : 'max-w-4xl p-2 sm:p-4'} mx-auto flex flex-col items-center justify-center select-none animate-in fade-in zoom-in-95 duration-500`}>
      {/* Volumetric Cybernetic Ambient Glows */}
      <div className="absolute inset-0 -z-10 flex items-center justify-center pointer-events-none">
        <div className={`${isCompact ? 'w-64 h-48' : 'w-96 sm:w-[500px] h-80 sm:h-[400px]'} rounded-full bg-cyan-600/15 blur-[100px]`} />
        <div className={`${isCompact ? 'w-48 h-36' : 'w-80 sm:w-96 h-64 sm:h-80'} rounded-full bg-amber-500/15 blur-[80px]`} />
      </div>

      {/* Cyber Frame Container matching image.png */}
      <div className={`relative w-full ${isCompact ? 'py-5 px-4 sm:py-6 sm:px-6 rounded-2xl' : 'py-10 px-6 sm:py-14 sm:px-14 md:py-16 md:px-20 rounded-[32px] sm:rounded-[44px]'} overflow-hidden border border-cyan-500/30 bg-gradient-to-b from-[#080e1e]/90 via-[#060b17]/95 to-[#040710]/98 shadow-[0_0_80px_rgba(6,182,212,0.18)] backdrop-blur-2xl transition-all duration-300`}>
        {/* Subtle Tech Grid / Isometric Dots Lattice */}
        <div className="absolute inset-0 opacity-20 pointer-events-none">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="fest-grid-lattice" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M20 0 L40 20 L20 40 L0 20 Z" fill="none" stroke="#22d3ee" strokeWidth="0.5" strokeOpacity="0.4" />
                <circle cx="20" cy="20" r="1.5" fill="#38bdf8" fillOpacity="0.7" />
                <circle cx="0" cy="0" r="1.2" fill="#38bdf8" fillOpacity="0.5" />
                <circle cx="40" cy="0" r="1.2" fill="#38bdf8" fillOpacity="0.5" />
                <circle cx="40" cy="40" r="1.2" fill="#38bdf8" fillOpacity="0.5" />
                <circle cx="0" cy="40" r="1.2" fill="#38bdf8" fillOpacity="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#fest-grid-lattice)" />
          </svg>
        </div>

        {/* Main Brand Content */}
        <div className={`relative z-10 flex flex-col items-center text-center ${isCompact ? 'space-y-2.5' : 'space-y-4 sm:space-y-5'}`}>
          {/* Top Pill: DHAKA UNIVERSITY OF ENGINEERING & TECHNOLOGY */}
          <div className={`inline-flex items-center gap-2 ${isCompact ? 'px-3 py-1 text-[9px] tracking-wider' : 'px-5 sm:px-7 py-1.5 sm:py-2 text-[11px] sm:text-xs md:text-sm tracking-[0.2em]'} rounded-full font-mono font-bold text-cyan-300 bg-cyan-950/40 border border-cyan-400/40 shadow-[0_0_20px_rgba(6,182,212,0.25)] backdrop-blur-md`}>
            <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-cyan-400 shadow-[0_0_10px_#22d3ee] animate-pulse" />
            DHAKA UNIVERSITY OF ENGINEERING & TECHNOLOGY
          </div>

          {/* D U E T */}
          <div className={`text-cyan-400 font-display font-black tracking-[0.35em] ${isCompact ? 'text-lg sm:text-xl mt-1' : 'text-2xl sm:text-3xl md:text-5xl mt-2 sm:mt-4'} drop-shadow-[0_0_25px_rgba(6,182,212,0.9)] uppercase pl-[0.35em]`}>
            DUET
          </div>

          {/* CSE FEST 2026 Emblem with golden backlight behind 2026 */}
          <div className="relative my-1 flex flex-col items-center">
            {/* Golden radial aura behind 2026 */}
            <div className="absolute right-0 sm:right-4 top-1/2 -translate-y-1/2 -z-10 w-32 sm:w-48 h-24 sm:h-36 rounded-full bg-amber-500/20 blur-[40px] pointer-events-none" />

            <div className="flex items-center justify-center gap-2 sm:gap-4 flex-wrap">
              <span className={`font-display font-black tracking-tight ${isCompact ? 'text-2xl sm:text-3xl' : 'text-4xl sm:text-6xl md:text-7xl lg:text-8xl'} text-white drop-shadow-[0_0_30px_rgba(255,255,255,0.6)] leading-none`}>
                CSE FEST
              </span>
              <span className={`font-display font-black tracking-tight ${isCompact ? 'text-2xl sm:text-3xl' : 'text-4xl sm:text-6xl md:text-7xl lg:text-8xl'} text-[#fbbf24] drop-shadow-[0_0_35px_rgba(251,191,36,0.85)] leading-none`}>
                2026
              </span>
            </div>

            {/* Subtitle: Department of Computer Science and Engineering */}
            <p className={`${isCompact ? 'text-[10px] sm:text-xs mt-1' : 'text-xs sm:text-sm md:text-base mt-3 sm:mt-4'} font-semibold tracking-wider text-slate-300/90 font-display max-w-xl`}>
              Department of Computer Science and Engineering
            </p>
          </div>

          {/* Divider Line */}
          <div className="w-full max-w-xl h-px bg-gradient-to-r from-transparent via-slate-700/60 to-transparent my-1" />

          {/* Bottom Status Line */}
          <div className={`pt-1 w-full flex items-center justify-center gap-2 ${isCompact ? 'text-[10px] sm:text-xs' : 'text-xs sm:text-sm md:text-base'} font-mono font-bold tracking-widest text-cyan-200`}>
            <span className="text-amber-400 text-xs">🏅</span>
            <span className="uppercase tracking-[0.15em]">{phaseText}</span>
            <span className="text-amber-400 text-xs">🏅</span>
          </div>
        </div>
      </div>
    </div>
  );
};
