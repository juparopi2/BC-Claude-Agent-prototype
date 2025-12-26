/**
 * PersistenceIndicator Component
 *
 * Visual indicator showing the persistence state of a message.
 * Displays different icons based on whether the message is pending,
 * persisted, failed, or transient.
 *
 * @module presentation/chat/PersistenceIndicator
 */

import { Check, Clock, AlertCircle } from 'lucide-react';
import type { PersistenceState } from '@bc-agent/shared';
import { cn } from '@/lib/utils';

export interface PersistenceIndicatorProps {
  /** Current persistence state of the message */
  state?: PersistenceState;
  /** Additional CSS classes */
  className?: string;
  /** Size variant */
  size?: 'sm' | 'md';
}

/**
 * Displays a visual indicator for message persistence state.
 *
 * States:
 * - persisted: Checkmark icon (success)
 * - pending/queued: Clock icon (loading, animated)
 * - failed: Alert icon (error)
 * - transient: No indicator (streaming content)
 *
 * @example
 * ```tsx
 * <PersistenceIndicator state="persisted" />
 * <PersistenceIndicator state="pending" size="sm" />
 * ```
 */
export function PersistenceIndicator({
  state,
  className,
  size = 'sm',
}: PersistenceIndicatorProps) {
  const sizeClasses = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';

  // Transient events (streaming) don't show indicator
  if (state === 'transient' || !state) {
    return null;
  }

  // Successfully persisted
  if (state === 'persisted') {
    return (
      <Check
        className={cn(sizeClasses, 'text-muted-foreground', className)}
        aria-label="Message saved"
        data-testid="persistence-indicator-persisted"
      />
    );
  }

  // Pending or queued (waiting for persistence)
  if (state === 'pending' || state === 'queued') {
    return (
      <Clock
        className={cn(sizeClasses, 'text-muted-foreground animate-pulse', className)}
        aria-label="Saving message"
        data-testid="persistence-indicator-pending"
      />
    );
  }

  // Failed persistence
  if (state === 'failed') {
    return (
      <AlertCircle
        className={cn(sizeClasses, 'text-destructive', className)}
        aria-label="Failed to save message"
        data-testid="persistence-indicator-failed"
      />
    );
  }

  return null;
}
