'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { gsap, useGSAP, SplitText } from '@/src/domains/marketing/hooks/useScrollAnimation';
import { HeroBackground } from './HeroBackground';
import { HeroBadge } from './HeroBadge';
import { HeroHeadline } from './HeroHeadline';
import { HeroSubtitle } from './HeroSubtitle';
import { HeroCTA } from './HeroCTA';
import { HeroStats, type StatItem } from './HeroStats';
import { HeroVisual } from './HeroVisual';
import { HeroMicrosoftBadges } from './HeroMicrosoftBadges';

export function HeroSection() {
  const containerRef = useRef<HTMLElement>(null);
  const t = useTranslations('Marketing.hero');

  const stats: StatItem[] = [
    { value: t('stats.agents.value'), label: t('stats.agents.label') },
    { value: t('stats.integrations.value'), label: t('stats.integrations.label') },
    { value: t('stats.chartTypes.value'), label: t('stats.chartTypes.label') },
  ];

  useGSAP(
    () => {
      // 1. Check prefers-reduced-motion first — if enabled, content stays visible as-is
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prefersReducedMotion) return;

      // 2. Set initial invisible states AFTER motion check
      gsap.set('.hero-badge', { opacity: 0, y: -20 });
      gsap.set('.hero-headline', { opacity: 0 });
      gsap.set('.hero-subtitle', { opacity: 0, y: 20 });
      gsap.set('.hero-cta > *', { opacity: 0, y: 30 });
      gsap.set('.hero-stat-item', { opacity: 0, y: 20 });
      gsap.set('.hero-visual', { opacity: 0, scale: 0.95 });
      gsap.set('.hero-badges', { opacity: 0 });

      // 3. Create SplitText on the headline h1
      const split = new SplitText('.hero-headline', {
        type: 'words',
        wordsClass: 'hero-headline-word inline-block overflow-hidden',
      });

      // 4. Set initial state for split words
      gsap.set(split.words, { y: '100%', opacity: 0 });

      // 5. Build master timeline
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

      tl.to('.hero-badge', { opacity: 1, y: 0, duration: 0.6 })
        .to(split.words, { y: '0%', opacity: 1, duration: 0.6, stagger: 0.05 }, '-=0.3')
        .to('.hero-headline', { opacity: 1, duration: 0.3 }, '<')
        .to('.hero-subtitle', { opacity: 1, y: 0, duration: 0.6 }, '-=0.2')
        .to('.hero-cta > *', { opacity: 1, y: 0, stagger: 0.15, duration: 0.5 }, '-=0.3')
        .to('.hero-stat-item', { opacity: 1, y: 0, stagger: 0.1, duration: 0.5 }, '-=0.2')
        // Count-up animation for stat values
        .add(() => {
          gsap.utils.toArray<HTMLElement>('.hero-stat-value').forEach((el) => {
            const target = Number(el.getAttribute('data-target') ?? '0');
            const suffix = el.getAttribute('data-suffix') ?? '';
            const proxy = { val: 0 };
            gsap.to(proxy, {
              val: target,
              duration: 1.5,
              ease: 'power2.out',
              onUpdate: () => {
                el.textContent = `${Math.round(proxy.val)}${suffix}`;
              },
            });
          });
        }, '-=0.3')
        .to('.hero-visual', { opacity: 1, scale: 1, duration: 0.8, ease: 'back.out(1.7)' }, '-=1.0')
        .to('.hero-badges', { opacity: 1, duration: 0.6 }, '-=0.4');

      // 6. Looping blob animations — independent of main timeline
      gsap.to('.hero-visual-blob-1', {
        x: 30,
        y: -20,
        duration: 6,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });
      gsap.to('.hero-visual-blob-2', {
        x: -20,
        y: 30,
        duration: 8,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });

      // 7. Cleanup — SplitText revert is critical; useGSAP handles tween cleanup
      return () => {
        split.revert();
      };
    },
    { scope: containerRef },
  );

  return (
    <section
      id="hero"
      ref={containerRef}
      className="hero-section relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 sm:px-6 lg:px-8"
    >
      <HeroBackground />
      <div className="relative z-10 mx-auto flex max-w-[var(--marketing-container-max-width)] flex-col items-center gap-6 text-center">
        <HeroBadge text={t('badge')} />
        <HeroHeadline text={t('title')} />
        <HeroSubtitle text={t('subtitle')} />
        <HeroCTA primaryLabel={t('cta.primary')} secondaryLabel={t('cta.secondary')} />
        <HeroStats items={stats} />
        <HeroVisual />
        <HeroMicrosoftBadges label={t('trustedBy')} />
      </div>
    </section>
  );
}
