'use client';

import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileExplorer } from './FileExplorer';
import { FileUpload } from './FileUpload';
import { cn } from '@/lib/utils';

interface SourcePanelProps {
  className?: string;
}

export function SourcePanel({ className }: SourcePanelProps) {
  // TODO: Replace with actual file management from store/API
  const [files, setFiles] = useState([
    {
      id: '1',
      name: 'customers.xlsx',
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: 524288, // 512KB
      lastModified: '2025-11-06T10:30:00Z',
      inContext: true,
    },
    {
      id: '2',
      name: 'sales-data.csv',
      type: 'text/csv',
      size: 102400, // 100KB
      lastModified: '2025-11-05T14:20:00Z',
      inContext: false,
    },
    {
      id: '3',
      name: 'config.json',
      type: 'application/json',
      size: 2048, // 2KB
      lastModified: '2025-11-04T09:15:00Z',
      inContext: false,
    },
  ]);

  // Handle file upload
  const handleUpload = async (uploadedFiles: File[]) => {
    console.log('[SourcePanel] Uploading files:', uploadedFiles);

    // TODO: Implement actual file upload to backend
    // Simulate upload success
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Add uploaded files to list (mock)
    const newFiles = uploadedFiles.map((file) => ({
      id: `file-${Date.now()}-${Math.random()}`,
      name: file.name,
      type: file.type,
      size: file.size,
      lastModified: new Date().toISOString(),
      inContext: false,
    }));

    setFiles((prev) => [...newFiles, ...prev]);
  };

  // Handle file selection
  const handleFileSelect = (fileId: string) => {
    console.log('[SourcePanel] File selected:', fileId);
    // TODO: Show file preview or details
  };

  // Handle add to context
  const handleAddToContext = (fileId: string) => {
    console.log('[SourcePanel] Add to context:', fileId);
    // TODO: Implement actual context management
    setFiles((prev) =>
      prev.map((file) =>
        file.id === fileId ? { ...file, inContext: true } : file
      )
    );
  };

  return (
    <div className={cn('h-full flex flex-col border-l bg-background', className)}>
      <Tabs defaultValue="files" className="flex-1 flex flex-col">
        {/* Tabs header */}
        <div className="border-b px-4 pt-4">
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="files">Files</TabsTrigger>
            <TabsTrigger value="entities">Entities</TabsTrigger>
          </TabsList>
        </div>

        {/* Files tab */}
        <TabsContent value="files" className="flex-1 flex flex-col mt-0 p-4 space-y-4">
          {/* File upload */}
          <FileUpload onUpload={handleUpload} />

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">Uploaded files</span>
            </div>
          </div>

          {/* File explorer */}
          <FileExplorer
            files={files}
            onFileSelect={handleFileSelect}
            onAddToContext={handleAddToContext}
            className="flex-1"
          />
        </TabsContent>

        {/* Entities tab */}
        <TabsContent value="entities" className="flex-1 flex flex-col mt-0 p-4">
          {/* Empty state for entities (to be implemented in future) */}
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-2">
              <p className="text-sm text-muted-foreground">Entity explorer</p>
              <p className="text-xs text-muted-foreground">Coming soon...</p>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
