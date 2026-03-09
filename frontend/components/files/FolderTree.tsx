'use client';

import { useEffect, useCallback, useState } from 'react';
import { Home, Star, Cloud, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useFolderNavigation, useFolderTreeStore } from '@/src/domains/files';
import { useSortFilterStore } from '@/src/domains/files/stores/sortFilterStore';
import { useIntegrationListStore, useSyncStatusStore, selectIsAnySyncing } from '@/src/domains/integrations';
import { getFileApiClient } from '@/src/infrastructure/api';
import { FolderTreeItem } from './FolderTreeItem';
import { CONNECTION_STATUS, FILE_SOURCE_TYPE, PROVIDER_ACCENT_COLOR, PROVIDER_DISPLAY_NAME, PROVIDER_ID } from '@bc-agent/shared';
import type { ParsedFile } from '@bc-agent/shared';

interface FolderTreeProps {
  className?: string;
}

export function FolderTree({ className }: FolderTreeProps) {
  const { currentFolderId, rootFolders, navigateToFolder, initFolderTree } = useFolderNavigation();
  const showFavoritesOnly = useSortFilterStore((s) => s.showFavoritesOnly);
  const sourceTypeFilter = useSortFilterStore((s) => s.sourceTypeFilter);
  const setSourceTypeFilter = useSortFilterStore((s) => s.setSourceTypeFilter);
  const isRootLoading = useFolderTreeStore((s) => s.loadingFolderIds.has('root'));
  const connections = useIntegrationListStore((s) => s.connections);
  const hasOneDrive = connections.some(
    (c) => c.provider === PROVIDER_ID.ONEDRIVE && c.status === CONNECTION_STATUS.CONNECTED
  );

  // PRD-107: OneDrive expandable tree state
  const [isOneDriveExpanded, setOneDriveExpanded] = useState(false);
  const [odRootFolders, setOdRootFolders] = useState<ParsedFile[]>([]);
  const [isLoadingOdFolders, setIsLoadingOdFolders] = useState(false);
  const isAnySyncing = useSyncStatusStore(selectIsAnySyncing);

  // Load OneDrive root folders when expanded
  useEffect(() => {
    if (!isOneDriveExpanded || !hasOneDrive) return;

    let cancelled = false;
    const loadOdFolders = async () => {
      setIsLoadingOdFolders(true);
      try {
        const fileApi = getFileApiClient();
        const result = await fileApi.getFiles({ folderId: null, sourceType: FILE_SOURCE_TYPE.ONEDRIVE });
        if (!cancelled && result.success) {
          setOdRootFolders(result.data.files.filter((f) => f.isFolder));
        }
      } catch (err) {
        console.error('Failed to load OneDrive folders:', err);
      } finally {
        if (!cancelled) setIsLoadingOdFolders(false);
      }
    };
    loadOdFolders();

    return () => { cancelled = true; };
  }, [isOneDriveExpanded, hasOneDrive]);

  // Load root folders on mount and when favorites mode changes
  useEffect(() => {
    initFolderTree();
  }, [initFolderTree, showFavoritesOnly]);

  const handleSelect = useCallback((folderId: string | null, folder?: ParsedFile) => {
    // Clear source type filter when navigating to a local folder
    if (sourceTypeFilter) {
      setSourceTypeFilter(null);
    }
    navigateToFolder(folderId, folder);
  }, [navigateToFolder, sourceTypeFilter, setSourceTypeFilter]);

  const handleAllFiles = useCallback(() => {
    setSourceTypeFilter(null);
    navigateToFolder(null);
  }, [setSourceTypeFilter, navigateToFolder]);

  const handleOneDriveClick = useCallback(() => {
    setSourceTypeFilter(FILE_SOURCE_TYPE.ONEDRIVE);
    navigateToFolder(null);
  }, [setSourceTypeFilter, navigateToFolder]);

  const handleOneDriveFolderSelect = useCallback((folderId: string, folder: ParsedFile) => {
    // When selecting a specific OneDrive subfolder, clear the source type filter
    // so we see the actual folder contents (not a flat view)
    setSourceTypeFilter(null);
    navigateToFolder(folderId, folder);
  }, [setSourceTypeFilter, navigateToFolder]);

  return (
    <ScrollArea className={cn('h-full', className)}>
      <div className="p-2">
        {/* Root item */}
        <button
          onClick={handleAllFiles}
          className={cn(
            'flex items-center gap-2 w-full py-1.5 px-2 rounded hover:bg-accent/50 transition-colors',
            currentFolderId === null && !sourceTypeFilter && 'bg-accent'
          )}
        >
          {showFavoritesOnly ? (
            <Star className="size-4 fill-amber-400 text-amber-400" />
          ) : (
            <Home className="size-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">
            {showFavoritesOnly ? 'Favorites' : 'All Files'}
          </span>
        </button>

        {/* Folder tree — skeleton while loading, items when ready */}
        <div className="mt-1">
          {isRootLoading ? (
            <FolderTreeSkeleton />
          ) : (
            rootFolders.map(folder => (
              <FolderTreeItem
                key={folder.id}
                folder={folder}
                level={0}
                onSelect={handleSelect}
              />
            ))
          )}
        </div>

        {/* OneDrive root (when connected) — PRD-107 */}
        {hasOneDrive && (
          <div className="mt-3 pt-3 border-t">
            <Collapsible open={isOneDriveExpanded} onOpenChange={setOneDriveExpanded}>
              <div className="flex items-center gap-1 w-full py-1.5 px-2 rounded hover:bg-accent/50 transition-colors">
                <CollapsibleTrigger asChild>
                  <button
                    className="p-0.5 hover:bg-accent rounded"
                    aria-label={isOneDriveExpanded ? 'Collapse OneDrive' : 'Expand OneDrive'}
                  >
                    {isOneDriveExpanded ? (
                      <ChevronDown className="size-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-4 text-muted-foreground" />
                    )}
                  </button>
                </CollapsibleTrigger>
                <button
                  onClick={handleOneDriveClick}
                  className={cn(
                    'flex items-center gap-2 flex-1',
                    sourceTypeFilter === FILE_SOURCE_TYPE.ONEDRIVE && !currentFolderId && 'font-semibold'
                  )}
                >
                  <Cloud className="size-4" style={{ color: PROVIDER_ACCENT_COLOR[PROVIDER_ID.ONEDRIVE] }} />
                  <span className="text-sm font-medium">{PROVIDER_DISPLAY_NAME[PROVIDER_ID.ONEDRIVE]}</span>
                </button>
                {isAnySyncing && <Loader2 className="size-3 text-muted-foreground animate-spin" />}
              </div>
              <CollapsibleContent>
                {isLoadingOdFolders ? (
                  <FolderTreeSkeleton />
                ) : (
                  odRootFolders.map(folder => (
                    <FolderTreeItem
                      key={folder.id}
                      folder={folder}
                      level={1}
                      onSelect={handleOneDriveFolderSelect}
                    />
                  ))
                )}
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

/** Skeleton that mirrors FolderTreeItem layout: chevron + folder icon + name */
function FolderTreeSkeleton() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-1.5 py-1.5 px-2">
          <Skeleton className="size-4 rounded" />
          <Skeleton className="size-4 rounded" />
          <Skeleton className="h-3.5 flex-1 rounded" />
        </div>
      ))}
    </div>
  );
}
