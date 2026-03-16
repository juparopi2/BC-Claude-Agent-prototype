'use client';

import { useCallback, memo, useEffect } from 'react';
import { BookOpen, ChevronRight, ChevronDown, Loader2 } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { useFolderTreeStore } from '@/src/domains/files/stores/folderTreeStore';
import { getFileApiClient } from '@/src/infrastructure/api';
import { FILE_SOURCE_TYPE } from '@bc-agent/shared';
import type { ParsedFile } from '@bc-agent/shared';
import type { SharePointLibraryNode } from '@/src/domains/files/types/siteNode.types';
import { FolderTreeItem } from './FolderTreeItem';

// Empty array constant to avoid creating new references
const EMPTY_FOLDERS: ParsedFile[] = [];

interface LibraryTreeItemProps {
  library: SharePointLibraryNode;
  siteId: string;
  level: number;
  onSelect: () => void;
  /** Propagated to child FolderTreeItems so SP folder clicks update source context */
  onFolderSelect?: (folderId: string, folder: ParsedFile) => void;
}

export const LibraryTreeItem = memo(function LibraryTreeItem({
  library,
  siteId,
  level,
  onSelect,
  onFolderSelect,
}: LibraryTreeItemProps) {
  // Cache key: use scopeId for library scopes, driveId for folder-scope groups
  const cacheKey = library.scopeId
    ? `sp-lib-${library.scopeId}`
    : `sp-lib-drive-${library.driveId}`;

  const foldersFromStore = useFolderTreeStore((state) => state.treeFolders[cacheKey]);
  const folders = foldersFromStore ?? EMPTY_FOLDERS;
  const isLoaded = foldersFromStore !== undefined;

  const isExpanded = useFolderTreeStore((state) => state.expandedFolderIds.includes(cacheKey));
  const isLoading = useFolderTreeStore((state) => state.loadingFolderIds.has(cacheKey));

  const toggleFolderExpanded = useFolderTreeStore((state) => state.toggleFolderExpanded);
  const setTreeFolders = useFolderTreeStore((state) => state.setTreeFolders);
  const setLoadingFolder = useFolderTreeStore((state) => state.setLoadingFolder);

  // Lazy-load root folders for this library when expanded
  useEffect(() => {
    const loadFolders = async () => {
      if (!isExpanded) return;
      if (isLoaded) return;
      if (isLoading) return;

      setLoadingFolder(cacheKey, true);
      try {
        const fileApi = getFileApiClient();

        if (library.scopeId) {
          // Mode A: Whole library synced — single API call
          const result = await fileApi.getFiles({
            folderId: null,
            sourceType: FILE_SOURCE_TYPE.SHAREPOINT,
            siteId,
            connectionScopeId: library.scopeId,
          });
          if (result.success) {
            setTreeFolders(cacheKey, result.data.files.filter((f) => f.isFolder));
          }
        } else if (library.folderScopes && library.folderScopes.length > 0) {
          // Mode B: Folder scopes — load root folders for each scope in parallel
          const results = await Promise.all(
            library.folderScopes.map((fs) =>
              fileApi.getFiles({
                folderId: null,
                sourceType: FILE_SOURCE_TYPE.SHAREPOINT,
                siteId,
                connectionScopeId: fs.scopeId,
              })
            )
          );
          const allFolders: ParsedFile[] = [];
          for (const result of results) {
            if (result.success) {
              allFolders.push(...result.data.files.filter((f) => f.isFolder));
            }
          }
          setTreeFolders(cacheKey, allFolders);
        }
      } catch (err) {
        console.error(`[LibraryTreeItem] Failed to load folders for library ${cacheKey}:`, err);
        setTreeFolders(cacheKey, []);
      } finally {
        setLoadingFolder(cacheKey, false);
      }
    };

    loadFolders();
  }, [isExpanded, isLoaded, isLoading, cacheKey, library.scopeId, library.folderScopes, siteId, setLoadingFolder, setTreeFolders]);

  const handleSelect = useCallback(() => {
    onSelect();
  }, [onSelect]);

  const handleToggleExpand = useCallback(() => {
    toggleFolderExpanded(cacheKey);
  }, [cacheKey, toggleFolderExpanded]);

  return (
    <Collapsible open={isExpanded} onOpenChange={handleToggleExpand}>
      <div
        className="flex items-center gap-1 py-1 px-2 rounded cursor-pointer hover:bg-accent/50 transition-colors"
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleSelect}
      >
        {/* Expand/collapse trigger */}
        <CollapsibleTrigger asChild>
          <button
            onClick={(e) => e.stopPropagation()}
            className="p-0.5 hover:bg-accent rounded cursor-pointer"
            aria-label={isExpanded ? 'Collapse library' : 'Expand library'}
          >
            {isLoading ? (
              <Loader2 className="size-4 text-muted-foreground animate-spin" />
            ) : isExpanded ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}
          </button>
        </CollapsibleTrigger>

        {/* Library icon and name */}
        <div className="flex items-center gap-2 flex-1 truncate">
          <BookOpen className="size-4 flex-shrink-0 text-[#038387]" />
          <span className="text-sm truncate flex-1">{library.displayName}</span>
          {library.fileCount > 0 && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 flex-shrink-0">
              {library.fileCount}
            </Badge>
          )}
        </div>
      </div>

      <CollapsibleContent>
        {folders.map((folder) => (
          <FolderTreeItem
            key={folder.id}
            folder={folder}
            level={level + 1}
            onSelect={onFolderSelect}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
});
