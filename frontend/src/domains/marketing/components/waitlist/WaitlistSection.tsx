'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import {
  gsap,
  useGSAP,
  ScrollTrigger,
  SplitText,
} from '@/src/domains/marketing/hooks/useScrollAnimation';
import { WAITLIST_MOCK_COUNT } from '@/src/domains/marketing/content';
import { WaitlistForm } from './WaitlistForm';
import { WaitlistBenefits } from './WaitlistBenefits';

export function WaitlistSection() {
  const containerRef = useRef<HTMLElement>(null);
  const t = useTranslations('Marketing.waitlist');

  useGSAP(
    () => {
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prefersReducedMotion) return;

      // Initial states
      gsap.set('.waitlist-badge', { opacity: 0, y: -15 });
      gsap.set('.waitlist-title', { opacity: 0 });
      gsap.set('.waitlist-subtitle', { opacity: 0, y: 20 });
      gsap.set('.waitlist-form', { opacity: 0, y: 20 });
      gsap.set('.waitlist-count', { opacity: 0, y: 10 });
      gsap.set('.waitlist-benefit', { opacity: 0, y: 20 });

      // SplitText on heading
      const split = new SplitText('.waitlist-title', {
        type: 'words',
        wordsClass: 'inline-block overflow-hidden pb-[0.15em]',
      });
      gsap.set(split.words, { y: '100%', opacity: 0 });

      // Entrance timeline
      const tl = gsap.timeline({
        defaults: { ease: 'power3.out' },
        scrollTrigger: {
          trigger: containerRef.current,
          start: 'top 75%',
          once: true,
        },
      });

      tl.to('.waitlist-badge', { opacity: 1, y: 0, duration: 0.4 })
        .to(split.words, { y: '0%', opacity: 1, duration: 0.5, stagger: 0.04 }, '-=0.2')
        .to('.waitlist-title', { opacity: 1, duration: 0.3 }, '<')
        .to('.waitlist-subtitle', { opacity: 1, y: 0, duration: 0.5 }, '-=0.2')
        .to('.waitlist-form', { opacity: 1, y: 0, duration: 0.5 }, '-=0.2')
        .to('.waitlist-count', { opacity: 1, y: 0, duration: 0.4 }, '-=0.2')
        .to('.waitlist-benefit', { opacity: 1, y: 0, duration: 0.4, stagger: 0.08 }, '-=0.2');

      return () => {
        split.revert();
      };
    },
    { scope: containerRef },
  );

  return (
    <section
      id="waitlist"
      ref={containerRef}
      aria-label="Join the waitlist"
      className="py-[var(--marketing-section-gap-lg)] px-4 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-2xl text-center">
        {/* Badge */}
        <span className="waitlist-badge inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-4 py-1.5 text-sm font-medium text-foreground">
          {t('badge')}
        </span>

        {/* Title */}
        <h2 className="waitlist-title mt-6 text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
          {t('title')}
        </h2>

        {/* Subtitle */}
        <p className="waitlist-subtitle mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
          {t('subtitle')}
        </p>

        {/* Form wrapper — class for GSAP targeting */}
        <div className="waitlist-form mt-8">
          <WaitlistForm />
        </div>

        {/* Social proof count */}
        <p className="waitlist-count mt-6 text-sm text-muted-foreground">
          {t('count', { count: WAITLIST_MOCK_COUNT })}
        </p>

        {/* Benefits */}
        <div className="mt-8">
          <WaitlistBenefits
            benefits={{
              earlyAccess: t('benefits.earlyAccess'),
              pricing: t('benefits.pricing'),
              updates: t('benefits.updates'),
              feedback: t('benefits.feedback'),
            }}
          />
        </div>
      </div>
    </section>
  );
}
