'use client';

import { useState, useEffect, useRef } from 'react';
import { Folder, Database, Link, Cloud } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { FileExplorer } from '@/components/files';

export default function RightPanel() {
  const [panelWidth, setPanelWidth] = useState<number>(Infinity);
  const panelRef = useRef<HTMLDivElement>(null);

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
      <Tabs defaultValue="files" className="flex-1 flex flex-col">
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
              {/* Business Central Connection */}
              <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                <div className="flex items-center gap-2">
                  <Cloud className="size-5 text-primary" />
                  <span className="text-sm font-medium">Business Central</span>
                </div>
                <Badge variant="outline">Configure</Badge>
              </div>

              {/* SharePoint Connection */}
              <div className="flex items-center justify-between p-3 rounded-lg border bg-card opacity-60">
                <div className="flex items-center gap-2">
                  <Cloud className="size-5 text-muted-foreground" />
                  <span className="text-sm font-medium text-muted-foreground">
                    SharePoint
                  </span>
                </div>
                <Badge variant="secondary">Coming soon</Badge>
              </div>

              {/* Dynamics 365 Connection */}
              <div className="flex items-center justify-between p-3 rounded-lg border bg-card opacity-60">
                <div className="flex items-center gap-2">
                  <Cloud className="size-5 text-muted-foreground" />
                  <span className="text-sm font-medium text-muted-foreground">
                    Dynamics 365
                  </span>
                </div>
                <Badge variant="secondary">Coming soon</Badge>
              </div>

              {/* Power BI Connection */}
              <div className="flex items-center justify-between p-3 rounded-lg border bg-card opacity-60">
                <div className="flex items-center gap-2">
                  <Cloud className="size-5 text-muted-foreground" />
                  <span className="text-sm font-medium text-muted-foreground">
                    Power BI
                  </span>
                </div>
                <Badge variant="secondary">Coming soon</Badge>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
