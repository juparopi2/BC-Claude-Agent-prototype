'use client';

import { useCallback, useState } from 'react';
import type { ParsedFile } from '@bc-agent/shared';
import {
  Download,
  Pencil,
  Star,
  StarOff,
  Trash2,
  Copy,
} from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFileStore } from '@/lib/stores/fileStore';
import { validateFolderName, validateFileName } from '@/lib/utils/validation';
import { toast } from 'sonner';

interface FileContextMenuProps {
  file: ParsedFile;
  children: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
}

export function FileContextMenu({ file, children, onOpenChange }: FileContextMenuProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [newName, setNewName] = useState(file.name);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const {
    downloadFile,
    renameFile,
    toggleFavorite,
    deleteFiles
  } = useFileStore();

  const handleDownload = useCallback(async () => {
    if (!file.isFolder) {
      await downloadFile(file.id, file.name);
    }
  }, [file, downloadFile]);

  const handleRename = useCallback(async () => {
    const trimmedName = newName.trim();

    // No change - close dialog
    if (!trimmedName || trimmedName === file.name) {
      setRenameOpen(false);
      return;
    }

    // Validate name (supports Danish characters æ, ø, å, etc.)
    const validation = file.isFolder
      ? validateFolderName(trimmedName)
      : validateFileName(trimmedName);

    if (!validation.valid) {
      toast.error(validation.error);
      return;
    }

    setIsRenaming(true);
    const success = await renameFile(file.id, trimmedName);
    setIsRenaming(false);

    if (success) {
      toast.success(`${file.isFolder ? 'Folder' : 'File'} renamed`);
      setRenameOpen(false);
    } else {
      toast.error(`Failed to rename ${file.isFolder ? 'folder' : 'file'}`);
    }
  }, [file, newName, renameFile]);

  const handleToggleFavorite = useCallback(async () => {
    await toggleFavorite(file.id);
  }, [file.id, toggleFavorite]);

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    const success = await deleteFiles([file.id]);
    setIsDeleting(false);
    
    if (success) {
      toast.success(`"${file.name}" deleted`);
      setDeleteOpen(false);
    } else {
      toast.error('Failed to delete');
    }
  }, [file, deleteFiles]);

  const handleCopyPath = useCallback(() => {
    navigator.clipboard.writeText(file.blobPath);
    toast.success('Path copied to clipboard');
  }, [file.blobPath]);

  return (
    <>
      <ContextMenu onOpenChange={onOpenChange}>
        <ContextMenuTrigger asChild>
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          {!file.isFolder && (
            <ContextMenuItem onClick={handleDownload}>
              <Download className="size-4 mr-2" />
              Download
            </ContextMenuItem>
          )}

          <ContextMenuItem onClick={() => {
            setNewName(file.name);
            setRenameOpen(true);
          }}>
            <Pencil className="size-4 mr-2" />
            Rename
          </ContextMenuItem>

          <ContextMenuItem onClick={handleToggleFavorite}>
            {file.isFavorite ? (
              <>
                <StarOff className="size-4 mr-2" />
                Remove from favorites
              </>
            ) : (
              <>
                <Star className="size-4 mr-2" />
                Add to favorites
              </>
            )}
          </ContextMenuItem>

          <ContextMenuItem onClick={handleCopyPath}>
            <Copy className="size-4 mr-2" />
            Copy path
          </ContextMenuItem>

          <ContextMenuSeparator />

          <ContextMenuItem
            onClick={() => setDeleteOpen(true)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="size-4 mr-2" />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Rename Dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename {file.isFolder ? 'Folder' : 'File'}</DialogTitle>
            <DialogDescription>
              Enter a new name for &ldquo;{file.name}&rdquo;
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="new-name">New name</Label>
              <Input
                id="new-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                autoFocus
                disabled={isRenaming}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)} disabled={isRenaming}>
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={isRenaming || !newName.trim()}>
              {isRenaming ? 'Renaming...' : 'Rename'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {file.isFolder ? 'Folder' : 'File'}</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{file.name}&rdquo;?
              {file.isFolder && (
                <span className="block mt-2 text-destructive font-semibold">
                  This will permanently delete all contents inside this folder and its subfolders.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleDelete} 
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
