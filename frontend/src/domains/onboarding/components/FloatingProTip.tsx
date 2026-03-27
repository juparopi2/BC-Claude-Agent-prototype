'use client';

/**
 * FloatingProTip Component
 *
 * A single, portal-rendered popover that floats near the target element for
 * the currently active ProTip. Uses Floating UI for positioning.
 * Mounts once in OnboardingProvider — no wrapper divs in the target components.
 *
 * @module domains/onboarding/components/FloatingProTip
 */

import { useCallback, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  useFloating,
  arrow,
  offset,
  flip,
  shift,
  autoUpdate,
  type Placement,
} from '@floating-ui/react-dom';
import { useTranslations } from 'next-intl';
import { Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOnboardingStore } from '../stores/onboardingStore';
import { TIP_DEFINITIONS } from '../constants/tipDefinitions';

/**
 * Check whether a DOM element exists for the given selector.
 * Uses useSyncExternalStore to avoid setState-in-effect lint violations.
 */
function useElementExists(selector: string | null): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (!selector) return () => {};
      // Re-check when DOM mutates (elements added/removed)
      const observer = new MutationObserver(onStoreChange);
      observer.observe(document.body, { childList: true, subtree: true });
      return () => observer.disconnect();
    },
    () => (selector ? document.querySelector(selector) !== null : false),
    () => false, // SSR snapshot
  );
}

export function FloatingProTip() {
  const activeTipId = useOnboardingStore((s) => s.activeTipId);
  const dismissTip = useOnboardingStore((s) => s.dismissTip);
  const dismissTipPermanently = useOnboardingStore((s) => s.dismissTipPermanently);
  const t = useTranslations('onboarding');

  const tipDef = activeTipId ? TIP_DEFINITIONS[activeTipId] : null;
  const targetSelector = tipDef?.targetSelector ?? null;
  const targetExists = useElementExists(targetSelector);

  // State-based ref for the arrow element — allows passing to arrow() middleware
  // without triggering lint warnings about useRef in render.
  const [arrowEl, setArrowEl] = useState<HTMLDivElement | null>(null);

  const { refs, floatingStyles, placement: actualPlacement, middlewareData } = useFloating({
    placement: (tipDef?.placement ?? 'top') as Placement,
    middleware: [
      offset(12),
      flip(),
      shift({ padding: 8 }),
      ...(arrowEl ? [arrow({ element: arrowEl })] : []),
    ],
    whileElementsMounted: autoUpdate,
  });

  // Callback ref for the floating element — avoids accessing refs.setFloating during render
  const floatingRef = useCallback(
    (node: HTMLDivElement | null) => {
      refs.setFloating(node);
    },
    [refs],
  );

  // Set reference element when target exists
  const setReferenceFromDom = useCallback(() => {
    if (!targetSelector) return;
    const el = document.querySelector(targetSelector);
    if (el) refs.setReference(el);
  }, [targetSelector, refs]);

  // Update reference whenever targetSelector or existence changes
  if (targetExists && targetSelector) {
    setReferenceFromDom();
  }

  if (!activeTipId || !tipDef || !targetExists) {
    return null;
  }

  const handleGotIt = () => {
    dismissTip(activeTipId);
  };

  const handleDontShowAgain = () => {
    dismissTipPermanently(activeTipId);
  };

  const titleKey = `${tipDef.i18nKey}.title` as Parameters<typeof t>[0];
  const contentKey = `${tipDef.i18nKey}.content` as Parameters<typeof t>[0];

  // Determine which edge of the popover sits closest to the target so the
  // arrow can be placed on the opposite edge (pointing toward the target).
  const baseSide = actualPlacement.split('-')[0] as 'top' | 'right' | 'bottom' | 'left';
  const staticSide = ({ top: 'bottom', right: 'left', bottom: 'top', left: 'right' } as const)[baseSide];

  // Arrow position from middleware
  const arrowX = middlewareData.arrow?.x;
  const arrowY = middlewareData.arrow?.y;

  // Shared position style for both arrow layers
  const arrowPos: React.CSSProperties = {
    [staticSide]: '-5px',
    ...(arrowX != null ? { left: `${arrowX}px` } : {}),
    ...(arrowY != null ? { top: `${arrowY}px` } : {}),
  };

  return createPortal(
    <div
      ref={floatingRef}
      style={floatingStyles}
      className="z-[9999] animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      {/* Arrow: two overlapping rotated squares.
          Outer = border color, inner = background fill.
          The inner square is 1px inward, covering the border line that would
          otherwise be visible inside the card. */}
      <div
        ref={setArrowEl}
        className="absolute size-2.5 rotate-45 border border-border"
        style={arrowPos}
      />
      <div
        className="absolute size-2.5 rotate-45 bg-background"
        style={{ ...arrowPos, [staticSide]: '-4px' }}
      />
      <div className="w-80 bg-background border rounded-xl shadow-lg p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Lightbulb className="size-4 shrink-0 text-amber-500 mt-0.5" />
          <div className="space-y-1.5 flex-1">
            <p className="text-sm font-semibold leading-tight text-blue-600 dark:text-blue-400">
              {t(titleKey)}
            </p>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              {t(contentKey)}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={handleDontShowAgain}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
          >
            Don&apos;t show again
          </button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={handleGotIt}
          >
            {t('common.dismiss')}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
