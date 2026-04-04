'use client';

import { Fragment, useRef } from 'react';
import { useTranslations } from 'next-intl';
import {
  gsap,
  useGSAP,
  SplitText,
} from '@/src/domains/marketing/hooks/useScrollAnimation';
import { ROADMAP_ITEMS, ROADMAP_STATUS_COLORS } from '@/src/domains/marketing/content';
import type { RoadmapStatus } from '@/src/domains/marketing/content';
import { RoadmapCard } from './RoadmapCard';

const STATUS_ORDER: RoadmapStatus[] = ['live', 'development', 'planned'];

export function RoadmapSection() {
  const containerRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const t = useTranslations('Marketing.roadmap');

  const resolvedItems = ROADMAP_ITEMS.map((item) => ({
    key: item.i18nKey,
    title: t(`items.${item.i18nKey}.title`),
    description: t(`items.${item.i18nKey}.description`),
    status: item.status,
  }));

  const statusLabels: Record<RoadmapStatus, string> = {
    live: t('statusLabels.live'),
    beta: t('statusLabels.beta'),
    development: t('statusLabels.development'),
    planned: t('statusLabels.planned'),
  };

  // Group items by status for section labels in the horizontal track
  const groupedItems = STATUS_ORDER.map((status) => ({
    status,
    label: statusLabels[status],
    color: ROADMAP_STATUS_COLORS[status],
    items: resolvedItems.filter((item) => item.status === status),
  })).filter((group) => group.items.length > 0);

  useGSAP(
    () => {
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prefersReducedMotion || !trackRef.current || !containerRef.current) return;

      const track = trackRef.current;

      // --- Shared spotlight logic ---
      const allCards = gsap.utils.toArray<HTMLElement>('.roadmap-card, .roadmap-group-label');

      function applySpotlight() {
        const viewportCenter = window.innerWidth / 2;
        const maxDist = window.innerWidth * 0.28;

        for (let i = 0; i < allCards.length; i++) {
          const card = allCards[i];
          const rect = card.getBoundingClientRect();
          const cardCenter = rect.left + rect.width / 2;
          const distance = Math.abs(cardCenter - viewportCenter);
          const progress = Math.min(distance / maxDist, 1);
          const direction = cardCenter < viewportCenter ? -1 : 1;

          // Scale: 1.45 center → 0.6 edge
          const s = 1.45 - progress * 0.85;
          // Opacity: 1 center → 0.45 edge (readable side cards)
          const o = 1 - progress * 0.55;
          // Push neighbors away: 0px center → ±80px edge
          const pushX = direction * progress * 80;
          // Blur: very subtle, kicks in after 60% distance, max 1.5px
          const blurPx = progress > 0.6 ? (progress - 0.6) * 3.75 : 0;

          gsap.set(card, {
            scale: s,
            opacity: o,
            x: pushX,
            zIndex: Math.round((1 - progress) * 10),
            filter: blurPx > 0 ? `blur(${blurPx.toFixed(1)}px)` : 'none',
            boxShadow: progress < 0.1
              ? '0 30px 60px rgba(0,0,0,0.3), 0 0 50px rgba(59,130,246,0.25)'
              : 'none',
          });
        }
      }

      // --- Apply spotlight IMMEDIATELY so cards render in focused state ---
      applySpotlight();

      // --- Header entry animation (cards already visible in spotlight) ---
      gsap.set('.roadmap-badge', { opacity: 0, y: -15 });
      gsap.set('.roadmap-title', { opacity: 0 });
      gsap.set('.roadmap-subtitle', { opacity: 0, y: 20 });
      gsap.set('.roadmap-progress-fill', { scaleX: 0 });

      const split = new SplitText('.roadmap-title', {
        type: 'words',
        wordsClass: 'inline-block overflow-hidden pb-[0.15em]',
      });
      gsap.set(split.words, { y: '100%', opacity: 0 });

      gsap.timeline({
        defaults: { ease: 'power3.out' },
        scrollTrigger: {
          trigger: containerRef.current,
          start: 'top 80%',
          once: true,
        },
      })
        .to('.roadmap-badge', { opacity: 1, y: 0, duration: 0.4 })
        .to(split.words, { y: '0%', opacity: 1, duration: 0.5, stagger: 0.04 }, '-=0.2')
        .to('.roadmap-title', { opacity: 1, duration: 0.3 }, '<')
        .to('.roadmap-subtitle', { opacity: 1, y: 0, duration: 0.5 }, '-=0.2');

      // --- Horizontal scroll with pin ---
      const PIN_OFFSET = 80;
      const scrollDistance = track.scrollWidth - window.innerWidth;
      if (scrollDistance <= 0) return;

      gsap.to(track, {
        x: -scrollDistance,
        ease: 'none',
        scrollTrigger: {
          trigger: containerRef.current,
          pin: true,
          scrub: 0.5,
          start: `top ${PIN_OFFSET}px`,
          end: () => `+=${track.scrollWidth * 0.6}`,
          invalidateOnRefresh: true,
          onUpdate: (self) => {
            gsap.set('.roadmap-progress-fill', { scaleX: self.progress });
            applySpotlight();
          },
        },
      });

      return () => {
        split.revert();
      };
    },
    { scope: containerRef },
  );

  return (
    <section
      id="roadmap"
      ref={containerRef}
      aria-label="Product roadmap"
      className="roadmap-section relative flex h-screen flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 pt-6 sm:px-6 sm:pt-8 lg:px-8">
        <div className="mx-auto max-w-[var(--marketing-container-max-width)]">
          <div className="text-center">
            <span className="roadmap-badge inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-4 py-1.5 text-sm font-medium text-foreground">
              {t('badge')}
            </span>
            <h2
              className="roadmap-title mt-6 text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl"
              style={{ fontFamily: 'var(--font-marketing-heading)' }}
            >
              {t('title')}
            </h2>
            <p className="roadmap-subtitle mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
              {t('subtitle')}
            </p>
          </div>
        </div>
      </div>

      {/* Horizontal card track */}
      <div className="relative flex flex-1 items-center overflow-hidden">
        <div
          ref={trackRef}
          className="roadmap-track flex items-stretch gap-5 will-change-transform"
          style={{
            paddingLeft: '50vw',
            paddingRight: '50vw',
          }}
        >
          {groupedItems.map((group) => (
            <Fragment key={group.status}>
              {/* Group label card */}
              <div
                className="roadmap-group-label flex-shrink-0 flex w-[120px] sm:w-[150px] items-center justify-center rounded-2xl border border-dashed p-4"
                style={{ borderColor: group.color }}
              >
                <div className="flex flex-col items-center gap-2 text-center">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: group.color }}
                  />
                  <span
                    className="text-xs font-bold uppercase tracking-wider sm:text-sm"
                    style={{ color: group.color }}
                  >
                    {group.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {group.items.length}
                  </span>
                </div>
              </div>

              {/* Group feature cards */}
              {group.items.map((item) => (
                <RoadmapCard
                  key={item.key}
                  title={item.title}
                  description={item.description}
                  status={item.status}
                  statusLabel={statusLabels[item.status]}
                />
              ))}
            </Fragment>
          ))}
        </div>
      </div>

      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-border/30">
        <div
          className="roadmap-progress-fill h-full origin-left bg-gradient-to-r from-[var(--marketing-hero-from)] to-[var(--marketing-hero-to)]"
        />
      </div>
    </section>
  );
}
