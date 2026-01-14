'use client';

/**
 * MultiFileContextMenu
 *
 * Context menu for handling multiple selected files.
 * Shows delete option with count and folder warning.
 *
 * @module components/files/MultiFileContextMenu
 */

import { useCallback, useState } from 'react';
import type { ParsedFile } from '@bc-agent/shared';
import { Trash2, Download } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useFileActions } from '@/src/domains/files';
import { toast } from 'sonner';

interface MultiFileContextMenuProps {
  /** Selected files to act upon */
  files: ParsedFile[];
  /** Child element that triggers the context menu */
  children: React.ReactNode;
  /** Callback when menu open state changes */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Context menu for multiple file selection
 *
 * Provides bulk operations like delete for multiple files.
 * Shows appropriate warnings for folders with contents.
 *
 * @example
 * ```tsx
 * <MultiFileContextMenu files={selectedFiles}>
 *   <div>Right-click me for multi-file actions</div>
 * </MultiFileContextMenu>
 * ```
 */
export function MultiFileContextMenu({
  files,
  children,
  onOpenChange,
}: MultiFileContextMenuProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const { deleteFiles, error: actionError } = useFileActions();

  // Count folders in selection
  const folderCount = files.filter((f) => f.isFolder).length;
  const fileCount = files.length - folderCount;
  const hasFolders = folderCount > 0;

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    const fileIds = files.map((f) => f.id);
    const success = await deleteFiles(fileIds);
    setIsDeleting(false);

    if (success) {
      toast.success(`${files.length} item${files.length > 1 ? 's' : ''} deleted`);
      setDeleteOpen(false);
    } else {
      toast.error(actionError || 'Failed to delete some items');
    }
  }, [files, deleteFiles, actionError]);

  // Format the item count description
  const getItemCountDescription = () => {
    const parts: string[] = [];
    if (fileCount > 0) {
      parts.push(`${fileCount} file${fileCount > 1 ? 's' : ''}`);
    }
    if (folderCount > 0) {
      parts.push(`${folderCount} folder${folderCount > 1 ? 's' : ''}`);
    }
    return parts.join(' and ');
  };

  return (
    <>
      <ContextMenu onOpenChange={onOpenChange}>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem
            onClick={() => setDeleteOpen(true)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="size-4 mr-2" />
            Delete {files.length} items
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {files.length} Items</DialogTitle>
            <DialogDescription asChild>
              <div>
                <p>
                  Are you sure you want to delete {getItemCountDescription()}?
                </p>
                {hasFolders && (
                  <p className="mt-2 text-destructive font-semibold">
                    This will permanently delete {folderCount} folder
                    {folderCount > 1 ? 's' : ''} with all their contents.
                  </p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : `Delete ${files.length} items`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
