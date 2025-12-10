'use client';

import { useCallback, memo } from 'react';
import type { ParsedFile } from '@bc-agent/shared';
import { Folder, ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useFileStore } from '@/lib/stores/fileStore';

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
  const currentFolderId = useFileStore(state => state.currentFolderId);
  const expandedFolderIds = useFileStore(state => state.expandedFolderIds);
  const treeFolders = useFileStore(state => state.treeFolders);
  const { toggleFolderExpanded, navigateToFolder } = useFileStore();

  const isExpanded = expandedFolderIds.includes(folder.id);
  const isSelected = currentFolderId === folder.id;
  const subfolders = treeFolders[folder.id] || [];
  

  // Determine if we are loading: if expanded but no children and not specifically empty array (though we init with empty array in toggle... 
  // actually toggleFolderExpanded sets empty array? No, it sets nothing until fetch success. but we default to [] above. 
  // We need a way to know if we are 'loading'. 
  // Store doesn't have granular loading state per folder yet. 
  // Simple heuristic: if expanded and subfolders length is 0, we *might* be loading or it's empty.
  // Ideally, store should track loading. But for now, user said "iterative manner", sticking to simple is better.
  // The 'loading' spinner in the original code was based on local state.
  // We can add a simple local state "isLocallyToggling" to show spinner? OR add loading to store.
  // Let's rely on global isLoading? No, that locks the whole UI.
  // Let's just show chevron for now. If user clicks and it takes time, we rely on async action.
  // Improvement: Add loading state to store future.

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFolderExpanded(folder.id);
  }, [toggleFolderExpanded, folder.id]);

  const handleSelect = useCallback(() => {
    if (onSelect) {
      onSelect(folder.id);
    } else {
      navigateToFolder(folder.id);
    }
  }, [folder.id, onSelect, navigateToFolder]);

  return (
    <Collapsible open={isExpanded} onOpenChange={() => toggleFolderExpanded(folder.id)}>
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
             {isExpanded ? (
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
