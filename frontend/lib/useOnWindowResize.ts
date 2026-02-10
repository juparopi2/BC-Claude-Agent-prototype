'use client';

import { useEffect } from 'react';

/**
 * Hook that runs a callback on window resize.
 */
export function useOnWindowResize(callback: () => void): void {
  useEffect(() => {
    const handler = () => callback();
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [callback]);
}
