'use client';

/**
 * ServiceWorkerProvider
 *
 * Registers the Golden Retriever service worker on mount
 * for upload crash recovery support.
 *
 * @module components/providers/ServiceWorkerProvider
 */

import { useEffect } from 'react';
import { registerServiceWorker } from '@/src/infrastructure/upload/registerServiceWorker';

export function ServiceWorkerProvider() {
  useEffect(() => {
    registerServiceWorker();
  }, []);

  return null;
}
