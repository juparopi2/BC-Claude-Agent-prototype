'use client';

/**
 * TourTooltip Component
 *
 * Custom Joyride v3 tooltip rendered for each tour step.
 * Reads translation keys from step.data.i18nKey and supports
 * an optional agent-cards showcase panel for the agent-selector step.
 *
 * @module domains/onboarding/components/TourTooltip
 */

import type { TooltipRenderProps } from 'react-joyride';
import { useTranslations } from 'next-intl';
import { AGENT_UI_ORDER, AGENT_DISPLAY_NAME, AGENT_ICON, AGENT_COLOR, AGENT_DESCRIPTION } from '@bc-agent/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function TourTooltip({
  backProps,
  primaryProps,
  skipProps,
  index,
  size,
  isLastStep,
  step,
  continuous,
  tooltipProps,
}: TooltipRenderProps) {
  const t = useTranslations('onboarding');

  const stepData = step.data as Record<string, unknown> | undefined;
  const i18nKey = (stepData?.i18nKey as string) ?? '';
  const showAgentCards = stepData?.showAgentCards === true;

  // Derive title and content from the i18nKey path
  // e.g. i18nKey = 'tour.welcome' → t('tour.welcome.title') / t('tour.welcome.content')
  const title = t(`${i18nKey}.title` as Parameters<typeof t>[0]);
  const body = t(`${i18nKey}.content` as Parameters<typeof t>[0]);

  const isFirstStep = index === 0;

  return (
    <div
      {...tooltipProps}
      className={cn(
        'z-[9999]',
        showAgentCards ? 'max-w-md' : 'max-w-sm'
      )}
    >
      <Card className="rounded-xl shadow-lg border bg-background text-foreground py-0 gap-0">
        <CardContent className="p-5 space-y-4">
          {/* Step indicator + skip */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">
              {t('common.stepOf', { current: index + 1, total: size })}
            </span>
            {!isLastStep && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                {...skipProps}
              >
                {t('common.skip')}
              </Button>
            )}
          </div>

          {/* Title */}
          {title && (
            <h3 className="text-sm font-semibold leading-snug">{title}</h3>
          )}

          {/* Body */}
          {body && (
            <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
          )}

          {/* Agent cards showcase */}
          {showAgentCards && (
            <div className="grid grid-cols-1 gap-2 mt-1">
              {AGENT_UI_ORDER.map((agentId) => (
                <div
                  key={agentId}
                  className="flex items-start gap-2.5 rounded-lg border p-2.5"
                  style={{ borderLeftColor: AGENT_COLOR[agentId], borderLeftWidth: 3 }}
                >
                  <span className="text-lg leading-none mt-0.5">{AGENT_ICON[agentId]}</span>
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-xs font-semibold leading-none mb-0.5"
                      style={{ color: AGENT_COLOR[agentId] }}
                    >
                      {AGENT_DISPLAY_NAME[agentId]}
                    </p>
                    <p className="text-xs text-muted-foreground leading-snug line-clamp-2">
                      {AGENT_DESCRIPTION[agentId]}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-between pt-1">
            {/* Back button — hidden on first step */}
            {!isFirstStep ? (
              <Button variant="ghost" size="sm" className="h-8 px-3 text-xs" {...backProps}>
                {t('common.back')}
              </Button>
            ) : (
              <div />
            )}

            {/* Next / Finish button */}
            {continuous && (
              <Button size="sm" className="h-8 px-4 text-xs" {...primaryProps}>
                {isLastStep ? t('common.finish') : t('common.next')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
