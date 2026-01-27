'use client';

/**
 * SessionExpiryBanner Component
 *
 * Displays a warning banner when the user's session is about to expire.
 * Allows users to extend their session with a single click.
 *
 * @module components/auth/SessionExpiryBanner
 */

import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSessionHealth, useAuthStore, AUTH_TIME_MS } from '@/src/domains/auth';
import { cn } from '@/lib/utils';

/**
 * Format time remaining in human-readable format
 */
function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return 'now';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

export interface SessionExpiryBannerProps {
  /** Custom class name */
  className?: string;
  /** Callback when session is extended */
  onExtended?: () => void;
  /** Callback when session expires */
  onExpired?: () => void;
}

/**
 * SessionExpiryBanner
 *
 * Shows a warning banner when the session is expiring.
 * Automatically updates the countdown and provides an extend button.
 */
export function SessionExpiryBanner({
  className,
  onExtended,
  onExpired,
}: SessionExpiryBannerProps) {
  const [isExtending, setIsExtending] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  const checkAuth = useAuthStore((s) => s.checkAuth);
  const connectSocket = useAuthStore((s) => s.connectSocket);

  const {
    isExpiring,
    isExpired,
    timeUntilExpiry,
    refresh,
  } = useSessionHealth({
    pollInterval: AUTH_TIME_MS.HEALTH_POLL_INTERVAL,
    onExpired: () => {
      onExpired?.();
    },
  });

  // Update countdown timer
  useEffect(() => {
    if (!isExpiring || isDismissed) {
      setTimeLeft(null);
      return;
    }

    // Initialize with current value
    if (timeUntilExpiry !== null) {
      setTimeLeft(timeUntilExpiry);
    }

    // Update every second
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev === null || prev <= 0) return 0;
        return Math.max(0, prev - 1000);
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isExpiring, isDismissed, timeUntilExpiry]);

  // Reset dismissed state when status changes
  useEffect(() => {
    if (!isExpiring) {
      setIsDismissed(false);
    }
  }, [isExpiring]);

  // Handle extend session
  const handleExtend = useCallback(async () => {
    setIsExtending(true);
    try {
      const success = await checkAuth();
      if (success) {
        await refresh();
        // Reconnect socket after session extension
        await connectSocket();
        onExtended?.();
        setIsDismissed(true);
      }
    } catch (error) {
      console.error('[SessionExpiryBanner] Failed to extend session:', error);
    } finally {
      setIsExtending(false);
    }
  }, [checkAuth, connectSocket, refresh, onExtended]);

  // Don't show if not expiring, dismissed, or expired
  if (!isExpiring || isDismissed || isExpired) {
    return null;
  }

  // Determine if using relative or fixed positioning
  const isRelative = className?.includes('relative');

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        // Use fixed positioning by default, but allow override to relative
        isRelative ? 'relative' : 'fixed top-0 left-0 right-0 z-50',
        'bg-amber-500/95 text-amber-950',
        'px-4 py-3',
        'flex items-center justify-center gap-4',
        'shadow-lg backdrop-blur-sm',
        'animate-in slide-in-from-top duration-300',
        // Filter out 'relative' from className since we handle it above
        className?.replace('relative', '').trim() || undefined
      )}
    >
      <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />

      <span className="text-sm font-medium">
        Your session expires in{' '}
        <span className="font-bold tabular-nums">
          {timeLeft !== null ? formatTimeRemaining(timeLeft) : '...'}
        </span>
      </span>

      <Button
        variant="secondary"
        size="sm"
        onClick={handleExtend}
        disabled={isExtending}
        className="bg-amber-950 text-amber-50 hover:bg-amber-900"
      >
        {isExtending ? (
          <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          'Extend session'
        )}
      </Button>

      <button
        type="button"
        onClick={() => setIsDismissed(true)}
        className="ml-2 p-1 rounded-full hover:bg-amber-400/50 transition-colors"
        aria-label="Dismiss warning"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
