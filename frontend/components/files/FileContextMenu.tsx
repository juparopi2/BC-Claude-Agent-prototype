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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { toast } from 'sonner';

interface FileContextMenuProps {
  file: ParsedFile;
  children: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
}

export function FileContextMenu({ file, children, onOpenChange }: FileContextMenuProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [newName, setNewName] = useState(file.name);
  const [isRenaming, setIsRenaming] = useState(false);

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
    if (!trimmedName || trimmedName === file.name) {
      setRenameOpen(false);
      return;
    }

    setIsRenaming(true);
    const success = await renameFile(file.id, trimmedName);
    setIsRenaming(false);

    if (success) {
      toast.success('File renamed');
      setRenameOpen(false);
    } else {
      toast.error('Failed to rename file');
    }
  }, [file, newName, renameFile]);

  const handleToggleFavorite = useCallback(async () => {
    await toggleFavorite(file.id);
  }, [file.id, toggleFavorite]);

  const handleDelete = useCallback(async () => {
    if (confirm(`Delete "${file.name}"? ${file.isFolder ? 'This will delete all contents.' : ''}`)) {
      const success = await deleteFiles([file.id]);
      if (success) {
        toast.success(`"${file.name}" deleted`);
      } else {
        toast.error('Failed to delete');
      }
    }
  }, [file, deleteFiles]);

  const handleCopyPath = useCallback(() => {
    navigator.clipboard.writeText(file.blobPath);
    toast.success('Path copied to clipboard');
  }, [file.blobPath]);

  return (
    <>
      <DropdownMenu onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          {children}
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-48">
          {!file.isFolder && (
            <DropdownMenuItem onClick={handleDownload}>
              <Download className="size-4 mr-2" />
              Download
            </DropdownMenuItem>
          )}

          <DropdownMenuItem onClick={() => {
            setNewName(file.name);
            setRenameOpen(true);
          }}>
            <Pencil className="size-4 mr-2" />
            Rename
          </DropdownMenuItem>

          <DropdownMenuItem onClick={handleToggleFavorite}>
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
          </DropdownMenuItem>

          <DropdownMenuItem onClick={handleCopyPath}>
            <Copy className="size-4 mr-2" />
            Copy path
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={handleDelete}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="size-4 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
    </>
  );
}
