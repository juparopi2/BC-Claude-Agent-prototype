'use client';

import { useState, useCallback, memo, useMemo } from 'react';
import { Globe, ChevronRight, ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { MENTION_TYPE } from '@bc-agent/shared';
import { LibraryTreeItem } from './LibraryTreeItem';
import { ScopeContextMenu } from './ScopeContextMenu';
import type { ParsedFile } from '@bc-agent/shared';
import type { SharePointSiteNode } from '@/src/domains/files/types/siteNode.types';

interface SiteTreeItemProps {
  site: SharePointSiteNode;
  level: number;
  onSiteSelect: (siteId: string, siteName: string) => void;
  /** Called when a library is selected in the tree */
  onLibrarySelect?: (siteId: string, siteName: string, driveId: string, libraryName: string, scopeId?: string) => void;
  /** Called when a folder inside this site's libraries is clicked in the tree */
  onFolderSelect?: (siteId: string, siteName: string, folderId: string, folder: ParsedFile, driveId: string, libraryName: string, scopeId?: string) => void;
}

export const SiteTreeItem = memo(function SiteTreeItem({
  site,
  level,
  onSiteSelect,
  onLibrarySelect,
  onFolderSelect,
}: SiteTreeItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleSelect = useCallback(() => {
    onSiteSelect(site.siteId, site.displayName);
  }, [site.siteId, site.displayName, onSiteSelect]);

  const handleLibrarySelect = useCallback(
    (driveId: string, libraryName: string, scopeId?: string) => {
      if (onLibrarySelect) {
        onLibrarySelect(site.siteId, site.displayName, driveId, libraryName, scopeId);
      } else {
        onSiteSelect(site.siteId, site.displayName);
      }
    },
    [site.siteId, site.displayName, onSiteSelect, onLibrarySelect]
  );

  // Site-bound folder select: binds siteId/siteName so child FolderTreeItems
  // can trigger full source-switching via the parent handler
  const handleFolderSelect = useMemo(() => {
    if (!onFolderSelect) return undefined;
    return (folderId: string, folder: ParsedFile, driveId: string, libraryName: string, scopeId?: string) => {
      onFolderSelect(site.siteId, site.displayName, folderId, folder, driveId, libraryName, scopeId);
    };
  }, [site.siteId, site.displayName, onFolderSelect]);

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <ScopeContextMenu
        scopeId={site.siteId}
        name={site.displayName}
        scopeType={MENTION_TYPE.SITE}
        siteId={site.siteId}
      >
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
            aria-label={isExpanded ? 'Collapse site' : 'Expand site'}
          >
            {isExpanded ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}
          </button>
        </CollapsibleTrigger>

        {/* Site icon and name */}
        <div className="flex items-center gap-2 flex-1 truncate">
          <Globe className="size-4 flex-shrink-0 text-[#038387]" />
          <span className="text-sm truncate flex-1">{site.displayName}</span>
          {site.totalFileCount > 0 && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 flex-shrink-0">
              {site.totalFileCount}
            </Badge>
          )}
        </div>
      </div>
      </ScopeContextMenu>

      <CollapsibleContent>
        {site.libraries.map((library) => (
          <LibraryTreeItem
            key={library.scopeId ?? `drive-${library.driveId}`}
            library={library}
            siteId={site.siteId}
            level={level + 1}
            onSelect={handleLibrarySelect}
            onFolderSelect={handleFolderSelect}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
});
