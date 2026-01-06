import { useCallback, memo, useEffect } from 'react';
import type { ParsedFile } from '@bc-agent/shared';
import { Folder, ChevronRight, ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useShallow } from 'zustand/react/shallow';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useFolderNavigation, useFolderTreeStore } from '@/src/domains/files';
import { getFileApiClient } from '@/src/infrastructure/api';
import { FileContextMenu } from './FileContextMenu';

// Empty array constant to avoid creating new references
const EMPTY_FOLDERS: ParsedFile[] = [];

interface FolderTreeItemProps {
  folder: ParsedFile;
  level: number;
  onSelect?: (folderId: string, folder: ParsedFile) => void;
}

export const FolderTreeItem = memo(function FolderTreeItem({
  folder,
  level,
  onSelect,
}: FolderTreeItemProps) {
  const {
    currentFolderId,
    expandedFolderIds,
    toggleFolderExpanded,
    navigateToFolder,
    setTreeFolders,
    setLoadingFolder,
  } = useFolderNavigation();

  // Use direct selectors for reactive subscription
  // 1. Subfolders - returns undefined if not loaded, empty array if loaded but empty
  const subfoldersFromStore = useFolderTreeStore(
    (state) => state.treeFolders[folder.id]
  );
  const subfolders = subfoldersFromStore || EMPTY_FOLDERS;
  const isLoaded = subfoldersFromStore !== undefined; // Distinguish "not loaded" vs "empty"

  // 2. Loading state - must be reactive to show spinner
  const isLoading = useFolderTreeStore(
    (state) => state.loadingFolderIds.has(folder.id)
  );

  const isExpanded = expandedFolderIds.includes(folder.id);
  const isSelected = currentFolderId === folder.id;

  // Lazy load children when expanded and not yet loaded
  useEffect(() => {
    const loadChildren = async () => {
      if (!isExpanded) return;
      if (isLoaded) return; // Already loaded (even if empty)
      if (isLoading) return; // Already loading

      setLoadingFolder(folder.id, true);
      try {
        const fileApi = getFileApiClient();
        const result = await fileApi.getFiles({ folderId: folder.id });
        if (result.success) {
          const childFolders = result.data.files.filter((f) => f.isFolder);
          // Always set, even if empty - this marks as "loaded"
          setTreeFolders(folder.id, childFolders);
        }
      } catch (err) {
        console.error(`[FolderTreeItem] Failed to load children for folder ${folder.id}:`, err);
        // On error, still mark as loaded to prevent infinite retries
        setTreeFolders(folder.id, []);
      } finally {
        setLoadingFolder(folder.id, false);
      }
    };

    loadChildren();
  }, [isExpanded, folder.id, isLoaded, isLoading, setLoadingFolder, setTreeFolders]);

  const handleSelect = useCallback(() => {
    if (onSelect) {
      // Pass full folder data for breadcrumb path construction
      onSelect(folder.id, folder);
    } else {
      // Pass full folder data for breadcrumb path construction
      navigateToFolder(folder.id, folder);
    }
  }, [folder, onSelect, navigateToFolder]);

  return (
    <Collapsible open={isExpanded} onOpenChange={() => toggleFolderExpanded(folder.id)}>
      <FileContextMenu file={folder}>
        <div
          className={cn(
            'flex items-center gap-1 py-1 px-2 rounded cursor-pointer hover:bg-accent/50 transition-colors',
            isSelected && 'bg-accent'
          )}
          style={{ paddingLeft: `${level * 12 + 8}px` }}
          onClick={handleSelect}
        >
          {/* Expand/collapse button */}
          <CollapsibleTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="p-0.5 hover:bg-accent rounded"
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
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

          {/* Folder icon and name */}
          <div className="flex items-center gap-2 flex-1 truncate">
            <Folder className={cn(
              'size-4 flex-shrink-0',
              isExpanded ? 'text-amber-600' : 'text-amber-500'
            )} />
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-sm truncate">{folder.name}</span>
              </TooltipTrigger>
              <TooltipContent side="right">{folder.name}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </FileContextMenu>

      {/* Subfolders */}
      <CollapsibleContent>
        {subfolders.map(child => (
          <FolderTreeItem
            key={child.id}
            folder={child}
            level={level + 1}
            onSelect={onSelect}
          />
        ))}
        {/* If expanded and no subfolders, shows nothing. Could add 'Empty' indicator if we knew for sure it was loaded. */}
      </CollapsibleContent>
    </Collapsible>
  );
});
