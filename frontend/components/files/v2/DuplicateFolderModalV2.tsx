'use client';

/**
 * DuplicateFolderModalV2
 *
 * Folder-level duplicate resolution dialog for V2 uploads.
 * Offers Cancel, Skip, Replace, and Keep Both actions.
 *
 * @module components/files/v2/DuplicateFolderModalV2
 */

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Folder, FolderOpen, SkipForward, Replace, Copy } from 'lucide-react';
import {
  useFolderDuplicateStoreV2,
  type FolderDuplicateActionV2,
  type FolderDuplicateResolutionV2,
} from '@/src/domains/files/stores/v2/folderDuplicateStoreV2';
import type { FolderDuplicateCheckResult } from '@bc-agent/shared';

// ============================================
// Inner content (keyed by tempId for natural state reset)
// ============================================

interface FolderDuplicateContentProps {
  current: FolderDuplicateCheckResult;
  currentIndex: number;
  totalDuplicates: number;
  remainingCount: number;
  targetFolderPath: string | null;
  onResolve: (resolution: FolderDuplicateResolutionV2) => void;
  onResolveAll: (action: FolderDuplicateActionV2) => void;
  onCancel: () => void;
}

function FolderDuplicateContent({
  current,
  currentIndex,
  totalDuplicates,
  remainingCount,
  targetFolderPath,
  onResolve,
  onResolveAll,
  onCancel,
}: FolderDuplicateContentProps) {
  const [applyToAll, setApplyToAll] = useState(false);
  const [customName, setCustomName] = useState(current.folderName);
  const [nameError, setNameError] = useState<string | null>(null);

  const validateCustomName = (name: string): string | null => {
    if (!name.trim()) return 'Name cannot be empty';
    if (name.includes('/') || name.includes('\\')) return 'Name cannot contain / or \\';
    if (name === current.folderName) return 'Name must be different from existing folder';
    return null;
  };

  const handleAction = (action: FolderDuplicateActionV2) => {
    if (applyToAll && remainingCount > 1) {
      setApplyToAll(false);
      onResolveAll(action);
      return;
    }

    if (action === 'keep_both') {
      const trimmedCustom = customName.trim();
      const error = validateCustomName(trimmedCustom);
      let resolvedName: string;

      if (!error && trimmedCustom !== current.folderName) {
        resolvedName = trimmedCustom;
      } else {
        resolvedName = current.suggestedName ?? current.folderName;
      }

      onResolve({
        tempId: current.tempId,
        action: 'keep_both',
        resolvedName,
      });
    } else if (action === 'replace') {
      onResolve({
        tempId: current.tempId,
        action: 'replace',
        resolvedName: current.folderName,
        existingFolderId: current.existingFolderId,
      });
    } else {
      onResolve({
        tempId: current.tempId,
        action: 'skip',
        resolvedName: current.folderName,
      });
    }
  };

  const handleCustomNameChange = (value: string) => {
    setCustomName(value);
    setNameError(validateCustomName(value));
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <AlertTriangle className="size-5 text-amber-500" />
          Duplicate Folder Detected
        </DialogTitle>
        <DialogDescription>
          {totalDuplicates > 1
            ? `Folder ${currentIndex + 1} of ${totalDuplicates} duplicates`
            : 'A folder with the same name already exists at this location'}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3 py-4">
        {/* New folder info */}
        <div className="rounded-lg border p-3 bg-muted/50">
          <p className="text-xs text-muted-foreground mb-1">New folder:</p>
          <div className="flex items-center gap-2">
            <Folder className="size-4 text-blue-500 flex-shrink-0" />
            <span className="font-medium truncate flex-1">{current.folderName}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1.5">
            <FolderOpen className="size-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-xs text-muted-foreground">
              Uploading to: <span className="font-medium">{targetFolderPath ?? 'Root'}</span>
            </span>
          </div>
        </div>

        {/* Existing folder info */}
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground mb-1">Existing folder:</p>
          <div className="flex items-center gap-2">
            <Folder className="size-4 text-green-500 flex-shrink-0" />
            <span className="font-medium truncate flex-1">{current.folderName}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1.5">
            <FolderOpen className="size-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-xs text-muted-foreground">
              Located at: <span className="font-medium">{targetFolderPath ?? 'Root'}</span>
            </span>
          </div>
        </div>

        {/* Custom name input for Keep Both */}
        <div className="space-y-1.5">
          <Label htmlFor="folder-custom-name" className="text-xs text-muted-foreground">
            Custom name for Keep Both:
          </Label>
          <Input
            id="folder-custom-name"
            value={customName}
            onChange={(e) => handleCustomNameChange(e.target.value)}
            placeholder={current.suggestedName ?? current.folderName}
            className="h-8 text-sm"
          />
          {nameError && (
            <p className="text-xs text-destructive">{nameError}</p>
          )}
          {current.suggestedName && (
            <p className="text-xs text-muted-foreground">
              Auto-rename suggestion: <span className="font-medium">{current.suggestedName}</span>
            </p>
          )}
        </div>

        {/* Apply to all checkbox */}
        {remainingCount > 1 && (
          <div className="flex items-center space-x-2">
            <Checkbox
              id="apply-all-folder-v2"
              checked={applyToAll}
              onCheckedChange={(checked: boolean | 'indeterminate') =>
                setApplyToAll(checked === true)
              }
            />
            <Label htmlFor="apply-all-folder-v2" className="text-sm">
              Apply to all {remainingCount} remaining duplicates
            </Label>
          </div>
        )}
      </div>

      <DialogFooter className="flex-col sm:flex-row flex-wrap gap-2">
        <Button variant="outline" onClick={onCancel} className="w-full sm:w-auto">
          Cancel Upload
        </Button>
        <Button variant="outline" onClick={() => handleAction('skip')} className="w-full sm:w-auto">
          <SkipForward className="size-4 mr-2" />
          Skip
        </Button>
        <Button variant="destructive" onClick={() => handleAction('replace')} className="w-full sm:w-auto">
          <Replace className="size-4 mr-2" />
          Replace
        </Button>
        <Button variant="secondary" onClick={() => handleAction('keep_both')} className="w-full sm:w-auto">
          <Copy className="size-4 mr-2" />
          Keep Both
        </Button>
      </DialogFooter>
    </>
  );
}

// ============================================
// Outer Dialog (manages open/close)
// ============================================

export function DuplicateFolderModalV2() {
  const results = useFolderDuplicateStoreV2((s) => s.results);
  const resolutions = useFolderDuplicateStoreV2((s) => s.resolutions);
  const isModalOpen = useFolderDuplicateStoreV2((s) => s.isModalOpen);
  const targetFolderPath = useFolderDuplicateStoreV2((s) => s.targetFolderPath);
  const resolveOne = useFolderDuplicateStoreV2((s) => s.resolveOne);
  const resolveAllRemaining = useFolderDuplicateStoreV2((s) => s.resolveAllRemaining);
  const cancel = useFolderDuplicateStoreV2((s) => s.cancel);

  const duplicates = results.filter((r) => r.isDuplicate);
  const unresolvedDuplicates = duplicates.filter((d) => !resolutions.has(d.tempId));
  const current = unresolvedDuplicates[0];
  const currentIndex = duplicates.length - unresolvedDuplicates.length;
  const remainingCount = unresolvedDuplicates.length;

  if (!current) return null;

  return (
    <Dialog open={isModalOpen} onOpenChange={(open) => !open && cancel()}>
      <DialogContent className="sm:max-w-lg">
        <FolderDuplicateContent
          key={current.tempId}
          current={current}
          currentIndex={currentIndex}
          totalDuplicates={duplicates.length}
          remainingCount={remainingCount}
          targetFolderPath={targetFolderPath}
          onResolve={resolveOne}
          onResolveAll={resolveAllRemaining}
          onCancel={cancel}
        />
      </DialogContent>
    </Dialog>
  );
}
