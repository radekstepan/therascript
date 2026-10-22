// packages/ui/src/components/Brand/TherascriptLogo.tsx
//
// Shared brand lockup: Lucide AudioLines waveform + lowercase wordmark
// with a signature terminal dot. Geometry comes from plan-logo.md §1;
// colors derive from the user's Radix accent preference (see
// therascript-logo.css): coordinated 11/12 palette steps plus a tinted
// dot, re-resolved per appearance by the theme root. The logo has no
// hover state; keyboard focus keeps a visible outline.
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
