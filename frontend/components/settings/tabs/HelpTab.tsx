'use client';

import { useOnboardingStore } from '@/src/domains/onboarding';
import { TOUR_ID } from '@bc-agent/shared';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface HelpTabProps {
  onClose?: () => void;
}

export function HelpTab({ onClose }: HelpTabProps) {
  const restartTour = useOnboardingStore((s) => s.restartTour);

  const handleReplayTour = () => {
    onClose?.();
    // Small delay so the settings modal closes before the tour starts
    setTimeout(() => {
      restartTour(TOUR_ID.WELCOME);
    }, 300);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Help</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Resources to help you get the most out of MyWorkMate.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Welcome Tour</p>
            <p className="text-xs text-muted-foreground">
              Replay the guided introduction to MyWorkMate&apos;s key features.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 shrink-0"
            onClick={handleReplayTour}
          >
            <RotateCcw className="size-3.5" />
            Replay Tour
          </Button>
        </div>
      </div>
    </div>
  );
}
