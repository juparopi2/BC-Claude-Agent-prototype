'use client';

import { useState, useCallback } from 'react';
import { WAITLIST_ENABLED } from '@/src/domains/marketing/content';
import { WaitlistUnimplementedError } from '@/src/domains/marketing/errors/WaitlistUnimplementedError';

type WaitlistStatus = 'idle' | 'submitting' | 'success' | 'error';

interface UseWaitlistReturn {
  status: WaitlistStatus;
  /** i18n key sentinel: 'form.error.unimplemented' | 'form.error.message' */
  errorMessage: string | null;
  handleSubmit: (e: React.FormEvent, email: string) => Promise<void>;
  reset: () => void;
}

export function useWaitlist(): UseWaitlistReturn {
  const [status, setStatus] = useState<WaitlistStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = useCallback(async (e: React.FormEvent, email: string) => {
    e.preventDefault();

    // Basic validation — button is disabled when empty, so this is a safety net
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return;
    }

    setStatus('submitting');
    setErrorMessage(null);

    try {
      if (!WAITLIST_ENABLED) {
        throw new WaitlistUnimplementedError();
      }
      // TODO: Real API call when WAITLIST_ENABLED = true
      // await fetch('/api/marketing/waitlist', { method: 'POST', body: JSON.stringify({ email: trimmed }) });
      setStatus('success');
    } catch (error) {
      setStatus('error');
      if (error instanceof WaitlistUnimplementedError) {
        setErrorMessage('form.error.unimplemented');
      } else {
        setErrorMessage('form.error.message');
      }
    }
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setErrorMessage(null);
  }, []);

  return { status, errorMessage, handleSubmit, reset };
}
