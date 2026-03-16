'use client';

import { useCallback } from 'react';
import { BookOpen } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useFolderTreeStore } from '@/src/domains/files/stores/folderTreeStore';
import type { SharePointLibraryNode } from '@/src/domains/files/types/siteNode.types';

export function SharePointLibrariesGrid() {
  const sharepointSites = useFolderTreeStore((s) => s.sharepointSites);
  const activeSiteContext = useFolderTreeStore((s) => s.activeSiteContext);
  const setActiveLibraryContext = useFolderTreeStore((s) => s.setActiveLibraryContext);

  const currentSite = sharepointSites.find((s) => s.siteId === activeSiteContext?.siteId);
  const libraries = currentSite?.libraries ?? [];

  const handleLibraryClick = useCallback(
    (library: SharePointLibraryNode) => {
      setActiveLibraryContext({
        driveId: library.driveId,
        libraryName: library.displayName,
        scopeId: library.scopeId,
      });
    },
    [setActiveLibraryContext]
  );

  if (libraries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 gap-3 text-muted-foreground">
        <BookOpen className="size-12 opacity-30" />
        <p className="text-sm">No libraries found in this site</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {libraries.map((library) => (
          <Card
            key={library.scopeId ?? `drive-${library.driveId}`}
            className="flex items-center gap-3 p-4 cursor-pointer hover:bg-accent/50 transition-colors"
            onClick={() => handleLibraryClick(library)}
          >
            <div className="flex items-center justify-center size-10 rounded-lg bg-[#038387]/10 flex-shrink-0">
              <BookOpen className="size-5 text-[#038387]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{library.displayName}</p>
              <p className="text-xs text-muted-foreground">
                {library.folderScopes
                  ? `${library.folderScopes.length} folder ${library.folderScopes.length === 1 ? 'scope' : 'scopes'}`
                  : 'Full library'}
              </p>
            </div>
            {library.fileCount > 0 && (
              <Badge variant="secondary" className="flex-shrink-0">
                {library.fileCount}
              </Badge>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
