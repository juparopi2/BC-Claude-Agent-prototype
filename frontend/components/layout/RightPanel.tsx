'use client';

import { Folder, Database, Link, Upload, Cloud } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

export default function RightPanel() {
  return (
    <div className="h-full flex flex-col">
      <Tabs defaultValue="files" className="flex-1 flex flex-col">
        {/* Tabs Navigation */}
        <TabsList className="w-full">
          <TabsTrigger value="files" className="flex-1">
            <Folder />
            Files
          </TabsTrigger>
          <TabsTrigger value="entities" className="flex-1">
            <Database />
            Entities
          </TabsTrigger>
          <TabsTrigger value="connections" className="flex-1">
            <Link />
            Connections
          </TabsTrigger>
        </TabsList>

        {/* Files Tab */}
        <TabsContent value="files" className="flex-1">
          <ScrollArea className="h-full">
            <div className="flex flex-col items-center justify-center h-full p-6">
              <Upload className="size-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground text-center">
                No files yet
              </p>
            </div>
          </ScrollArea>
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
