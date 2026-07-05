// packages/ui/src/components/Layout/RestartScreen.tsx
import React, { useEffect, useState } from 'react';
import { RefreshCw, BrainCircuit, Check } from 'lucide-react';
import { cn } from '../../utils';

const STEPS = [
  'Stopping application services',
  'Tearing down Docker containers',
  'Restarting backend processes',
  'Restoring your session',
];

// Component is fully driven by the `step` prop. The parent derives `step` from
// real readiness signals (no fake timers, no setTimeout). When `step` reaches
// STEPS.length, all steps are done and we render the completion screen.
export function RestartScreen({ step }: { step: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const allDone = step >= STEPS.length;

  return (
    <div
      className={cn(
        'fixed inset-0 z-[9999] flex flex-col items-center justify-center',
        'bg-white dark:bg-slate-950 transition-opacity duration-500',
        visible ? 'opacity-100' : 'opacity-0'
      )}
    >
      {allDone ? <CompleteScreen /> : <ProgressScreen step={step} />}
    </div>
  );
}

function ProgressScreen({ step }: { step: number }) {
  return (
    <div className="flex flex-col items-center gap-8">
      <div className="flex items-center gap-2">
        <BrainCircuit
          size={16}
          className="text-slate-500 dark:text-slate-500"
        />
        <span className="text-slate-500 dark:text-slate-500 text-xs font-semibold tracking-[0.2em] uppercase">
          Therascript
        </span>
      </div>

      <div className="relative flex items-center justify-center">
        <div
          className="absolute w-32 h-32 rounded-full bg-blue-500/10 animate-ping"
          style={{ animationDuration: '2s' }}
        />
        <div
          className="absolute w-24 h-24 rounded-full bg-blue-500/10 animate-ping"
          style={{ animationDuration: '2s', animationDelay: '0.5s' }}
        />
        <div className="relative w-20 h-20 rounded-full bg-blue-500/5 dark:bg-blue-500/10 border border-blue-500/20 dark:border-blue-500/30 flex items-center justify-center">
          <RefreshCw
            size={36}
            className="text-blue-600 dark:text-blue-400 animate-spin"
            style={{ animationDuration: '3s' }}
          />
        </div>
      </div>

      <div className="text-center">
        <h1 className="text-slate-950 dark:text-white/90 text-2xl font-light tracking-tight">
          Restarting
        </h1>
        <p className="text-slate-600 dark:text-slate-500 text-sm mt-1">
          Services are coming back online
        </p>
      </div>

      <div className="flex flex-col gap-2.5 w-72">
        {STEPS.map((label, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <div
              key={label}
              className={cn(
                'flex items-center gap-3 transition-all duration-500',
                i > step ? 'opacity-30' : 'opacity-100'
              )}
            >
              <div
                className={cn(
                  'w-2 h-2 rounded-full flex-shrink-0 transition-colors duration-500',
                  done
                    ? 'bg-emerald-600 dark:bg-emerald-400'
                    : active
                      ? 'bg-blue-600 dark:bg-blue-400 animate-pulse'
                      : 'bg-slate-300 dark:bg-slate-700'
                )}
              />
              <span
                className={cn(
                  'text-sm transition-colors duration-500',
                  done
                    ? 'text-slate-500 dark:text-slate-500 line-through'
                    : active
                      ? 'text-slate-950 dark:text-white/90'
                      : 'text-slate-400 dark:text-slate-600'
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
  );
}

function CompleteScreen() {
  return (
    <div className="flex flex-col items-center gap-6">
      <div className="w-16 h-16 rounded-full bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 flex items-center justify-center">
        <Check size={28} className="text-blue-600 dark:text-blue-400" />
      </div>
      <div className="text-center">
        <h1 className="text-slate-950 dark:text-white/90 text-xl font-light tracking-tight">
          Restart complete
        </h1>
        <p className="text-slate-500 dark:text-slate-600 text-sm mt-1.5">
          Resuming your session…
        </p>
      </div>
      <div className="flex flex-col gap-1.5 w-56">
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
  );
}
