'use client';

import { useState, useCallback, memo } from 'react';
import type { ParsedFile } from '@bc-agent/shared';
import { Folder, ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface FolderTreeItemProps {
  folder: ParsedFile;
  level: number;
  isSelected: boolean;
  subfolders?: ParsedFile[];  // Child folders
  onSelect: (folderId: string) => void;
  onLoadChildren?: (folderId: string) => Promise<void>;
}

export const FolderTreeItem = memo(function FolderTreeItem({
  folder,
  level,
  isSelected,
  subfolders = [],
  onSelect,
  onLoadChildren,
}: FolderTreeItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoadedChildren, setHasLoadedChildren] = useState(false);

  const hasChildren = subfolders.length > 0;

  const handleToggle = useCallback(async () => {
    // Only load children if we haven't loaded them yet and we're expanding
    if (!isExpanded && !hasLoadedChildren && onLoadChildren) {
      setIsLoading(true);
      await onLoadChildren(folder.id);
      setHasLoadedChildren(true); // Mark as loaded
      setIsLoading(false);
    }
    setIsExpanded(!isExpanded);
  }, [isExpanded, hasLoadedChildren, onLoadChildren, folder.id]);

  const handleSelect = useCallback(() => {
    onSelect(folder.id);
  }, [folder.id, onSelect]);

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div
        className={cn(
          'flex items-center gap-1 py-1 px-2 rounded cursor-pointer hover:bg-accent/50 transition-colors',
          isSelected && 'bg-accent'
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
      >
        {/* Expand/collapse button */}
        <CollapsibleTrigger asChild>
          <button
            onClick={handleToggle}
            className="p-0.5 hover:bg-accent rounded"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isLoading ? (
              <div className="size-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            ) : isExpanded ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}
          </button>
        </CollapsibleTrigger>

        {/* Folder icon and name */}
        <button
          onClick={handleSelect}
          className="flex items-center gap-2 flex-1 truncate"
        >
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
        </button>
      </div>

      {/* Subfolders */}
      <CollapsibleContent>
        {subfolders.map(child => (
          <FolderTreeItem
            key={child.id}
            folder={child}
            level={level + 1}
            isSelected={false}  // Will be managed by parent
            subfolders={[]}  // Will be loaded on expand
            onSelect={onSelect}
            onLoadChildren={onLoadChildren}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
});
