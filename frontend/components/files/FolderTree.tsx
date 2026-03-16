'use client';

import { useEffect, useCallback, useRef } from 'react';
import { Home, Star, ChevronDown, ChevronRight, Loader2, Settings2 } from 'lucide-react';
import { OneDriveLogo, SharePointLogo } from '@/components/icons';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { useFolderNavigation, useFolderTreeStore } from '@/src/domains/files';
import { useSortFilterStore } from '@/src/domains/files/stores/sortFilterStore';
import { useIntegrationListStore, useSyncStatusStore, selectIsAnySyncing } from '@/src/domains/integrations';
import { getFileApiClient } from '@/src/infrastructure/api';
import { FolderTreeItem } from './FolderTreeItem';
import { SiteTreeItem } from './SiteTreeItem';
import { CONNECTION_STATUS, FILE_SOURCE_TYPE, PROVIDER_DISPLAY_NAME, PROVIDER_ID, CONNECTIONS_API } from '@bc-agent/shared';
import type { ParsedFile, ConnectionScopeWithStats } from '@bc-agent/shared';
import type { SharePointSiteNode } from '@/src/domains/files/types/siteNode.types';
import { env } from '@/lib/config/env';

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
    (c) => c.status === CONNECTION_STATUS.CONNECTED || c.status === CONNECTION_STATUS.EXPIRED
  );

  // Section expanded state — store-backed for persistence across navigation
  const isLocalExpanded = useFolderTreeStore((s) => s.expandedSections.local);
  const isOneDriveExpanded = useFolderTreeStore((s) => s.expandedSections.onedrive);
  const odRootFoldersFromStore = useFolderTreeStore((s) => s.treeFolders['onedrive-root']);
  const odRootFolders = odRootFoldersFromStore ?? EMPTY_OD_FOLDERS;
  const isOdRootLoaded = odRootFoldersFromStore !== undefined;
  const isLoadingOdFolders = useFolderTreeStore((s) => s.loadingFolderIds.has('onedrive-root'));
  const isAnySyncing = useSyncStatusStore(selectIsAnySyncing);
  const openWizard = useIntegrationListStore((s) => s.openWizard);

  // PRD-113: SharePoint expandable tree state
  const spConnection = connections.find((c) => c.provider === PROVIDER_ID.SHAREPOINT);
  const hasSP = spConnection?.status === CONNECTION_STATUS.CONNECTED;
  const isSPExpired = spConnection?.status === CONNECTION_STATUS.EXPIRED;
  const showSPSection = hasSP || isSPExpired;
  const isSPExpanded = useFolderTreeStore((s) => s.expandedSections.sharepoint);
  const setSectionExpanded = useFolderTreeStore((s) => s.setSectionExpanded);
  const isLoadingSpSites = useFolderTreeStore((s) => s.loadingFolderIds.has('sharepoint-root'));
  const sharepointSites = useFolderTreeStore((s) => s.sharepointSites);
  const spSitesLoadedMarker = useFolderTreeStore((s) => s.treeFolders['sharepoint-sites-loaded']);
  const areSitesLoaded = sharepointSites.length > 0 || spSitesLoadedMarker !== undefined;
  const setSharepointSites = useFolderTreeStore((s) => s.setSharepointSites);
  const setActiveSiteContext = useFolderTreeStore((s) => s.setActiveSiteContext);
  const oneDriveScopeFileCounts = useFolderTreeStore((s) => s.oneDriveScopeFileCounts);
  const setOneDriveScopeFileCounts = useFolderTreeStore((s) => s.setOneDriveScopeFileCounts);

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
        const [foldersResult, scopesResponse] = await Promise.all([
          fileApi.getFiles({ folderId: null, sourceType: FILE_SOURCE_TYPE.ONEDRIVE }),
          oneDriveConnection
            ? fetch(`${env.apiUrl}${CONNECTIONS_API.BASE}/${oneDriveConnection.id}/scopes`, { credentials: 'include' })
            : Promise.resolve(null),
        ]);
        if (!cancelled && foldersResult.success) {
          setTreeFolders('onedrive-root', foldersResult.data.files.filter((f) => f.isFolder));
        }
        if (!cancelled && scopesResponse?.ok) {
          const data = await scopesResponse.json() as { scopes: ConnectionScopeWithStats[] };
          const scopes = data.scopes ?? [];
          const counts: Record<string, number> = {};
          for (const scope of scopes) {
            if (scope.scopeDisplayName) {
              counts[scope.scopeDisplayName] = scope.fileCount;
            }
          }
          setOneDriveScopeFileCounts(counts);
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
  }, [isOneDriveExpanded, hasOneDrive, isOdRootLoaded, oneDriveConnection, setLoadingFolder, setTreeFolders, setOneDriveScopeFileCounts]);

  // Load SharePoint scopes and group into sites when SP section expands
  const spLoadingRef = useRef(false);
  useEffect(() => {
    if (!isSPExpanded || !hasSP || !spConnection) return;
    if (areSitesLoaded) return;
    if (spLoadingRef.current) return;

    spLoadingRef.current = true;
    let cancelled = false;
    const loadSpSites = async () => {
      setLoadingFolder('sharepoint-root', true);
      try {
        const response = await fetch(
          `${env.apiUrl}${CONNECTIONS_API.BASE}/${spConnection.id}/scopes`,
          { credentials: 'include' }
        );
        if (!cancelled && response.ok) {
          const data = await response.json() as { scopes: ConnectionScopeWithStats[] };
          const scopes = data.scopes ?? [];

          // Group scopes by site, then by library (driveId).
          // scopePath format: "SiteName / LibraryName" (library) or "SiteName / LibraryName / FolderPath" (folder)
          // Library scopes get scopeId set; folder scopes get grouped into folderScopes[].
          const siteMap = new Map<string, SharePointSiteNode>();

          // Intermediate: track libraries per site by driveId
          type LibraryAccum = {
            displayName: string;
            driveId: string;
            fileCount: number;
            scopeId?: string;
            folderScopes: Array<{ scopeId: string; displayName: string; fileCount: number }>;
          };
          const libraryMap = new Map<string, LibraryAccum>(); // key: siteId + driveId

          for (const scope of scopes) {
            const siteId = scope.scopeSiteId;
            if (!siteId) continue;
            // Skip exclude scopes, root scopes, and site scopes
            if (scope.scopeMode === 'exclude') continue;
            if (scope.scopeType === 'root' || scope.scopeType === 'site' || scope.scopeType === 'exclude') continue;

            const scopePathParts = scope.scopePath?.split(' / ');
            const siteName = scopePathParts && scopePathParts.length > 0
              ? scopePathParts[0]
              : siteId;

            if (!siteMap.has(siteId)) {
              siteMap.set(siteId, {
                siteId,
                displayName: siteName,
                libraries: [],
                totalFileCount: 0,
              });
            }

            const driveId = scope.remoteDriveId ?? '';
            const libKey = `${siteId}::${driveId}`;

            if (!libraryMap.has(libKey)) {
              // Extract library name from scopePath (2nd segment) or fall back to display name
              const libraryName = scopePathParts && scopePathParts.length > 1
                ? scopePathParts[1]
                : scope.scopeDisplayName ?? 'Documents';
              libraryMap.set(libKey, {
                displayName: libraryName,
                driveId,
                fileCount: 0,
                folderScopes: [],
              });
            }
            const lib = libraryMap.get(libKey)!;

            if (scope.scopeType === 'library') {
              // Whole library synced — set scopeId (supersedes folder scopes)
              lib.scopeId = scope.id;
              lib.fileCount += scope.fileCount;
            } else if (scope.scopeType === 'folder') {
              // Folder within a library
              lib.folderScopes.push({
                scopeId: scope.id,
                displayName: scope.scopeDisplayName ?? 'Unknown Folder',
                fileCount: scope.fileCount,
              });
              lib.fileCount += scope.fileCount;
            }
          }

          // Assemble libraries into sites
          for (const [libKey, lib] of libraryMap) {
            const siteId = libKey.split('::')[0];
            const site = siteMap.get(siteId);
            if (!site) continue;

            // If library scope exists, it supersedes folder scopes
            if (lib.scopeId) {
              site.libraries.push({
                displayName: lib.displayName,
                driveId: lib.driveId,
                fileCount: lib.fileCount,
                scopeId: lib.scopeId,
              });
            } else if (lib.folderScopes.length > 0) {
              site.libraries.push({
                displayName: lib.displayName,
                driveId: lib.driveId,
                fileCount: lib.fileCount,
                folderScopes: lib.folderScopes,
              });
            }
            site.totalFileCount += lib.fileCount;
          }

          const sites = Array.from(siteMap.values());
          if (!cancelled) {
            setSharepointSites(sites);
            // Mark as loaded even if empty
            setTreeFolders('sharepoint-sites-loaded', []);
          }
        } else if (!cancelled) {
          setTreeFolders('sharepoint-sites-loaded', []);
        }
      } catch (err) {
        console.error('Failed to load SharePoint sites:', err);
        if (!cancelled) setTreeFolders('sharepoint-sites-loaded', []);
      } finally {
        setLoadingFolder('sharepoint-root', false);
        spLoadingRef.current = false;
      }
    };
    loadSpSites();

    return () => { cancelled = true; spLoadingRef.current = false; };
  }, [isSPExpanded, hasSP, spConnection, areSitesLoaded, setLoadingFolder, setTreeFolders, setSharepointSites]);

  // Load root folders on mount and when favorites mode changes
  useEffect(() => {
    initFolderTree();
  }, [initFolderTree, showFavoritesOnly]);

  const handleSelect = useCallback((folderId: string | null, folder?: ParsedFile) => {
    // Clear source type filter when navigating to a local folder
    if (sourceTypeFilter) {
      setSourceTypeFilter(null);
    }
    setActiveSiteContext(null);
    useFolderTreeStore.getState().setActiveLibraryContext?.(null);
    navigateToFolder(folderId, folder);
  }, [navigateToFolder, sourceTypeFilter, setSourceTypeFilter, setActiveSiteContext]);

  const handleAllFiles = useCallback(() => {
    setSourceTypeFilter(null);
    setActiveSiteContext(null);
    useFolderTreeStore.getState().setActiveLibraryContext?.(null);
    navigateToFolder(null);
  }, [setSourceTypeFilter, setActiveSiteContext, navigateToFolder]);

  const handleOneDriveClick = useCallback(() => {
    setSourceTypeFilter(FILE_SOURCE_TYPE.ONEDRIVE);
    setActiveSiteContext(null);
    useFolderTreeStore.getState().setActiveLibraryContext?.(null);
    navigateToFolder(null);
  }, [setSourceTypeFilter, setActiveSiteContext, navigateToFolder]);

  const handleOneDriveFolderSelect = useCallback((folderId: string, folder: ParsedFile) => {
    if (sourceTypeFilter !== FILE_SOURCE_TYPE.ONEDRIVE) {
      setSourceTypeFilter(FILE_SOURCE_TYPE.ONEDRIVE);
    }
    setActiveSiteContext(null);
    useFolderTreeStore.getState().setActiveLibraryContext?.(null);
    navigateToFolder(folderId, folder);
  }, [navigateToFolder, sourceTypeFilter, setSourceTypeFilter, setActiveSiteContext]);

  const handleSharePointClick = useCallback(() => {
    setSourceTypeFilter(FILE_SOURCE_TYPE.SHAREPOINT);
    setActiveSiteContext(null);
    // Also clear library context when going to SP root
    useFolderTreeStore.getState().setActiveLibraryContext?.(null);
    navigateToFolder(null);
    // Auto-expand SP section so sites load
    setSectionExpanded('sharepoint', true);
  }, [setSourceTypeFilter, setActiveSiteContext, navigateToFolder, setSectionExpanded]);

  const handleSiteSelect = useCallback((siteId: string, siteName: string) => {
    setSourceTypeFilter(FILE_SOURCE_TYPE.SHAREPOINT);
    setActiveSiteContext({ siteId, siteName });
    useFolderTreeStore.getState().setActiveLibraryContext?.(null);
    navigateToFolder(null);
  }, [setSourceTypeFilter, setActiveSiteContext, navigateToFolder]);

  // Called when any folder inside a SP site's library is clicked in the tree
  const handleSharePointFolderSelect = useCallback(
    (siteId: string, siteName: string, folderId: string, folder: ParsedFile) => {
      if (sourceTypeFilter !== FILE_SOURCE_TYPE.SHAREPOINT) {
        setSourceTypeFilter(FILE_SOURCE_TYPE.SHAREPOINT);
      }
      setActiveSiteContext({ siteId, siteName });
      navigateToFolder(folderId, folder);
    },
    [navigateToFolder, sourceTypeFilter, setSourceTypeFilter, setActiveSiteContext]
  );

  return (
    <ScrollArea className={cn('h-full', className)}>
      <div className="p-2">
        {/* Local Files — collapsible section */}
        <Collapsible
          open={hasExternalConnection ? isLocalExpanded : true}
          onOpenChange={hasExternalConnection ? (open: boolean) => setSectionExpanded('local', open) : undefined}
          className={cn(!sourceTypeFilter && 'border-l-2 border-l-primary')}
        >
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
                currentFolderId === null && !sourceTypeFilter && 'bg-accent rounded font-medium'
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
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className="mt-3 pt-3 border-t">
                <Collapsible
                  open={isOneDriveExpanded}
                  onOpenChange={(open: boolean) => setSectionExpanded('onedrive', open)}
                  className={cn(sourceTypeFilter === FILE_SOURCE_TYPE.ONEDRIVE && 'border-l-2 border-l-[#0078D4]')}
                >
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
                        sourceTypeFilter === FILE_SOURCE_TYPE.ONEDRIVE && !currentFolderId && 'bg-accent rounded font-medium'
                      )}
                    >
                      <OneDriveLogo className="size-4" />
                      <span className="text-sm font-medium">{PROVIDER_DISPLAY_NAME[PROVIDER_ID.ONEDRIVE]}</span>
                    </button>
                    {isAnySyncing && <Loader2 className="size-3 text-muted-foreground animate-spin" />}
                  </div>
                  <CollapsibleContent>
                    {isOneDriveExpired ? (
                      <div className="flex flex-col items-center justify-center py-6 gap-3 px-4">
                        <OneDriveLogo className="size-8 opacity-50" />
                        <p className="text-sm text-center text-muted-foreground">
                          Your OneDrive session has expired. Please sign in again to continue.
                        </p>
                        <Button
                          size="sm"
                          onClick={() => oneDriveConnection && openWizard(PROVIDER_ID.ONEDRIVE, oneDriveConnection.id)}
                          className="gap-1.5 bg-[#0078D4] hover:bg-[#106EBE] text-white"
                        >
                          <OneDriveLogo className="size-3.5" />
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
                          fileCount={oneDriveScopeFileCounts[folder.name]}
                        />
                      ))
                    )}
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                onClick={() => oneDriveConnection && openWizard(PROVIDER_ID.ONEDRIVE, oneDriveConnection.id)}
              >
                <Settings2 className="size-4 mr-2" />
                Configure
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )}

        {/* SharePoint root (when connected) — PRD-113 */}
        {showSPSection && (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className="mt-3 pt-3 border-t">
                <Collapsible
                  open={isSPExpanded}
                  onOpenChange={(open: boolean) => setSectionExpanded('sharepoint', open)}
                  className={cn(sourceTypeFilter === FILE_SOURCE_TYPE.SHAREPOINT && 'border-l-2 border-l-[#038387]')}
                >
                  <div className="flex items-center gap-1 w-full py-1.5 px-2 rounded hover:bg-accent/50 transition-colors">
                    <CollapsibleTrigger asChild>
                      <button
                        className="p-0.5 hover:bg-accent rounded cursor-pointer"
                        aria-label={isSPExpanded ? 'Collapse SharePoint' : 'Expand SharePoint'}
                      >
                        {isSPExpanded ? (
                          <ChevronDown className="size-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="size-4 text-muted-foreground" />
                        )}
                      </button>
                    </CollapsibleTrigger>
                    <button
                      onClick={handleSharePointClick}
                      className={cn(
                        'flex items-center gap-2 flex-1 cursor-pointer',
                        sourceTypeFilter === FILE_SOURCE_TYPE.SHAREPOINT && !currentFolderId && 'bg-accent rounded font-medium'
                      )}
                    >
                      <SharePointLogo className="size-4" />
                      <span className="text-sm font-medium">{PROVIDER_DISPLAY_NAME[PROVIDER_ID.SHAREPOINT]}</span>
                    </button>
                    {isAnySyncing && <Loader2 className="size-3 text-muted-foreground animate-spin" />}
                  </div>
                  <CollapsibleContent>
                    {isSPExpired ? (
                      <div className="flex flex-col items-center justify-center py-6 gap-3 px-4">
                        <SharePointLogo className="size-8 opacity-50" />
                        <p className="text-sm text-center text-muted-foreground">
                          Your SharePoint session has expired. Please sign in again to continue.
                        </p>
                        <Button
                          size="sm"
                          onClick={() => spConnection && openWizard(PROVIDER_ID.SHAREPOINT, spConnection.id)}
                          className="gap-1.5 bg-[#038387] hover:bg-[#026c6f] text-white"
                        >
                          <SharePointLogo className="size-3.5" />
                          Reconnect
                        </Button>
                      </div>
                    ) : isLoadingSpSites ? (
                      <FolderTreeSkeleton />
                    ) : (
                      sharepointSites.map((site) => (
                        <SiteTreeItem
                          key={site.siteId}
                          site={site}
                          level={1}
                          onSiteSelect={handleSiteSelect}
                          onFolderSelect={handleSharePointFolderSelect}
                        />
                      ))
                    )}
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                onClick={() => spConnection && openWizard(PROVIDER_ID.SHAREPOINT, spConnection.id)}
              >
                <Settings2 className="size-4 mr-2" />
                Configure
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
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
