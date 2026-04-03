'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import {
  gsap,
  useGSAP,
  ScrollTrigger,
  SplitText,
} from '@/src/domains/marketing/hooks/useScrollAnimation';
import { Shield, Users, KeyRound, Scale, ClipboardList, LogIn } from 'lucide-react';
import { COMING_SOON_FEATURES } from '@/src/domains/marketing/content/marketing-flags';
import { SecurityBadge } from './SecurityBadge';

const SECURITY_ITEMS = [
  { i18nKey: 'encryption', icon: Shield },
  { i18nKey: 'tenantIsolation', icon: Users },
  { i18nKey: 'permissions', icon: KeyRound },
  { i18nKey: 'gdpr', icon: Scale },
  { i18nKey: 'audit', icon: ClipboardList },
  { i18nKey: 'oauth', icon: LogIn },
] as const;

export function SecuritySection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const t = useTranslations('Marketing.security');

  useGSAP(
    () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      gsap.set('.security-section-badge', { opacity: 0, y: -15 });
      gsap.set('.security-section-title', { opacity: 0 });
      gsap.set('.security-section-subtitle', { opacity: 0, y: 20 });
      gsap.set('.security-badge', { opacity: 0, y: 30 });

      const split = new SplitText('.security-section-title', {
        type: 'words',
        wordsClass: 'inline-block overflow-hidden pb-[0.15em]',
      });
      gsap.set(split.words, { y: '100%', opacity: 0 });

      const tl = gsap.timeline({
        defaults: { ease: 'power3.out' },
        scrollTrigger: {
          trigger: containerRef.current,
          start: 'top 80%',
          once: true,
        },
      });

      tl.to('.security-section-badge', { opacity: 1, y: 0, duration: 0.4 })
        .to(split.words, { y: '0%', opacity: 1, duration: 0.5, stagger: 0.04 }, '-=0.2')
        .to('.security-section-title', { opacity: 1, duration: 0.3 }, '<')
        .to('.security-section-subtitle', { opacity: 1, y: 0, duration: 0.5 }, '-=0.2')
        .to('.security-badge', {
          opacity: 1,
          y: 0,
          duration: 0.5,
          stagger: 0.1,
        }, '-=0.2');

      return () => {
        split.revert();
      };
    },
    { scope: containerRef },
  );

  return (
    <div ref={containerRef} className="mt-16 sm:mt-20">
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        <div className="security-section-badge inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-4 py-1.5 text-sm font-medium text-foreground">
          <Shield className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          {t('badge')}
        </div>
        <h2 className="security-section-title text-2xl font-bold leading-snug tracking-tight text-foreground sm:text-3xl">
          {t('title')}
        </h2>
        <p className="security-section-subtitle max-w-2xl text-base text-muted-foreground">
          {t('subtitle')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {SECURITY_ITEMS.map((item) => (
          <SecurityBadge
            key={item.i18nKey}
            icon={item.icon}
            title={t(`items.${item.i18nKey}.title`)}
            description={t(`items.${item.i18nKey}.description`)}
            comingSoon={item.i18nKey in COMING_SOON_FEATURES}
          />
        ))}
      </div>
    </div>
  );
}
