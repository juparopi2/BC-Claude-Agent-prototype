'use client';

import { useState, useEffect, useRef } from 'react';
import { Folder, Database, Link } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileExplorer } from '@/components/files';
import { PROVIDER_ID, PROVIDER_UI_ORDER, type ProviderId } from '@bc-agent/shared';
import { useIntegrations, ConnectionCard } from '@/src/domains/integrations';
import { ConnectionWizard } from '@/components/connections/ConnectionWizard';

// Providers that are not yet implemented (show as "Coming soon")
const DISABLED_PROVIDERS = new Set<ProviderId>([
  PROVIDER_ID.SHAREPOINT,
  PROVIDER_ID.POWER_BI,
]);

export default function RightPanel() {
  const [panelWidth, setPanelWidth] = useState<number>(Infinity);
  const panelRef = useRef<HTMLDivElement>(null);
  const { connections, openWizard, wizardOpen, closeWizard, wizardProviderId } = useIntegrations();

  useEffect(() => {
    if (!panelRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setPanelWidth(entry.contentRect.width);
      }
    });

    observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, []);

  const isNarrow = panelWidth < 280;

  return (
    <div ref={panelRef} className="h-full flex flex-col">
      <Tabs defaultValue="files" className="flex-1 min-h-0 flex flex-col">
        {/* Tabs Navigation */}
        <TabsList className="w-full">
          <TabsTrigger value="files" className="flex-1">
            <Folder />
            {!isNarrow && 'Files'}
          </TabsTrigger>
          <TabsTrigger value="entities" className="flex-1">
            <Database />
            {!isNarrow && 'Entities'}
          </TabsTrigger>
          <TabsTrigger value="connections" className="flex-1">
            <Link />
            {!isNarrow && 'Connections'}
          </TabsTrigger>
        </TabsList>

        {/* Files Tab */}
        <TabsContent value="files" className="flex-1 overflow-hidden">
          <FileExplorer isNarrow={isNarrow} className="h-full" />
        </TabsContent>

        {/* Entities Tab */}
        <TabsContent value="entities" className="flex-1">
          <ScrollArea className="h-full">
            <div className="flex flex-col items-center justify-center h-full p-6">
              <Database className="size-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground text-center">
                No saved entities
              </p>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Connections Tab */}
        <TabsContent value="connections" className="flex-1">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-3">
              {PROVIDER_UI_ORDER.map((providerId) => {
                const match = connections.find((c) => c.provider === providerId);
                return (
                  <ConnectionCard
                    key={providerId}
                    providerId={providerId}
                    connection={match ?? null}
                    disabled={DISABLED_PROVIDERS.has(providerId)}
                    onClick={!DISABLED_PROVIDERS.has(providerId) ? () => openWizard(providerId) : undefined}
                  />
                );
              })}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {wizardOpen && wizardProviderId === PROVIDER_ID.ONEDRIVE && (
        <ConnectionWizard isOpen={wizardOpen} onClose={closeWizard} />
      )}
    </div>
  );
}
