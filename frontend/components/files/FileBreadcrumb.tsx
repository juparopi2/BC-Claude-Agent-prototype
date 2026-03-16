'use client';

import { useCallback } from 'react';
import { ChevronRight, Star, Building2, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFolderNavigation } from '@/src/domains/files';
import { useFolderTreeStore } from '@/src/domains/files/stores/folderTreeStore';
import { useSortFilterStore } from '@/src/domains/files/stores/sortFilterStore';
import { getFileSourceUI } from '@/src/domains/files/utils/fileSourceUI';
import { FILE_SOURCE_TYPE } from '@bc-agent/shared';

/**
 * FileBreadcrumb Component
 *
 * Displays a breadcrumb navigation trail from root to the current folder.
 * Allows users to navigate to any ancestor folder in the hierarchy.
 *
 * Features:
 * - Clickable navigation segments
 * - Home icon for root folder
 * - Truncates long folder names with tooltip
 * - Highlights current location
 * - Responsive design (hides "Files" text on small screens)
 * - Horizontal scrollable for deep paths
 * - Accessible with ARIA labels
 * - SharePoint site segment when navigating within a specific site
 *
 * @example
 * ```tsx
 * <FileBreadcrumb />
 * ```
 */
export function FileBreadcrumb() {
  const { folderPath, currentFolderId, setCurrentFolder, activeSiteContext, setActiveSiteContext } =
    useFolderNavigation();
  const activeLibraryContext = useFolderTreeStore((s) => s.activeLibraryContext);
  const setActiveLibraryContext = useFolderTreeStore((s) => s.setActiveLibraryContext);
  const showFavoritesOnly = useSortFilterStore((s) => s.showFavoritesOnly);
  const sourceTypeFilter = useSortFilterStore((s) => s.sourceTypeFilter);

  const sourceUI = getFileSourceUI(sourceTypeFilter);

  const isSharePoint = sourceTypeFilter === FILE_SOURCE_TYPE.SHAREPOINT;
  const showSiteSegment = isSharePoint && activeSiteContext !== null;
  const showLibrarySegment = showSiteSegment && activeLibraryContext !== null;

  const handleNavigate = useCallback(
    (folderId: string | null, index: number) => {
      if (folderId === null) {
        setCurrentFolder(null, []);
      } else {
        // Truncate path to the clicked folder (inclusive)
        const newPath = folderPath.slice(0, index + 1);
        setCurrentFolder(folderId, newPath);
      }
    },
    [setCurrentFolder, folderPath]
  );

  /** Clicking the site segment clears library context and folder path → back to libraries grid */
  const handleSiteClick = useCallback(() => {
    setActiveLibraryContext(null);
    setCurrentFolder(null, []);
    // Keep activeSiteContext so the site label stays in the breadcrumb
  }, [setCurrentFolder, setActiveLibraryContext]);

  /** Clicking the library segment clears folder path → back to library root files */
  const handleLibraryClick = useCallback(() => {
    setCurrentFolder(null, []);
    // Keep both activeSiteContext and activeLibraryContext
  }, [setCurrentFolder]);

  return (
    <nav
      className="flex items-center gap-1 text-sm px-2 py-1.5 overflow-x-auto"
      aria-label="Folder path"
    >
      {/* Home/Root — clicking clears both site and library context */}
      <button
        onClick={() => {
          handleNavigate(null, -1);
          if (isSharePoint) {
            setActiveSiteContext(null);
            setActiveLibraryContext(null);
          }
        }}
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded hover:bg-accent transition-colors cursor-pointer',
          currentFolderId === null && !showSiteSegment && 'bg-accent font-medium'
        )}
        aria-current={currentFolderId === null && !showSiteSegment ? 'page' : undefined}
      >
        {showFavoritesOnly ? (
          <Star className="size-4 fill-amber-400 text-amber-400" />
        ) : (
          <sourceUI.Icon
            className="size-4"
            {...(sourceUI.accentColor ? { style: { color: sourceUI.accentColor } } : {})}
          />
        )}
        <span className="sr-only sm:not-sr-only">
          {showFavoritesOnly ? 'Favorites' : sourceUI.displayName}
        </span>
      </button>

      {/* SharePoint site segment — shown when drilling into a specific site */}
      {showSiteSegment && (
        <div className="flex items-center">
          <ChevronRight className="size-4 text-muted-foreground flex-shrink-0" />
          <button
            onClick={handleSiteClick}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded hover:bg-accent transition-colors truncate max-w-40 cursor-pointer',
              currentFolderId === null && folderPath.length === 0 && !showLibrarySegment && 'bg-accent font-medium'
            )}
            title={activeSiteContext.siteName}
            aria-current={
              currentFolderId === null && folderPath.length === 0 && !showLibrarySegment ? 'page' : undefined
            }
          >
            <Building2 className="size-3.5 flex-shrink-0 text-muted-foreground" />
            <span className="truncate">{activeSiteContext.siteName}</span>
          </button>
        </div>
      )}

      {/* SharePoint library segment — shown when inside a specific library */}
      {showLibrarySegment && (
        <div className="flex items-center">
          <ChevronRight className="size-4 text-muted-foreground flex-shrink-0" />
          <button
            onClick={handleLibraryClick}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded hover:bg-accent transition-colors truncate max-w-40 cursor-pointer',
              currentFolderId === null && folderPath.length === 0 && 'bg-accent font-medium'
            )}
            title={activeLibraryContext!.libraryName}
            aria-current={
              currentFolderId === null && folderPath.length === 0 ? 'page' : undefined
            }
          >
            <BookOpen className="size-3.5 flex-shrink-0 text-[#038387]" />
            <span className="truncate">{activeLibraryContext!.libraryName}</span>
          </button>
        </div>
      )}

      {/* Path segments */}
      {folderPath.map((folder, index) => (
        <div key={folder.id} className="flex items-center">
          <ChevronRight className="size-4 text-muted-foreground flex-shrink-0" />
          <button
            onClick={() => handleNavigate(folder.id, index)}
            className={cn(
              'px-2 py-1 rounded hover:bg-accent transition-colors truncate max-w-32 cursor-pointer',
              index === folderPath.length - 1 && 'bg-accent font-medium'
            )}
            title={folder.name}
            aria-current={index === folderPath.length - 1 ? 'page' : undefined}
          >
            {folder.name}
          </button>
        </div>
      ))}
    </nav>
  );
}
