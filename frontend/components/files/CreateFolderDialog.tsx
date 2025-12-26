'use client';

import { useState, useCallback } from 'react';
import { FolderPlus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFileActions, useFolderNavigation } from '@/src/domains/files';
import { validateFolderName } from '@/lib/utils/validation';
import { toast } from 'sonner';

interface CreateFolderDialogProps {
  trigger?: React.ReactNode;
  isCompact?: boolean;
}

export function CreateFolderDialog({ trigger, isCompact = false }: CreateFolderDialogProps) {
  const [open, setOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const { createFolder, isLoading: isCreating, error } = useFileActions();
  const { currentFolderId } = useFolderNavigation();

  // Handle dialog open state change - reset form when opening
  const handleOpenChange = useCallback((newOpen: boolean) => {
    setOpen(newOpen);
    if (newOpen) {
      setFolderName('');
    }
  }, []);

  const handleCreate = useCallback(async () => {
    const trimmedName = folderName.trim();

    // Use shared validation utility (supports Danish characters æ, ø, å, etc.)
    const validation = validateFolderName(trimmedName);
    if (!validation.valid) {
      toast.error(validation.error);
      return;
    }

    // useFileActions manages isLoading state internally
    const result = await createFolder(trimmedName, currentFolderId);

    if (result) {
      toast.success(`Folder "${trimmedName}" created`);
      setOpen(false);
    } else {
      toast.error(error || 'Failed to create folder');
    }
  }, [folderName, createFolder, currentFolderId, error]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isCreating) {
      e.preventDefault();
      handleCreate();
    }
  }, [handleCreate, isCreating]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="sm" className="h-8 gap-1">
            <FolderPlus className="size-4" />
            {!isCompact && <span className="hidden sm:inline">New Folder</span> }
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Folder</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="folder-name">What are you saving here?</Label>
            <Input
              id="folder-name"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. My Documents"
              autoFocus
              disabled={isCreating}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isCreating}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={isCreating || !folderName.trim()}
          >
            {isCreating ? 'Creating...' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
