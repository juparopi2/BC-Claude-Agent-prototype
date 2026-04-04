'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import {
  gsap,
  useGSAP,
  SplitText,
} from '@/src/domains/marketing/hooks/useScrollAnimation';
import { Database, BookOpen, Workflow, BarChart3, Search, Cloud } from 'lucide-react';
import { FeatureCard } from './FeatureCard';
import { SecuritySection } from './SecuritySection';

const FEATURE_ITEMS = [
  { i18nKey: 'erp', icon: Database, color: '#3B82F6' },          // BC Agent
  { i18nKey: 'knowledge', icon: BookOpen, color: '#10B981' },     // RAG Agent
  { i18nKey: 'orchestration', icon: Workflow, color: '#8B5CF6' }, // Supervisor
  { i18nKey: 'visualization', icon: BarChart3, color: '#F59E0B' },// Graphing Agent
  { i18nKey: 'research', icon: Search, color: '#6366F1' },        // Research Agent
  { i18nKey: 'files', icon: Cloud, color: '#3B82F6' },            // Corporate blue
] as const;

export function FeaturesSection() {
  const containerRef = useRef<HTMLElement>(null);
  const t = useTranslations('Marketing.features');

  useGSAP(
    () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      gsap.set('.features-badge', { opacity: 0, y: -15 });
      gsap.set('.features-title', { opacity: 0 });
      gsap.set('.features-subtitle', { opacity: 0, y: 20 });
      gsap.set('.feature-card', { opacity: 0, y: 30 });

      const split = new SplitText('.features-title', {
        type: 'words',
        wordsClass: 'inline-block overflow-hidden pb-[0.15em]',
      });
      gsap.set(split.words, { y: '100%', opacity: 0 });

      const tl = gsap.timeline({
        defaults: { ease: 'power3.out' },
        scrollTrigger: {
          trigger: containerRef.current,
          start: 'top 75%',
          once: true,
        },
      });

      tl.to('.features-badge', { opacity: 1, y: 0, duration: 0.4 })
        .to(split.words, { y: '0%', opacity: 1, duration: 0.5, stagger: 0.04 }, '-=0.2')
        .to('.features-title', { opacity: 1, duration: 0.3 }, '<')
        .to('.features-subtitle', { opacity: 1, y: 0, duration: 0.5 }, '-=0.2')
        .to('.feature-card', {
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
    <section
      id="features"
      ref={containerRef}
      aria-label="Platform features"
      className="py-[var(--marketing-section-gap-lg)] px-4 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-[var(--marketing-container-max-width)]">
        <div className="mb-12 flex flex-col items-center gap-3 text-center">
          <div className="features-badge inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-4 py-1.5 text-sm font-medium text-foreground">
            <span
              aria-hidden="true"
              className="h-2 w-2 animate-pulse rounded-full"
              style={{ backgroundColor: 'var(--marketing-hero-from)' }}
            />
            {t('badge')}
          </div>
          <h2 className="features-title text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl" style={{ fontFamily: 'var(--font-marketing-heading)' }}>
            {t('title')}
          </h2>
          <p className="features-subtitle max-w-2xl text-base text-muted-foreground sm:text-lg">
            {t('subtitle')}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURE_ITEMS.map((item) => (
            <FeatureCard
              key={item.i18nKey}
              icon={item.icon}
              color={item.color}
              title={t(`items.${item.i18nKey}.title`)}
              description={t(`items.${item.i18nKey}.description`)}
              highlight={t(`items.${item.i18nKey}.highlight`)}
            />
          ))}
        </div>

        <SecuritySection />
      </div>
    </section>
  );
}
