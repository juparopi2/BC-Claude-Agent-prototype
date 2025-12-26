import { useCallback, memo, useEffect } from 'react';
import type { ParsedFile } from '@bc-agent/shared';
import { Folder, ChevronRight, ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useFolderNavigation } from '@/src/domains/files';
import { FileContextMenu } from './FileContextMenu';

interface FolderTreeItemProps {
  folder: ParsedFile;
  level: number;
  onSelect?: (folderId: string) => void;
}

export const FolderTreeItem = memo(function FolderTreeItem({
  folder,
  level,
  onSelect,
}: FolderTreeItemProps) {
  const {
    currentFolderId,
    expandedFolderIds,
    isFolderLoading,
    toggleFolderExpanded,
    navigateToFolder,
    getChildFolders,
  } = useFolderNavigation();

  const isLoading = isFolderLoading(folder.id);
  const isExpanded = expandedFolderIds.includes(folder.id);
  const isSelected = currentFolderId === folder.id;
  const subfolders = getChildFolders(folder.id);
  
  // Auto-collapse: If expanded but no children and not loading, force collapse
  // This prevents recursive auto-expansion of deep folders after reload if data is missing.
  useEffect(() => {
    if (isExpanded && subfolders.length === 0 && !isLoading) {
      toggleFolderExpanded(folder.id, false);
    }
  }, [isExpanded, subfolders.length, isLoading, folder.id, toggleFolderExpanded]);

  const handleSelect = useCallback(() => {
    if (onSelect) {
      onSelect(folder.id);
    } else {
      navigateToFolder(folder.id);
    }
  }, [folder.id, onSelect, navigateToFolder]);

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
