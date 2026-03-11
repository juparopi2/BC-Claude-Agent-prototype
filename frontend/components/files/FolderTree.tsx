'use client';

import { useEffect, useCallback, useState, useRef } from 'react';
import { Home, Star, Cloud, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { useFolderNavigation, useFolderTreeStore } from '@/src/domains/files';
import { useSortFilterStore } from '@/src/domains/files/stores/sortFilterStore';
import { useIntegrationListStore, useSyncStatusStore, selectIsAnySyncing } from '@/src/domains/integrations';
import { getFileApiClient } from '@/src/infrastructure/api';
import { FolderTreeItem } from './FolderTreeItem';
import { CONNECTION_STATUS, FILE_SOURCE_TYPE, PROVIDER_ACCENT_COLOR, PROVIDER_DISPLAY_NAME, PROVIDER_ID } from '@bc-agent/shared';
import type { ParsedFile } from '@bc-agent/shared';

const EMPTY_OD_FOLDERS: ParsedFile[] = [];

interface FolderTreeProps {
  className?: string;
}

export function FolderTree({ className }: FolderTreeProps) {
  const { currentFolderId, rootFolders, navigateToFolder, initFolderTree, setTreeFolders, setLoadingFolder } = useFolderNavigation();
  const showFavoritesOnly = useSortFilterStore((s) => s.showFavoritesOnly);
  const sourceTypeFilter = useSortFilterStore((s) => s.sourceTypeFilter);
  const setSourceTypeFilter = useSortFilterStore((s) => s.setSourceTypeFilter);
  const isRootLoading = useFolderTreeStore((s) => s.loadingFolderIds.has('root'));
  const connections = useIntegrationListStore((s) => s.connections);
  const oneDriveConnection = connections.find((c) => c.provider === PROVIDER_ID.ONEDRIVE);
  const hasOneDrive = oneDriveConnection?.status === CONNECTION_STATUS.CONNECTED;
  const isOneDriveExpired = oneDriveConnection?.status === CONNECTION_STATUS.EXPIRED;
  const showOneDriveSection = hasOneDrive || isOneDriveExpired;
  const hasExternalConnection = connections.some(
    (c) => c.status === CONNECTION_STATUS.CONNECTED
  );

  // Local Files collapsible state (expanded by default)
  const [isLocalExpanded, setLocalExpanded] = useState(true);
  // PRD-107: OneDrive expandable tree state
  const [isOneDriveExpanded, setOneDriveExpanded] = useState(false);
  const odRootFoldersFromStore = useFolderTreeStore((s) => s.treeFolders['onedrive-root']);
  const odRootFolders = odRootFoldersFromStore ?? EMPTY_OD_FOLDERS;
  const isOdRootLoaded = odRootFoldersFromStore !== undefined;
  const isLoadingOdFolders = useFolderTreeStore((s) => s.loadingFolderIds.has('onedrive-root'));
  const isAnySyncing = useSyncStatusStore(selectIsAnySyncing);
  const openWizard = useIntegrationListStore((s) => s.openWizard);

  // Load OneDrive root folders when expanded (store-backed, mirrors local files pattern)
  // Use a ref for the loading guard to avoid including isLoadingOdFolders in deps,
  // which would cause a re-render → cleanup → cancelled=true race condition.
  const odLoadingRef = useRef(false);
  useEffect(() => {
    if (!isOneDriveExpanded || !hasOneDrive) return;
    if (isOdRootLoaded) return;
    if (odLoadingRef.current) return;

    odLoadingRef.current = true;
    let cancelled = false;
    const loadOdFolders = async () => {
      setLoadingFolder('onedrive-root', true);
      try {
        const fileApi = getFileApiClient();
        const result = await fileApi.getFiles({ folderId: null, sourceType: FILE_SOURCE_TYPE.ONEDRIVE });
        if (!cancelled && result.success) {
          setTreeFolders('onedrive-root', result.data.files.filter((f) => f.isFolder));
        }
      } catch (err) {
        console.error('Failed to load OneDrive folders:', err);
        if (!cancelled) setTreeFolders('onedrive-root', []);
      } finally {
        setLoadingFolder('onedrive-root', false);
        odLoadingRef.current = false;
      }
    };
    loadOdFolders();

    return () => { cancelled = true; odLoadingRef.current = false; };
  }, [isOneDriveExpanded, hasOneDrive, isOdRootLoaded, setLoadingFolder, setTreeFolders]);

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
    navigateToFolder(folderId, folder);
  }, [navigateToFolder]);

  return (
    <ScrollArea className={cn('h-full', className)}>
      <div className="p-2">
        {/* Local Files — collapsible section */}
        <Collapsible open={hasExternalConnection ? isLocalExpanded : true} onOpenChange={hasExternalConnection ? setLocalExpanded : undefined}>
          <div className={cn(
            'flex items-center w-full py-1.5 px-2 rounded hover:bg-accent/50 transition-colors',
            hasExternalConnection ? 'gap-1' : 'gap-2'
          )}>
            {hasExternalConnection && (
              <CollapsibleTrigger asChild>
                <button
                  className="p-0.5 hover:bg-accent rounded cursor-pointer"
                  aria-label={isLocalExpanded ? 'Collapse Local Files' : 'Expand Local Files'}
                >
                  {isLocalExpanded ? (
                    <ChevronDown className="size-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-4 text-muted-foreground" />
                  )}
                </button>
              </CollapsibleTrigger>
            )}
            <button
              onClick={handleAllFiles}
              className={cn(
                'flex items-center gap-2 flex-1 cursor-pointer',
                currentFolderId === null && !sourceTypeFilter && (hasExternalConnection ? 'font-semibold' : 'bg-accent rounded')
              )}
            >
              {showFavoritesOnly ? (
                <Star className="size-4 fill-amber-400 text-amber-400" />
              ) : (
                <Home className="size-4 text-muted-foreground" />
              )}
              <span className="text-sm font-medium">
                {showFavoritesOnly ? 'Favorites' : (hasExternalConnection ? 'Local Files' : 'All Files')}
              </span>
            </button>
          </div>
          <CollapsibleContent>
            {isRootLoading ? (
              <FolderTreeSkeleton />
            ) : (
              rootFolders.map(folder => (
                <FolderTreeItem
                  key={folder.id}
                  folder={folder}
                  level={hasExternalConnection ? 1 : 0}
                  onSelect={handleSelect}
                />
              ))
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* OneDrive root (when connected) — PRD-107 */}
        {showOneDriveSection && (
          <div className="mt-3 pt-3 border-t">
            <Collapsible open={isOneDriveExpanded} onOpenChange={setOneDriveExpanded}>
              <div className="flex items-center gap-1 w-full py-1.5 px-2 rounded hover:bg-accent/50 transition-colors">
                <CollapsibleTrigger asChild>
                  <button
                    className="p-0.5 hover:bg-accent rounded cursor-pointer"
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
                    'flex items-center gap-2 flex-1 cursor-pointer',
                    sourceTypeFilter === FILE_SOURCE_TYPE.ONEDRIVE && !currentFolderId && 'font-semibold'
                  )}
                >
                  <Cloud className="size-4" style={{ color: PROVIDER_ACCENT_COLOR[PROVIDER_ID.ONEDRIVE] }} />
                  <span className="text-sm font-medium">{PROVIDER_DISPLAY_NAME[PROVIDER_ID.ONEDRIVE]}</span>
                </button>
                {isAnySyncing && <Loader2 className="size-3 text-muted-foreground animate-spin" />}
              </div>
              <CollapsibleContent>
                {isOneDriveExpired ? (
                  <div className="flex flex-col items-center justify-center py-6 gap-3 px-4">
                    <Cloud className="size-8 text-muted-foreground" />
                    <p className="text-sm text-center text-muted-foreground">
                      Your OneDrive session has expired. Please sign in again to continue.
                    </p>
                    <Button
                      size="sm"
                      onClick={() => oneDriveConnection && openWizard(PROVIDER_ID.ONEDRIVE, oneDriveConnection.id)}
                      className="gap-1.5 bg-[#0078D4] hover:bg-[#106EBE] text-white"
                    >
                      <Cloud className="size-3.5" />
                      Reconnect
                    </Button>
                  </div>
                ) : isLoadingOdFolders ? (
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
