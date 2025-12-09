'use client';

import { useEffect, useCallback, useState } from 'react';
import type { ParsedFile } from '@bc-agent/shared';
import { Home } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useFileStore } from '@/lib/stores/fileStore';
import { FolderTreeItem } from './FolderTreeItem';
import { getFileApiClient } from '@/lib/services/fileApi';

interface FolderTreeProps {
  className?: string;
}

export function FolderTree({ className }: FolderTreeProps) {
  const currentFolderId = useFileStore(state => state.currentFolderId);
  const { navigateToFolder } = useFileStore();

  // Local state for folder tree structure
  const [rootFolders, setRootFolders] = useState<ParsedFile[]>([]);
  const [folderChildren, setFolderChildren] = useState<Map<string, ParsedFile[]>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  // Load root folders on mount
  useEffect(() => {
    async function loadRootFolders() {
      setIsLoading(true);
      const api = getFileApiClient();
      const result = await api.getFiles({ folderId: null });
      if (result.success) {
        setRootFolders(result.data.files.filter(f => f.isFolder));
      }
      setIsLoading(false);
    }
    loadRootFolders();
  }, []);

  // Load children for a folder
  const loadFolderChildren = useCallback(async (folderId: string) => {
    const api = getFileApiClient();
    const result = await api.getFiles({ folderId });
    if (result.success) {
      const folders = result.data.files.filter(f => f.isFolder);
      setFolderChildren(prev => new Map(prev).set(folderId, folders));
    }
  }, []);

  const handleSelect = useCallback((folderId: string | null) => {
    navigateToFolder(folderId);
  }, [navigateToFolder]);

  return (
    <ScrollArea className={cn('h-full', className)}>
      <div className="p-2">
        {/* Root item */}
        <button
          onClick={() => handleSelect(null)}
          className={cn(
            'flex items-center gap-2 w-full py-1.5 px-2 rounded hover:bg-accent/50 transition-colors',
            currentFolderId === null && 'bg-accent'
          )}
        >
          <Home className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">All Files</span>
        </button>

        {/* Loading state */}
        {isLoading && (
          <div className="py-4 text-center text-sm text-muted-foreground">
            Loading...
          </div>
        )}

        {/* Folder tree */}
        {!isLoading && rootFolders.map(folder => (
          <FolderTreeItem
            key={folder.id}
            folder={folder}
            level={0}
            isSelected={currentFolderId === folder.id}
            subfolders={folderChildren.get(folder.id) || []}
            onSelect={handleSelect}
            onLoadChildren={loadFolderChildren}
          />
        ))}

        {/* Empty state */}
        {!isLoading && rootFolders.length === 0 && (
          <div className="py-4 text-center text-sm text-muted-foreground">
            No folders
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
