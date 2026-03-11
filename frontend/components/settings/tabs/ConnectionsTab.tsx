'use client';

import { useState } from 'react';
import { Building2, Cloud, Globe, BarChart3, Loader2, Settings, Unplug, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useIntegrations } from '@/src/domains/integrations/hooks/useIntegrations';
import { DisconnectConfirmModal } from '@/components/connections/DisconnectConfirmModal';
import {
  PROVIDER_UI_ORDER,
  PROVIDER_DISPLAY_NAME,
  PROVIDER_ICON,
  PROVIDER_ACCENT_COLOR,
  CONNECTION_STATUS,
} from '@bc-agent/shared';
import type { ConnectionSummary, ProviderId } from '@bc-agent/shared';

const ICON_MAP: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  Building2,
  Cloud,
  Globe,
  BarChart3,
};

const PROVIDER_DESCRIPTION: Record<string, string> = {
  onedrive: 'Sync files from your OneDrive for Business',
  sharepoint: 'Sync document libraries from SharePoint',
  business_central: 'Connect to Business Central ERP data',
  power_bi: 'Access Power BI reports and dashboards',
};

// Providers that support file sync connections
const CONNECTABLE_PROVIDERS = new Set<string>(['onedrive']);

export function ConnectionsTab() {
  const { connections, isLoading, openWizard } = useIntegrations();
  const [disconnectTarget, setDisconnectTarget] = useState<ConnectionSummary | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const connectionsByProvider = new Map<string, ConnectionSummary>();
  for (const conn of connections) {
    if (conn.status === CONNECTION_STATUS.CONNECTED || conn.status === CONNECTION_STATUS.EXPIRED) {
      connectionsByProvider.set(conn.provider, conn);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Connections</h3>
        <p className="text-sm text-muted-foreground">
          Manage your external data source connections.
        </p>
      </div>

      <div className="space-y-3">
        {PROVIDER_UI_ORDER.map((providerId) => {
          const connection = connectionsByProvider.get(providerId);
          const iconName = PROVIDER_ICON[providerId];
          const IconComponent = ICON_MAP[iconName] ?? Cloud;
          const displayName = PROVIDER_DISPLAY_NAME[providerId];
          const isConnectable = CONNECTABLE_PROVIDERS.has(providerId);
          const isConnected = !!connection;

          return (
            <div
              key={providerId}
              className="flex items-center gap-4 rounded-lg border p-4"
            >
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${PROVIDER_ACCENT_COLOR[providerId]}15` }}
              >
                <IconComponent
                  className="h-5 w-5"
                  style={{ color: PROVIDER_ACCENT_COLOR[providerId] }}
                />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{displayName}</span>
                  {isConnected && (
                    <Badge variant="outline" className="text-xs text-green-600 border-green-200 bg-green-50 dark:text-green-400 dark:border-green-800 dark:bg-green-950">
                      Connected
                    </Badge>
                  )}
                  {!isConnectable && !isConnected && (
                    <Badge variant="secondary" className="text-xs">
                      Coming soon
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground truncate">
                  {isConnected
                    ? (connection.displayName ?? displayName)
                    : PROVIDER_DESCRIPTION[providerId] ?? ''}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {isConnected ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openWizard(providerId as ProviderId, connection.id)}
                    >
                      <Settings className="h-3.5 w-3.5 mr-1.5" />
                      Configure
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
                      onClick={() => setDisconnectTarget(connection)}
                    >
                      <Unplug className="h-3.5 w-3.5 mr-1.5" />
                      Disconnect
                    </Button>
                  </>
                ) : isConnectable ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openWizard(providerId as ProviderId)}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    Connect
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <DisconnectConfirmModal
        open={!!disconnectTarget}
        onOpenChange={(open) => {
          if (!open) setDisconnectTarget(null);
        }}
        connection={disconnectTarget}
        onDisconnected={() => {
          setDisconnectTarget(null);
        }}
      />
    </div>
  );
}
