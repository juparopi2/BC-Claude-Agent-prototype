'use client';

/**
 * DuplicateFileModal
 *
 * Three-scope duplicate resolution dialog.
 * Shows scope badge, match type, and existing file info.
 *
 * @module components/files/DuplicateFileModal
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
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { AlertTriangle, File, FolderOpen, SkipForward, Replace, Copy } from 'lucide-react';
import type { DuplicateScope, DuplicateMatchType } from '@bc-agent/shared';
import {
  useDuplicateStore,
  type DuplicateAction,
} from '@/src/domains/files/stores/duplicateResolutionStore';

// ============================================
// Helpers
// ============================================

function formatFileSize(bytes: number | null): string {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
}

const SCOPE_CONFIG: Record<DuplicateScope, { label: string; className: string }> = {
  storage: {
    label: 'Already in storage',
    className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  },
  pipeline: {
    label: 'Currently processing',
    className: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  },
  upload: {
    label: 'Being uploaded',
    className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  },
};

const MATCH_TYPE_LABELS: Record<DuplicateMatchType, string> = {
  name: 'Same name',
  content: 'Same content',
  name_and_content: 'Same name and content',
};

// ============================================
// Component
// ============================================

/**
 * Three-scope duplicate resolution dialog
 */
export function DuplicateFileModal() {
  const [applyToAll, setApplyToAll] = useState(false);

  const results = useDuplicateStore((s) => s.results);
  const resolutions = useDuplicateStore((s) => s.resolutions);
  const isModalOpen = useDuplicateStore((s) => s.isModalOpen);
  const targetFolderPath = useDuplicateStore((s) => s.targetFolderPath);
  const resolveOne = useDuplicateStore((s) => s.resolveOne);
  const resolveAllRemaining = useDuplicateStore((s) => s.resolveAllRemaining);
  const cancel = useDuplicateStore((s) => s.cancel);

  const duplicates = results.filter((r) => r.isDuplicate);
  const unresolvedDuplicates = duplicates.filter((d) => !resolutions.has(d.tempId));
  const current = unresolvedDuplicates[0];
  const currentIndex = duplicates.length - unresolvedDuplicates.length;
  const remainingCount = unresolvedDuplicates.length;

  if (!current) return null;

  const handleAction = (action: DuplicateAction) => {
    if (applyToAll && remainingCount > 1) {
      setApplyToAll(false);
      resolveAllRemaining(action);
    } else {
      resolveOne(current.tempId, action);
    }
  };

  const handleCancel = () => {
    setApplyToAll(false);
    cancel();
  };

  const scopeConfig = current.scope ? SCOPE_CONFIG[current.scope] : null;
  const matchLabel = current.matchType ? MATCH_TYPE_LABELS[current.matchType] : null;

  return (
    <Dialog open={isModalOpen} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-amber-500" />
            Duplicate File Detected
          </DialogTitle>
          <DialogDescription>
            {duplicates.length > 1
              ? `File ${currentIndex + 1} of ${duplicates.length} duplicates`
              : 'A file with matching content or name already exists'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          {/* Scope and match type badges */}
          <div className="flex items-center gap-2 flex-wrap">
            {scopeConfig && (
              <Badge variant="outline" className={`text-xs border-0 ${scopeConfig.className}`}>
                {scopeConfig.label}
              </Badge>
            )}
            {matchLabel && (
              <Badge variant="outline" className="text-xs">
                {matchLabel}
              </Badge>
            )}
          </div>

          {/* New file info */}
          <div className="rounded-lg border p-3 bg-muted/50">
            <p className="text-xs text-muted-foreground mb-1">New file:</p>
            <div className="flex items-center gap-2">
              <File className="size-4 text-blue-500 flex-shrink-0" />
              <span className="font-medium truncate flex-1">{current.fileName}</span>
            </div>
            <div className="flex items-center gap-1.5 mt-1.5">
              <FolderOpen className="size-3.5 text-muted-foreground flex-shrink-0" />
              <span className="text-xs text-muted-foreground">
                Uploading to: <span className="font-medium">{targetFolderPath ?? 'Root'}</span>
              </span>
            </div>
            {current.suggestedName && (
              <p className="text-xs text-muted-foreground mt-1">
                Keep Both will rename to: <span className="font-medium">{current.suggestedName}</span>
              </p>
            )}
          </div>

          {/* Existing file info */}
          {current.existingFile && (
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground mb-1">Existing file:</p>
              <div className="flex items-center gap-2">
                <File className="size-4 text-green-500 flex-shrink-0" />
                <span className="font-medium truncate flex-1">
                  {current.existingFile.fileName}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatFileSize(current.existingFile.fileSize)}
                </span>
              </div>
              <div className="flex items-center gap-1.5 mt-1.5">
                <FolderOpen className="size-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-xs text-muted-foreground">
                  Located in: <span className="font-medium">{current.existingFile.folderPath ?? 'Root'}</span>
                </span>
              </div>
              {current.existingFile.pipelineStatus && (
                <p className="text-xs text-muted-foreground mt-1">
                  Status: {current.existingFile.pipelineStatus}
                </p>
              )}
            </div>
          )}

          {/* Content-only match explanation */}
          {current.matchType === 'content' && (
            <p className="text-xs text-muted-foreground italic px-1">
              This file has identical content to an existing file in a different location.
            </p>
          )}

          {/* Apply to all checkbox */}
          {remainingCount > 1 && (
            <div className="flex items-center space-x-2">
              <Checkbox
                id="apply-all"
                checked={applyToAll}
                onCheckedChange={(checked: boolean | 'indeterminate') =>
                  setApplyToAll(checked === true)
                }
              />
              <Label htmlFor="apply-all" className="text-sm">
                Apply to all {remainingCount} remaining duplicates
              </Label>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row flex-wrap gap-2">
          <Button variant="outline" onClick={handleCancel} className="w-full sm:w-auto">
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
          <Button variant="secondary" onClick={() => handleAction('keep')} className="w-full sm:w-auto">
            <Copy className="size-4 mr-2" />
            Keep Both
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
