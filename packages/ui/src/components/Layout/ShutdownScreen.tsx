// packages/ui/src/components/Layout/ShutdownScreen.tsx
import React, { useEffect, useState } from 'react';
import { Power, BrainCircuit, Check } from 'lucide-react';
import { cn } from '../../utils';

const STEPS = [
  'Saving your work',
  'Stopping AI services',
  'Closing connections',
  'Shutting down',
];

// Each step becomes active at these ms offsets, then "all done" fires 1.5s after the last step
const STEP_INTERVAL = 1500;
const DONE_DELAY = STEPS.length * STEP_INTERVAL;

export function ShutdownScreen() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [allDone, setAllDone] = useState(false);
  const [finalVisible, setFinalVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));

    const stepTimers = STEPS.slice(0, -1).map((_, i) =>
      setTimeout(() => setStep(i + 1), (i + 1) * STEP_INTERVAL)
    );

    // Advance step past last index so all steps show as "done"
    const doneTimer = setTimeout(() => {
      setStep(STEPS.length);
      setAllDone(true);
      // Slight delay before crossfading to final screen
      setTimeout(() => setFinalVisible(true), 400);
    }, DONE_DELAY);

    return () => {
      stepTimers.forEach(clearTimeout);
      clearTimeout(doneTimer);
    };
  }, []);

  return (
    <div
      className={cn(
        'fixed inset-0 z-[9999] flex flex-col items-center justify-center',
        'bg-white dark:bg-slate-950 transition-opacity duration-500',
        visible ? 'opacity-100' : 'opacity-0'
      )}
    >
      {/* ── Progress screen ── */}
      <div
        className={cn(
          'flex flex-col items-center gap-8 transition-opacity duration-500 absolute',
          allDone ? 'opacity-0 pointer-events-none' : 'opacity-100'
        )}
      >
        {/* Branding */}
        <div className="flex items-center gap-2">
          <BrainCircuit
            size={16}
            className="text-slate-500 dark:text-slate-500"
          />
          <span className="text-slate-500 dark:text-slate-500 text-xs font-semibold tracking-[0.2em] uppercase">
            Therascript
          </span>
        </div>

        {/* Pulsing power icon */}
        <div className="relative flex items-center justify-center">
          <div
            className="absolute w-32 h-32 rounded-full bg-red-500/10 animate-ping"
            style={{ animationDuration: '2s' }}
          />
          <div
            className="absolute w-24 h-24 rounded-full bg-red-500/10 animate-ping"
            style={{ animationDuration: '2s', animationDelay: '0.5s' }}
          />
          <div className="relative w-20 h-20 rounded-full bg-red-500/5 dark:bg-red-500/10 border border-red-500/20 dark:border-red-500/30 flex items-center justify-center">
            <Power size={36} className="text-red-600 dark:text-red-400" />
          </div>
        </div>

        {/* Title */}
        <div className="text-center">
          <h1 className="text-slate-950 dark:text-white/90 text-2xl font-light tracking-tight">
            Shutting down
          </h1>
          <p className="text-slate-600 dark:text-slate-500 text-sm mt-1">
            Please wait while services are stopped
          </p>
        </div>

        {/* Animated steps */}
        <div className="flex flex-col gap-2.5 w-56">
          {STEPS.map((label, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <div
                key={label}
                className={cn(
                  'flex items-center gap-3 transition-all duration-500',
                  i > step ? 'opacity-20' : 'opacity-100'
                )}
              >
                <div
                  className={cn(
                    'w-2 h-2 rounded-full flex-shrink-0 transition-colors duration-500',
                    done
                      ? 'bg-emerald-600 dark:bg-emerald-400'
                      : active
                        ? 'bg-red-600 dark:bg-red-400 animate-pulse'
                        : 'bg-slate-300 dark:bg-slate-700'
                  )}
                />
                <span
                  className={cn(
                    'text-sm transition-colors duration-500',
                    done
                      ? 'text-slate-500 dark:text-slate-500'
                      : active
                        ? 'text-slate-950 dark:text-white/90'
                        : 'text-slate-400 dark:text-slate-700'
                  )}
                >
                  {label}
                </span>
                {done && (
                  <Check
                    size={12}
                    className="text-emerald-600 dark:text-emerald-400 ml-auto"
                  />
                )}
                {active && (
                  <span className="text-slate-500 dark:text-slate-600 text-xs ml-auto animate-pulse">
                    •••
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Final screen ── */}
      <div
        className={cn(
          'flex flex-col items-center gap-6 transition-opacity duration-700 absolute',
          finalVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
      >
        <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center">
          <Power size={28} className="text-slate-400 dark:text-slate-500" />
        </div>
        <div className="text-center">
          <h1 className="text-slate-600 dark:text-white/70 text-xl font-light tracking-tight">
            Application closed
          </h1>
          <p className="text-slate-500 dark:text-slate-600 text-sm mt-1.5">
            You may close this window
          </p>
        </div>
        <div className="flex flex-col gap-1.5 w-44">
          {STEPS.map((label) => (
            <div key={label} className="flex items-center gap-2.5">
              <Check
                size={11}
                className="text-slate-500 dark:text-slate-600 flex-shrink-0"
              />
              <span className="text-slate-500 dark:text-slate-600 text-xs">
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
