'use client';

/**
 * GlobalBanners Component
 *
 * Renders global notification banners for session expiry and connection status.
 * Only shows banners when the user is authenticated.
 *
 * @module components/layout/GlobalBanners
 */

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { useAuthStore } from '@/src/domains/auth';
import { SessionExpiryBanner } from '@/components/auth/SessionExpiryBanner';
import { ConnectionStatusBanner } from './ConnectionStatusBanner';
import {
  useConnectionStore,
  selectShouldShowBanner,
} from '@/src/domains/connection';

/**
 * GlobalBanners
 *
 * Container for global notification banners.
 * Renders:
 * - ConnectionStatusBanner: Shows when WebSocket is disconnected/reconnecting
 * - SessionExpiryBanner: Shows when session is about to expire
 *
 * Uses a fixed container at the top of the viewport that stacks banners vertically.
 */
export function GlobalBanners() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const showConnectionBanner = useConnectionStore(selectShouldShowBanner);
  const router = useRouter();

  // Handle session expiration - redirect to login
  const handleSessionExpired = useCallback(() => {
    router.push('/login?reason=session_expired');
  }, [router]);

  // Don't render banners if not authenticated
  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex flex-col">
      {/* Connection status banner - stacked at top */}
      <ConnectionStatusBanner className="relative" />

      {/* Session expiry banner - stacked below connection banner if visible */}
      <SessionExpiryBanner
        onExpired={handleSessionExpired}
        className={showConnectionBanner ? 'relative' : undefined}
      />
    </div>
  );
}

export default GlobalBanners;
