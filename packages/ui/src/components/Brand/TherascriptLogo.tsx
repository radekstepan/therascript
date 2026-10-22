// packages/ui/src/components/Brand/TherascriptLogo.tsx
//
// Shared brand lockup: Lucide AudioLines waveform + lowercase wordmark
// with a signature green terminal dot. Specs come from plan-logo.md
// (light palette); dark values are designed tints so the lockup stays
// legible under the app's existing light/dark theme switch.
//
// Colors are fixed brand greens on purpose — they never follow the
// user's Radix accent preference, so the wordmark stays recognizable.
import React from 'react';
import { Link } from 'react-router-dom';
import { AudioLines } from 'lucide-react';
import { cn } from '../../utils';
import './therascript-logo.css';

export interface TherascriptLogoProps {
  /** 'full' renders mark + wordmark; 'mark' renders the waveform only. */
  variant?: 'full' | 'mark';
  /**
   * 'md' is the plan-exact 23px lockup; 'sm' is a compact version sized
   * for the app shell (sidebar header, splash screens).
   */
  size?: 'sm' | 'md';
  className?: string;
}

export function TherascriptLogo({
  variant = 'full',
  size = 'md',
  className,
}: TherascriptLogoProps) {
  return (
    <Link
      to="/"
      className={cn('brand-logo', `brand-logo--${size}`, className)}
      aria-label="Therascript home"
    >
      <span className="brand-logo__mark" aria-hidden="true">
        {/* Preserve Lucide's default stroke geometry; size only. */}
        <AudioLines size={size === 'sm' ? 20 : 23} />
      </span>
      {variant === 'full' && (
        <span className="brand-logo__wordmark">
          therascript<span className="brand-logo__dot">.</span>
        </span>
      )}
    </Link>
  );
}
