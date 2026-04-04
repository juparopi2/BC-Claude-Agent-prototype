'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import {
  gsap,
  useGSAP,
  SplitText,
} from '@/src/domains/marketing/hooks/useScrollAnimation';
import {
  AGENT_UI_ORDER,
  AGENT_COLOR,
  AGENT_ICON,
  type AgentId,
} from '@/src/domains/marketing/content/agents';
import { AgentCard } from './AgentCard';

/** Reverse map: AgentId → i18n key in Marketing.agents.items */
const AGENT_ID_TO_I18N_KEY: Record<AgentId, string> = {
  supervisor: 'supervisor',
  'bc-agent': 'bcAgent',
  'rag-agent': 'ragAgent',
  'graphing-agent': 'graphingAgent',
  'research-agent': 'researchAgent',
};

/**
 * Bento grid positions (desktop 3-col):
 *
 * ┌──────────────────┬───────────┐
 * │   Orchestrator    │    KB     │
 * │   (col 1-2,       │  Expert   │
 * │    row 1-2)       ├───────────┤
 * │                   │  DataViz  │
 * ├───────────┬───────┴───────────┤
 * │ BC Expert │      Research     │
 * │           │    (col 2-3)      │
 * └───────────┴───────────────────┘
 */
const BENTO_POSITIONS: Record<AgentId, string> = {
  // Orchestrator: large card spanning 2 cols and 2 rows
  supervisor: 'lg:col-span-2 lg:row-span-2',
  // KB Expert: top-right
  'rag-agent': '',
  // DataViz: mid-right
  'graphing-agent': '',
  // BC Expert: bottom-left
  'bc-agent': '',
  // Research: bottom spanning 2 cols
  'research-agent': 'lg:col-span-2',
};

// Bento render order (different from AGENT_UI_ORDER to match grid positions)
const BENTO_ORDER: AgentId[] = [
  'supervisor',
  'rag-agent',
  'graphing-agent',
  'bc-agent',
  'research-agent',
];

export function AgentsSection() {
  const containerRef = useRef<HTMLElement>(null);
  const t = useTranslations('Marketing.agents');

  useGSAP(
    () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      gsap.set('.agents-badge', { opacity: 0, y: -15 });
      gsap.set('.agents-title', { opacity: 0 });
      gsap.set('.agents-subtitle', { opacity: 0, y: 20 });
      gsap.set('.agent-bento-item', { opacity: 0, y: 30, scale: 0.96 });

      const split = new SplitText('.agents-title', {
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

      tl.to('.agents-badge', { opacity: 1, y: 0, duration: 0.4 })
        .to(split.words, { y: '0%', opacity: 1, duration: 0.5, stagger: 0.04 }, '-=0.2')
        .to('.agents-title', { opacity: 1, duration: 0.3 }, '<')
        .to('.agents-subtitle', { opacity: 1, y: 0, duration: 0.5 }, '-=0.2')
        .to('.agent-bento-item', {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 0.6,
          stagger: 0.12,
          ease: 'back.out(1.2)',
        }, '-=0.2');

      // GSAP hover glow for agent cards
      const cleanups: (() => void)[] = [];
      const cards = containerRef.current?.querySelectorAll('.agent-card');
      cards?.forEach((card) => {
        const color = (card as HTMLElement).dataset.agentColor;
        if (!color) return;

        const enterHandler = () => {
          gsap.to(card, {
            boxShadow: `0 0 25px rgba(${hexToRgbStr(color)}, 0.25), 0 0 50px rgba(${hexToRgbStr(color)}, 0.1)`,
            scale: 1.01,
            duration: 0.3,
            ease: 'power2.out',
          });
        };
        const leaveHandler = () => {
          gsap.to(card, {
            boxShadow: '0 0 0 rgba(0,0,0,0)',
            scale: 1,
            duration: 0.3,
            ease: 'power2.out',
          });
        };

        card.addEventListener('mouseenter', enterHandler);
        card.addEventListener('mouseleave', leaveHandler);
        cleanups.push(() => {
          card.removeEventListener('mouseenter', enterHandler);
          card.removeEventListener('mouseleave', leaveHandler);
        });
      });

      return () => {
        split.revert();
        cleanups.forEach((fn) => fn());
      };
    },
    { scope: containerRef },
  );

  return (
    <section
      id="agents"
      ref={containerRef}
      aria-label="AI agents team"
      className="py-[var(--marketing-section-gap)] px-4 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-[var(--marketing-container-max-width)]">
        <div className="mb-12 flex flex-col items-center gap-3 text-center">
          <div className="agents-badge inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-4 py-1.5 text-sm font-medium text-foreground">
            <span
              aria-hidden="true"
              className="h-2 w-2 animate-pulse rounded-full"
              style={{ backgroundColor: 'var(--marketing-hero-from)' }}
            />
            {t('badge')}
          </div>
          <h2 className="agents-title text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl" style={{ fontFamily: 'var(--font-marketing-heading)' }}>
            {t('title')}
          </h2>
          <p className="agents-subtitle max-w-2xl text-base text-muted-foreground sm:text-lg">
            {t('subtitle')}
          </p>
        </div>

        {/* Bento grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:grid-rows-[auto_auto_auto]">
          {BENTO_ORDER.map((agentId) => {
            const i18nKey = AGENT_ID_TO_I18N_KEY[agentId];
            const isHighlighted = agentId === 'supervisor' || agentId === 'bc-agent';
            return (
              <div
                key={agentId}
                className={`agent-bento-item ${BENTO_POSITIONS[agentId]}`}
              >
                <AgentCard
                  icon={AGENT_ICON[agentId]}
                  name={t(`items.${i18nKey}.name`)}
                  role={t(`items.${i18nKey}.role`)}
                  description={t(`items.${i18nKey}.description`)}
                  color={AGENT_COLOR[agentId]}
                  highlighted={isHighlighted}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function hexToRgbStr(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}
