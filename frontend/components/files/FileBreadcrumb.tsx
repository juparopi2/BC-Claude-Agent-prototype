'use client';

import { useCallback } from 'react';
import { Home, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFileStore } from '@/lib/stores/fileStore';

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
  const folderPath = useFileStore(state => state.folderPath);
  const currentFolderId = useFileStore(state => state.currentFolderId);
  const { navigateToFolder } = useFileStore();

  const handleNavigate = useCallback((folderId: string | null) => {
    navigateToFolder(folderId);
  }, [navigateToFolder]);

  return (
    <nav
      className="flex items-center gap-1 text-sm px-2 py-1.5 overflow-x-auto"
      aria-label="Folder path"
    >
      {/* Home/Root */}
      <button
        onClick={() => handleNavigate(null)}
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded hover:bg-accent transition-colors',
          currentFolderId === null && 'bg-accent font-medium'
        )}
        aria-current={currentFolderId === null ? 'page' : undefined}
      >
        <Home className="size-4" />
        <span className="sr-only sm:not-sr-only">Files</span>
      </button>

      {/* Path segments */}
      {folderPath.map((folder, index) => (
        <div key={folder.id} className="flex items-center">
          <ChevronRight className="size-4 text-muted-foreground flex-shrink-0" />
          <button
            onClick={() => handleNavigate(folder.id)}
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
