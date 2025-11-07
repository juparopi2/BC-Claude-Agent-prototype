'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { File, FileSpreadsheet, FileJson, Plus, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FileItem {
  id: string;
  name: string;
  type: string;
  size: number;
  lastModified: string;
  inContext?: boolean;
}

interface FileExplorerProps {
  files?: FileItem[];
  isLoading?: boolean;
  onFileSelect?: (fileId: string) => void;
  onAddToContext?: (fileId: string) => void;
  className?: string;
}

export function FileExplorer({
  files = [],
  isLoading = false,
  onFileSelect,
  onAddToContext,
  className,
}: FileExplorerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Get file icon
  const getFileIcon = (type: string) => {
    if (type.includes('spreadsheet') || type.includes('excel') || type.includes('csv')) {
      return FileSpreadsheet;
    }
    if (type.includes('json')) {
      return FileJson;
    }
    return File;
  };

  // Format file size
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  // Format last modified date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  // Handle file click
  const handleFileClick = (fileId: string) => {
    setSelectedId(fileId);
    onFileSelect?.(fileId);
  };

  // Handle add to context
  const handleAddToContext = (fileId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onAddToContext?.(fileId);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className={cn('space-y-2 p-2', className)}>
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  // Empty state
  if (files.length === 0) {
    return (
      <div className={cn('p-8 text-center', className)}>
        <File className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
        <p className="text-sm text-muted-foreground">No files uploaded</p>
        <p className="text-xs text-muted-foreground mt-1">
          Upload files to add them to your context
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className={cn('h-full', className)}>
      <div className="space-y-1 p-2">
        {files.map((file) => {
          const Icon = getFileIcon(file.type);
          const isSelected = selectedId === file.id;

          return (
            <button
              key={file.id}
              onClick={() => handleFileClick(file.id)}
              className={cn(
                'w-full text-left p-3 rounded-lg hover:bg-muted transition-colors group',
                isSelected && 'bg-muted border border-border'
              )}
            >
              <div className="flex items-start gap-3">
                {/* File icon */}
                <Icon className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />

                {/* File info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <span>{formatSize(file.size)}</span>
                    <span>•</span>
                    <span>{formatDate(file.lastModified)}</span>
                  </div>
                </div>

                {/* Add to context button */}
                <Button
                  variant={file.inContext ? 'secondary' : 'ghost'}
                  size="icon"
                  className={cn(
                    'h-8 w-8 flex-shrink-0',
                    !file.inContext && 'opacity-0 group-hover:opacity-100'
                  )}
                  onClick={(e) => handleAddToContext(file.id, e)}
                  disabled={file.inContext}
                  aria-label={file.inContext ? 'In context' : 'Add to context'}
                >
                  {file.inContext ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}
