'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useWaitlist } from '@/src/domains/marketing/hooks/useWaitlist';

export function WaitlistForm() {
  const [email, setEmail] = useState('');
  const t = useTranslations('Marketing.waitlist');
  const { status, errorMessage, handleSubmit } = useWaitlist();

  if (status === 'success') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 p-6 text-center"
      >
        <p className="text-lg font-semibold text-foreground">{t('form.success.title')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('form.success.message')}</p>
      </div>
    );
  }

  return (
    <div>
      <form
        onSubmit={(e) => handleSubmit(e, email)}
        className="flex flex-col gap-3 sm:flex-row sm:gap-2"
      >
        <label htmlFor="waitlist-email" className="sr-only">
          {t('form.emailPlaceholder')}
        </label>
        <input
          id="waitlist-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('form.emailPlaceholder')}
          disabled={status === 'submitting'}
          aria-invalid={status === 'error'}
          aria-describedby={status === 'error' ? 'waitlist-error' : undefined}
          className="flex-1 rounded-lg border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={status === 'submitting' || !email.trim()}
          className="rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {status === 'submitting' ? t('form.submitting') : t('form.submit')}
        </button>
      </form>

      {status === 'error' && errorMessage && (
        <div
          id="waitlist-error"
          role="alert"
          aria-live="assertive"
          className="mt-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <p className="font-medium">{t('form.error.title')}</p>
          <p className="mt-1">
            {errorMessage === 'form.error.unimplemented'
              ? t('form.error.unimplemented')
              : t('form.error.message')}
          </p>
        </div>
      )}
    </div>
  );
}
