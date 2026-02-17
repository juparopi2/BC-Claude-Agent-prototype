/**
 * Service Worker Registration
 *
 * Registers the Golden Retriever service worker for upload crash recovery.
 * Guarded for SSR and browser compatibility.
 *
 * @module infrastructure/upload/registerServiceWorker
 */

export async function registerServiceWorker(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  try {
    await navigator.serviceWorker.register('/sw.js', { type: 'module' });
  } catch (error) {
    // Service worker registration failure is non-fatal
    console.warn('[registerServiceWorker] Registration failed:', error);
  }
}
