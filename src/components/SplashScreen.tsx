import { useEffect, useRef, useState } from 'react';
import clayHenMascot from '../assets/images/clay_hen_mascot_1794678825872.jpg';
import { ChickenSprite, CoinIcon, EggIcon } from './GameIcons';

interface SplashScreenProps {
  onComplete: () => void;
  displayDurationMs?: number;
  fadeDurationMs?: number;
}

export function SplashScreen({
  onComplete,
  displayDurationMs = 2000,
  fadeDurationMs = 550,
}: SplashScreenProps) {
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const completedRef = useRef(false);

  useEffect(() => {
    const finish = () => {
      if (completedRef.current) return;
      completedRef.current = true;
      onComplete();
    };

    const fadeTimer = window.setTimeout(() => {
      setIsFadingOut(true);
    }, displayDurationMs);

    const completeTimer = window.setTimeout(finish, displayDurationMs + fadeDurationMs);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(completeTimer);
    };
  }, [displayDurationMs, fadeDurationMs, onComplete]);

  return (
    <div
      role="status"
      aria-label="Loading ChickenLand Farm"
      onAnimationEnd={(e) => {
        if (isFadingOut && e.target === e.currentTarget && !completedRef.current) {
          completedRef.current = true;
          onComplete();
        }
      }}
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-[#EAF2DF] via-[#F4F8EC] to-[#FEF3C7] dark:from-[#0c130f] dark:via-[#111b15] dark:to-[#1a2216] px-6 select-none ${
        isFadingOut ? 'animate-splash-fade-out pointer-events-none' : ''
      }`}
    >
      <div className="animate-splash-pop clay-card p-7 flex flex-col items-center text-center max-w-xs w-full space-y-5">
        <div className="relative flex items-center justify-center animate-clay-float">
          <div className="w-32 h-32 rounded-[2.2rem] clay-card-warm p-2 flex items-center justify-center overflow-hidden">
            {!imgFailed ? (
              <img
                src={clayHenMascot}
                alt="Sculpted clay ChickenLand hen mascot with golden coin and egg"
                referrerPolicy="no-referrer"
                onError={() => setImgFailed(true)}
                className="w-full h-full object-cover rounded-[1.7rem]"
              />
            ) : (
              <ChickenSprite breed="leghorn" className="w-20 h-20 animate-chicken-bob" />
            )}
          </div>
          <div className="absolute -top-2.5 -right-2.5 w-10 h-10 rounded-2xl clay-icon-well flex items-center justify-center">
            <EggIcon className="w-6 h-6" />
          </div>
          <div className="absolute -bottom-2.5 -left-2.5 w-10 h-10 rounded-2xl clay-icon-well flex items-center justify-center">
            <CoinIcon className="w-6 h-6" />
          </div>
        </div>

        <div className="space-y-1.5">
          <h1 className="text-3xl font-extrabold tracking-tight text-stone-900 dark:text-stone-100">
            ChickenLand
          </h1>
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
            Clay Poultry Economy
          </p>
        </div>

        <div className="w-48 space-y-2">
          <div className="h-3 w-full rounded-full clay-inset p-0.5 overflow-hidden">
            <div className="h-full w-full rounded-full bg-gradient-to-r from-emerald-400 via-amber-400 to-amber-500 animate-splash-progress clay-shimmer-bar" />
          </div>
          <p className="text-[11px] font-semibold text-stone-500 dark:text-stone-400">
            Sculpting your coop &amp; fresh eggs...
          </p>
        </div>
      </div>
    </div>
  );
}
