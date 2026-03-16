'use client';

import { useState, useCallback, memo } from 'react';
import { Globe, ChevronRight, ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { LibraryTreeItem } from './LibraryTreeItem';
import type { SharePointSiteNode } from '@/src/domains/files/types/siteNode.types';

interface SiteTreeItemProps {
  site: SharePointSiteNode;
  level: number;
  onSiteSelect: (siteId: string, siteName: string) => void;
}

export const SiteTreeItem = memo(function SiteTreeItem({
  site,
  level,
  onSiteSelect,
}: SiteTreeItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleSelect = useCallback(() => {
    onSiteSelect(site.siteId, site.displayName);
  }, [site.siteId, site.displayName, onSiteSelect]);

  const handleLibrarySelect = useCallback(() => {
    // Selecting a library also activates the site context
    onSiteSelect(site.siteId, site.displayName);
  }, [site.siteId, site.displayName, onSiteSelect]);

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
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

      <CollapsibleContent>
        {site.libraries.map((library) => (
          <LibraryTreeItem
            key={library.scopeId ?? `drive-${library.driveId}`}
            library={library}
            siteId={site.siteId}
            level={level + 1}
            onSelect={handleLibrarySelect}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
});
