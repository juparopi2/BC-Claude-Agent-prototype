'use client';

import { useCallback } from 'react';
import { Home, ChevronRight, Star, Cloud } from 'lucide-react';
import { FILE_SOURCE_TYPE, PROVIDER_ACCENT_COLOR, PROVIDER_DISPLAY_NAME, PROVIDER_ID } from '@bc-agent/shared';
import { cn } from '@/lib/utils';
import { useFolderNavigation } from '@/src/domains/files';
import { useSortFilterStore } from '@/src/domains/files/stores/sortFilterStore';

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
 *
 * @example
 * ```tsx
 * <FileBreadcrumb />
 * ```
 */
export function FileBreadcrumb() {
  const { folderPath, currentFolderId, setCurrentFolder } = useFolderNavigation();
  const showFavoritesOnly = useSortFilterStore((s) => s.showFavoritesOnly);
  const sourceTypeFilter = useSortFilterStore((s) => s.sourceTypeFilter);
  const setSourceTypeFilter = useSortFilterStore((s) => s.setSourceTypeFilter);

  const handleNavigate = useCallback((folderId: string | null, index: number) => {
    if (folderId === null) {
      // Clear filter when going to root (back to "All Files")
      setSourceTypeFilter(null);
      setCurrentFolder(null, []);
    } else {
      // Truncate path to the clicked folder (inclusive)
      const newPath = folderPath.slice(0, index + 1);
      setCurrentFolder(folderId, newPath);
    }
  }, [setCurrentFolder, setSourceTypeFilter, folderPath]);

  return (
    <nav
      className="flex items-center gap-1 text-sm px-2 py-1.5 overflow-x-auto"
      aria-label="Folder path"
    >
      {/* Home/Root */}
      <button
        onClick={() => handleNavigate(null, -1)}
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded hover:bg-accent transition-colors',
          currentFolderId === null && 'bg-accent font-medium'
        )}
        aria-current={currentFolderId === null ? 'page' : undefined}
      >
        {showFavoritesOnly ? (
          <Star className="size-4 fill-amber-400 text-amber-400" />
        ) : sourceTypeFilter === FILE_SOURCE_TYPE.ONEDRIVE ? (
          <Cloud className="size-4" style={{ color: PROVIDER_ACCENT_COLOR[PROVIDER_ID.ONEDRIVE] }} />
        ) : (
          <Home className="size-4" />
        )}
        <span className="sr-only sm:not-sr-only">
          {showFavoritesOnly ? 'Favorites' : sourceTypeFilter === FILE_SOURCE_TYPE.ONEDRIVE ? PROVIDER_DISPLAY_NAME[PROVIDER_ID.ONEDRIVE] : 'Files'}
        </span>
      </button>

      {/* Path segments */}
      {folderPath.map((folder, index) => (
        <div key={folder.id} className="flex items-center">
          <ChevronRight className="size-4 text-muted-foreground flex-shrink-0" />
          <button
            onClick={() => handleNavigate(folder.id, index)}
            className={cn(
              'px-2 py-1 rounded hover:bg-accent transition-colors truncate max-w-32',
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
