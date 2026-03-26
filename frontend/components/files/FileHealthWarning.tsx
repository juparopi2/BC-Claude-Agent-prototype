'use client';

/**
 * FileHealthWarning
 *
 * Toolbar icon that appears when there are problematic files (failed, stuck,
 * blob-missing). Shows a badge with the issue count and opens a popover
 * with actionable details.
 *
 * Renders nothing when all files are healthy (zero toolbar footprint).
 *
 * @module components/files/FileHealthWarning
 */

import { useState, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useFileHealth } from '@/src/domains/files';
import { useFileHealthStore } from '@/src/domains/files/stores/fileHealthStore';
import { FileHealthIssueList } from './FileHealthIssueList';

export function FileHealthWarning() {
  const [open, setOpen] = useState(false);
  const health = useFileHealth();
  const lastFetchedAt = useFileHealthStore((s) => s.lastFetchedAt);

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      setOpen(isOpen);
      // Re-fetch when popover opens to get fresh data
      if (isOpen) {
        void health.fetchHealthIssues();
      }
    },
    [health],
  );

  // Don't render until the first fetch completes, then only show if there are issues.
  // This prevents a flash of the warning icon on mount before we know whether issues exist.
  if (!lastFetchedAt || health.totalIssueCount === 0) return null;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 relative">
              <AlertTriangle className="size-4 text-amber-500" />
              {health.totalIssueCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 size-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center pointer-events-none">
                  {health.totalIssueCount > 99 ? '99+' : health.totalIssueCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {health.totalIssueCount} file issue{health.totalIssueCount !== 1 ? 's' : ''}
        </TooltipContent>
      </Tooltip>
      <PopoverContent className="w-[420px] p-0" align="end" sideOffset={8}>
        <FileHealthIssueList
          health={health}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
