'use client';

import { useEffect, useCallback } from 'react';
import { Home } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useFolderNavigation } from '@/src/domains/files';
import { FolderTreeItem } from './FolderTreeItem';

interface FolderTreeProps {
  className?: string;
}

export function FolderTree({ className }: FolderTreeProps) {
  const { currentFolderId, rootFolders, navigateToFolder, initFolderTree } = useFolderNavigation();

  // Load root folders on mount
  useEffect(() => {
    initFolderTree();
  }, [initFolderTree]);

  const handleSelect = useCallback((folderId: string | null) => {
    navigateToFolder(folderId);
  }, [navigateToFolder]);

  // We rely on the store's treeFolders['root'] to know if we have data
  const hasData = rootFolders.length > 0;

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

        {/* Folder tree */}
        <div className="mt-1">
          {rootFolders.map(folder => (
            <FolderTreeItem
              key={folder.id}
              folder={folder}
              level={0}
              onSelect={handleSelect}
            />
          ))}
        </div>

        {/* Empty state (implied by no children if loaded) */}
        {!hasData && (
           /* Only show empty if we've ostensibly loaded? 
              Actually store doesn't track specific 'loading' for tree init separate from global isLoading.
              For now just show nothing if empty to avoid flash. 
           */
          <div className="py-4 text-center text-sm text-muted-foreground opacity-50">
            {/* Optional: Add loading indicator here if needed, or rely on skeletons */}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
