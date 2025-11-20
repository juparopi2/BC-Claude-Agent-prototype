/**
 * Global Error Handlers Component
 *
 * Captures unhandled errors and promise rejections at the window level.
 * Must be a client component to use browser APIs.
 *
 * Usage: Include once in root layout
 */

'use client';

import { useEffect } from 'react';
import { logger } from '@/lib/logger';

export function GlobalErrorHandlers() {
  useEffect(() => {
    // Handle unhandled promise rejections
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      logger.error('Unhandled promise rejection', event.reason, {
        type: 'unhandledRejection',
        promise: String(event.promise),
      });
    };

    // Handle global errors
    const handleError = (event: ErrorEvent) => {
      logger.error('Global error', event.error, {
        type: 'globalError',
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    };

    // Add event listeners
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleError);

    // Cleanup
    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleError);
    };
  }, []);

  // This component doesn't render anything
  return null;
}
