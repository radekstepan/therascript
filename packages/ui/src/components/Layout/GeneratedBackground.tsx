// File: packages/ui/src/components/Layout/GeneratedBackground.tsx
import React from 'react';
import { useAtomValue } from 'jotai';
import { effectiveThemeAtom } from '../../store';

export const GeneratedBackground: React.FC = () => {
  const effectiveTheme = useAtomValue(effectiveThemeAtom);
  const isDark = effectiveTheme === 'dark';

  const wrapperStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    zIndex: -10,
    overflow: 'hidden',
    // Base background color
    backgroundColor: isDark ? 'rgb(10 10 12)' : 'rgb(250 250 252)',
  };

  return (
    <div style={wrapperStyle} aria-hidden="true">
      {/* 
        Modern, subtle background with large, blurry gradient orbs.
        These are positioned absolutely and blurred heavily to create a soft, ambient effect.
        We use the current accent color via CSS variables for integration.
      */}

      {/* Orb 1: Top Right - Primary Accent */}
      <div
        style={{
          position: 'absolute',
          top: '-20%',
          right: '-10%',
          width: '70vw',
          height: '70vw',
          borderRadius: '50%',
          background:
            'radial-gradient(circle, var(--accent-a3) 0%, transparent 70%)',
          filter: 'blur(100px)',
          opacity: isDark ? 0.4 : 0.6,
        }}
      />

      {/* Orb 2: Bottom Left - Secondary Accent (slightly shifted hue if we had one, sticking to accent for coherence) */}
      <div
        style={{
          position: 'absolute',
          bottom: '-20%',
          left: '-10%',
          width: '60vw',
          height: '60vw',
          borderRadius: '50%',
          background:
            'radial-gradient(circle, var(--accent-a2) 0%, transparent 70%)',
          filter: 'blur(80px)',
          opacity: isDark ? 0.3 : 0.5,
        }}
      />

      {/* Subtle overlay texture/noise could go here if desired, 
          but keeping it clean for now. */}
    </div>
  );
};
