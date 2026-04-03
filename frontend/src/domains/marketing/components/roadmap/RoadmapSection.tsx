'use client';

import { useRef, useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import {
  gsap,
  useGSAP,
  ScrollTrigger,
  SplitText,
} from '@/src/domains/marketing/hooks/useScrollAnimation';
import { ROADMAP_ITEMS } from '@/src/domains/marketing/content';
import type { RoadmapStatus } from '@/src/domains/marketing/content';
import { RoadmapFilter } from './RoadmapFilter';
import { RoadmapTimeline, type ResolvedRoadmapItem } from './RoadmapTimeline';

export function RoadmapSection() {
  const containerRef = useRef<HTMLElement>(null);
  const t = useTranslations('Marketing.roadmap');
  const [activeFilter, setActiveFilter] = useState<RoadmapStatus | 'all'>('all');

  // Resolve i18n for all items
  const resolvedItems: ResolvedRoadmapItem[] = ROADMAP_ITEMS.map((item) => ({
    key: item.i18nKey,
    title: t(`items.${item.i18nKey}.title`),
    description: t(`items.${item.i18nKey}.description`),
    status: item.status,
  }));

  // Status labels for RoadmapTimeline (4 statuses, no 'all')
  const statusLabelsRecord: Record<RoadmapStatus, string> = {
    live: t('statusLabels.live'),
    beta: t('statusLabels.beta'),
    development: t('statusLabels.development'),
    planned: t('statusLabels.planned'),
  };

  // Status labels for RoadmapFilter (includes 'all')
  const filterStatusLabels: Record<RoadmapStatus | 'all', string> = {
    all: t('statusLabels.all'),
    live: t('statusLabels.live'),
    beta: t('statusLabels.beta'),
    development: t('statusLabels.development'),
    planned: t('statusLabels.planned'),
  };

  // Entry animation
  useGSAP(
    () => {
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prefersReducedMotion) return;

      // Initial states
      gsap.set('.roadmap-badge', { opacity: 0, y: -15 });
      gsap.set('.roadmap-title', { opacity: 0 });
      gsap.set('.roadmap-subtitle', { opacity: 0, y: 20 });
      gsap.set('.roadmap-filter', { opacity: 0, y: 20 });
      gsap.set('.roadmap-item', { opacity: 0, y: 30 });
      gsap.set('.roadmap-timeline-line', { scaleY: 0 });

      // SplitText for title
      const split = new SplitText('.roadmap-title', {
        type: 'words',
        wordsClass: 'inline-block overflow-hidden pb-[0.15em]',
      });
      gsap.set(split.words, { y: '100%', opacity: 0 });

      // Scroll-triggered timeline
      const tl = gsap.timeline({
        defaults: { ease: 'power3.out' },
        scrollTrigger: {
          trigger: containerRef.current,
          start: 'top 75%',
          once: true,
        },
      });

      tl.to('.roadmap-badge', { opacity: 1, y: 0, duration: 0.4 })
        .to(split.words, { y: '0%', opacity: 1, duration: 0.5, stagger: 0.04 }, '-=0.2')
        .to('.roadmap-title', { opacity: 1, duration: 0.3 }, '<')
        .to('.roadmap-subtitle', { opacity: 1, y: 0, duration: 0.5 }, '-=0.2')
        .to('.roadmap-filter', { opacity: 1, y: 0, duration: 0.4 }, '-=0.2')
        .to('.roadmap-timeline-line', { scaleY: 1, duration: 0.6 }, '-=0.2')
        .to('.roadmap-item', { opacity: 1, y: 0, duration: 0.5, stagger: 0.08 }, '-=0.3');

      return () => {
        split.revert();
      };
    },
    { scope: containerRef },
  );

  // Filter animation — runs when activeFilter changes
  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!containerRef.current) return;

    const items = containerRef.current.querySelectorAll<HTMLElement>('.roadmap-item');

    items.forEach((item) => {
      const status = item.getAttribute('data-status');
      const shouldShow = activeFilter === 'all' || status === activeFilter;

      if (prefersReducedMotion) {
        item.style.display = shouldShow ? '' : 'none';
        item.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
        return;
      }

      if (shouldShow) {
        gsap.set(item, { display: '' });
        item.setAttribute('aria-hidden', 'false');
        gsap.to(item, { opacity: 1, height: 'auto', duration: 0.3, ease: 'power2.out' });
      } else {
        gsap.to(item, {
          opacity: 0,
          height: 0,
          duration: 0.3,
          ease: 'power2.in',
          onComplete: () => {
            item.style.display = 'none';
            item.setAttribute('aria-hidden', 'true');
          },
        });
      }
    });
  }, [activeFilter]);

  function handleFilterChange(filter: RoadmapStatus | 'all') {
    gsap.killTweensOf('.roadmap-item');
    setActiveFilter(filter);
  }

  return (
    <section
      id="roadmap"
      ref={containerRef}
      aria-label="Product roadmap"
      className="py-[var(--marketing-section-gap)] px-4 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-[var(--marketing-container-max-width)]">
        {/* Header */}
        <div className="mb-12 text-center">
          <span className="roadmap-badge inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-4 py-1.5 text-sm font-medium text-foreground">
            {t('badge')}
          </span>
          <h2 className="roadmap-title mt-6 text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            {t('title')}
          </h2>
          <p className="roadmap-subtitle mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            {t('subtitle')}
          </p>
        </div>

        {/* Filter */}
        <RoadmapFilter
          activeFilter={activeFilter}
          onFilterChange={handleFilterChange}
          statusLabels={filterStatusLabels}
        />

        {/* Timeline — always receives ALL items; filter controls visibility via GSAP */}
        <div className="mx-auto max-w-2xl">
          <RoadmapTimeline items={resolvedItems} statusLabels={statusLabelsRecord} />
        </div>
      </div>
    </section>
  );
}
