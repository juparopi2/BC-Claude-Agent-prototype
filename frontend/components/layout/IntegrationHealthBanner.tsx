'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuthHealth } from '@/src/domains/integrations';
import { useIntegrationListStore } from '@/src/domains/integrations';
import { PROVIDER_DISPLAY_NAME, PROVIDER_ID } from '@bc-agent/shared';
import { OneDriveLogo, SharePointLogo } from '@/components/icons';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function IntegrationHealthBanner({ className }: { className?: string }) {
  const { hasDegradedConnectivity, expiredConnections } = useAuthHealth();
  const openWizard = useIntegrationListStore((s) => s.openWizard);
  const refreshConnection = useIntegrationListStore((s) => s.refreshConnection);
  const fetchConnections = useIntegrationListStore((s) => s.fetchConnections);
  const [isRefreshing, setIsRefreshing] = useState(false);

  if (!hasDegradedConnectivity) return null;

  const names = expiredConnections.map(
    (c) => PROVIDER_DISPLAY_NAME[c.provider] ?? c.provider
  ).join(', ');

  const handleReconnect = async () => {
    const first = expiredConnections[0];
    if (!first) return;

    setIsRefreshing(true);
    try {
      const result = await refreshConnection(first.id);
      if (result === 'refreshed') {
        await fetchConnections();
      } else {
        openWizard(first.provider, first.id);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        className?.includes('relative') ? 'relative' : 'fixed top-0 left-0 right-0 z-[60]',
        'bg-amber-500/95 text-amber-950 px-4 py-2',
        'flex items-center justify-center gap-3',
        'shadow-lg backdrop-blur-sm animate-in slide-in-from-top duration-300',
      )}
    >
      {expiredConnections[0]?.provider === PROVIDER_ID.ONEDRIVE
        ? <OneDriveLogo className="h-4 w-4 shrink-0" />
        : expiredConnections[0]?.provider === PROVIDER_ID.SHAREPOINT
          ? <SharePointLogo className="h-4 w-4 shrink-0" />
          : <AlertTriangle className="h-4 w-4 shrink-0" />}
      <span className="text-sm font-medium">
        {names} session expired. Reconnect to continue syncing.
      </span>
      <Button
        variant="secondary"
        size="sm"
        className="ml-2 bg-white/20 hover:bg-white/30 text-amber-950 border-amber-700/30"
        disabled={isRefreshing}
        onClick={handleReconnect}
      >
        {isRefreshing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
        Reconnect
      </Button>
    </div>
  );
}
