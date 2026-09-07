// packages/ui/src/components/Shared/AppTooltip.tsx
import React from 'react';
import { Tooltip } from '@radix-ui/themes';

interface AppTooltipProps {
  /** Tooltip text. When empty/undefined, children render unwrapped (no native title). */
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  delayDuration?: number;
  disableHoverableContent?: boolean;
}

/**
 * App-wide tooltip. Always prefer this over the native `title` attribute
 * so styling/behavior stays consistent (Radix).
 *
 * IMPORTANT: never render AppTooltip as the DIRECT child of a Radix
 * `*Trigger` (e.g. `DropdownMenu.Trigger`, `Select.Trigger`). Those
 * triggers are `asChild` slot parents: they merge their ref and event
 * handlers into their direct child, and AppTooltip does not forward
 * them — the trigger silently stops working (menus no longer open).
 * Instead, wrap the whole trigger:
 *
 *   <AppTooltip content="...">
 *     <DropdownMenu.Trigger>
 *       <IconButton>...</IconButton>
 *     </DropdownMenu.Trigger>
 *   </AppTooltip>
 *
 * The direct child of AppTooltip itself must be a single element that
 * accepts a ref (DOM element or ref-forwarding Radix component).
 */
export function AppTooltip({
  content,
  children,
  side,
  align,
  delayDuration,
  disableHoverableContent,
}: AppTooltipProps) {
  if (content === undefined || content === null || content === '') {
    return <>{children}</>;
  }
  return (
    <Tooltip
      content={content}
      side={side}
      align={align}
      delayDuration={delayDuration}
      disableHoverableContent={disableHoverableContent}
    >
      {children as React.ReactElement}
    </Tooltip>
  );
}
