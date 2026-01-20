'use client';

/**
 * ConnectionStatusBanner Component
 *
 * Displays a global banner when WebSocket connection is lost or reconnecting.
 * Shows retry attempts and allows manual retry when connection fails.
 *
 * @module components/layout/ConnectionStatusBanner
 */

import { useCallback } from 'react';
import { Wifi, WifiOff, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  useConnectionStore,
  selectConnectionMessage,
  selectShouldShowBanner,
} from '@/src/domains/connection';
import { getSocketClient } from '@/src/infrastructure/socket/SocketClient';
import { env } from '@/lib/config/env';
import { cn } from '@/lib/utils';

export interface ConnectionStatusBannerProps {
  /** Custom class name */
  className?: string;
}

/**
 * ConnectionStatusBanner
 *
 * Global banner that shows connection status.
 * Automatically appears when WebSocket is disconnected/reconnecting.
 */
export function ConnectionStatusBanner({
  className,
}: ConnectionStatusBannerProps) {
  const status = useConnectionStore((s) => s.status);
  const message = useConnectionStore(selectConnectionMessage);
  const shouldShow = useConnectionStore(selectShouldShowBanner);

  const handleRetry = useCallback(async () => {
    const socketClient = getSocketClient();
    useConnectionStore.getState().setConnecting();

    try {
      await socketClient.connect({ url: env.wsUrl });
    } catch (error) {
      console.error('[ConnectionStatusBanner] Retry failed:', error);
      useConnectionStore.getState().setFailed(
        error instanceof Error ? error.message : 'Retry failed'
      );
    }
  }, []);

  // Don't render if not needed
  if (!shouldShow || !message) {
    return null;
  }

  const isFailed = status === 'failed';
  const isConnecting = status === 'connecting' || status === 'reconnecting';

  // Determine if using relative or fixed positioning
  const isRelative = className?.includes('relative');

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        // Use fixed positioning by default, but allow override to relative
        isRelative ? 'relative' : 'fixed top-0 left-0 right-0 z-[60]',
        isFailed
          ? 'bg-red-500/95 text-white'
          : 'bg-yellow-500/95 text-yellow-950',
        'px-4 py-2',
        'flex items-center justify-center gap-3',
        'shadow-lg backdrop-blur-sm',
        'animate-in slide-in-from-top duration-300',
        // Filter out 'relative' from className since we handle it above
        className?.replace('relative', '').trim() || undefined
      )}
    >
      {/* Icon */}
      {isConnecting ? (
        <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden="true" />
      ) : isFailed ? (
        <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <Wifi className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}

      {/* Message */}
      <span className="text-sm font-medium">{message}</span>

      {/* Retry Button (only show when failed) */}
      {isFailed && (
        <Button
          variant="secondary"
          size="sm"
          onClick={handleRetry}
          className={cn(
            'ml-2',
            'bg-white/20 hover:bg-white/30',
            'text-white border-white/30'
          )}
        >
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
          Reintentar
        </Button>
      )}
    </div>
  );
}

export default ConnectionStatusBanner;
