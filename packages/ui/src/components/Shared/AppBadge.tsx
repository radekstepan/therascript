// packages/ui/src/components/Shared/AppBadge.tsx
import React from 'react';
import { Badge } from '@radix-ui/themes';

export type AppBadgeProps = Omit<React.ComponentProps<typeof Badge>, 'radius'>;

/**
 * App-wide label/badge. Always prefer this over Radix `Badge` directly
 * so label styling stays consistent across pages.
 *
 * The `radius` prop is intentionally omitted: badges inherit the theme
 * default (`radius="medium"` in App.tsx) and render as subtly-rounded
 * rectangles like the Fact Check labels — never full-radius pills.
 */
export function AppBadge(props: AppBadgeProps) {
  return <Badge {...props} />;
}
