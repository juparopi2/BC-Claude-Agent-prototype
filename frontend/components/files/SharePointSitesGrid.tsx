'use client';

import { useCallback } from 'react';
import { Globe } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useFolderTreeStore } from '@/src/domains/files/stores/folderTreeStore';
import type { SharePointSiteNode } from '@/src/domains/files/types/siteNode.types';

export function SharePointSitesGrid() {
  const sharepointSites = useFolderTreeStore((s) => s.sharepointSites);
  const setActiveSiteContext = useFolderTreeStore((s) => s.setActiveSiteContext);
  const setActiveLibraryContext = useFolderTreeStore((s) => s.setActiveLibraryContext);

  const handleSiteClick = useCallback(
    (site: SharePointSiteNode) => {
      setActiveSiteContext({ siteId: site.siteId, siteName: site.displayName });
      setActiveLibraryContext(null);
    },
    [setActiveSiteContext, setActiveLibraryContext]
  );

  if (sharepointSites.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 gap-3 text-muted-foreground">
        <Globe className="size-12 opacity-30" />
        <p className="text-sm">No SharePoint sites configured</p>
        <p className="text-xs">Connect SharePoint and select sites to sync</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {sharepointSites.map((site) => (
          <Card
            key={site.siteId}
            className="flex items-center gap-3 p-4 cursor-pointer hover:bg-accent/50 transition-colors"
            onClick={() => handleSiteClick(site)}
          >
            {/* Site avatar with initials */}
            <div className="flex items-center justify-center size-10 rounded-lg bg-[#038387] text-white font-semibold text-sm flex-shrink-0">
              {site.displayName.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{site.displayName}</p>
              <p className="text-xs text-muted-foreground">
                {site.libraries.length} {site.libraries.length === 1 ? 'library' : 'libraries'} · {site.totalFileCount} files
              </p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
