'use client';

import React from 'react';
import { Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface RainbowButtonProps
  extends Omit<React.ComponentProps<typeof Button>, 'variant'> {
  /** When true, renders with an accent fill + subtle animated rainbow shimmer. */
  active?: boolean;
}

/**
 * RainbowButton
 *
 * Applies an animated rainbow border directly to the Button element via the
 * background-clip trick:
 *   - Layer 1 (fill): clipped to padding-box → covers the button interior
 *   - Layer 2 (rainbow gradient): clipped to border-box → visible only in the
 *     1.5px transparent border ring
 *
 * No wrapper element needed. The Button itself carries both the rainbow border
 * and all structural styles (padding, font, radius) from its CVA variant.
 *
 * background-color is forced transparent so Tailwind ghost hover classes
 * (hover:bg-accent) cannot bleed into the border area; the hover fill
 * is controlled entirely via background-image in the CSS classes.
 */
const RainbowButton = React.forwardRef<HTMLButtonElement, RainbowButtonProps>(
  ({ className, active = false, size = 'icon-sm', style, children, ...props }, ref) => (
    <Button
      ref={ref}
      size={size}
      variant="ghost"
      style={style}
      className={cn(
        '!text-xs rainbow-border',
        active ? 'rainbow-border-active' : 'rainbow-border-inactive',
        className,
      )}
      {...props}
    >
      <Zap className="size-3.5 shrink-0" />
      {children}
    </Button>
  ),
);

RainbowButton.displayName = 'RainbowButton';

export { RainbowButton };
