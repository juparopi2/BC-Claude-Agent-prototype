'use client';

/**
 * FileHealthIssueList
 *
 * Grouped list of file health issues rendered inside the FileHealthWarning
 * popover. Shows issues grouped by type with per-file and bulk actions.
 *
 * @module components/files/FileHealthIssueList
 */

import { useCallback } from 'react';
import {
  RefreshCw,
  Trash2,
  RotateCcw,
  CheckCircle2,
  Loader2,
  FileText,
  Image as ImageIcon,
  FileSpreadsheet,
  File,
  FolderOpen,
  AlertTriangle,
  Clock,
  XCircle,
  AlertOctagon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { UseFileHealthReturn } from '@/src/domains/files';
import type { FileHealthIssue, FileHealthIssueType } from '@bc-agent/shared';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FileHealthIssueListProps {
  health: UseFileHealthReturn;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Section config
// ---------------------------------------------------------------------------

interface SectionConfig {
  type: FileHealthIssueType;
  label: string;
  color: string;
  bgColor: string;
  icon: React.ReactNode;
  showRetryAll: boolean;
}

const SECTIONS: SectionConfig[] = [
  {
    type: 'external_not_found',
    label: 'Deleted from Source',
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-50 dark:bg-red-950/30',
    icon: <AlertOctagon className="size-3.5" />,
    showRetryAll: false,
  },
  {
    type: 'retry_exhausted',
    label: 'Retry Exhausted',
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-950/30',
    icon: <AlertTriangle className="size-3.5" />,
    showRetryAll: true,
  },
  {
    type: 'blob_missing',
    label: 'Missing from Storage',
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-50 dark:bg-red-950/30',
    icon: <AlertOctagon className="size-3.5" />,
    showRetryAll: false,
  },
  {
    type: 'failed_retriable',
    label: 'Failed',
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-50 dark:bg-orange-950/30',
    icon: <XCircle className="size-3.5" />,
    showRetryAll: true,
  },
  {
    type: 'stuck_processing',
    label: 'Stuck Processing',
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-950/30',
    icon: <Clock className="size-3.5" />,
    showRetryAll: true,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMimeIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return <ImageIcon className="size-4 text-muted-foreground" />;
  if (mimeType.includes('spreadsheet') || mimeType === 'text/csv')
    return <FileSpreadsheet className="size-4 text-muted-foreground" />;
  if (mimeType === 'application/pdf' || mimeType.startsWith('text/'))
    return <FileText className="size-4 text-muted-foreground" />;
  return <File className="size-4 text-muted-foreground" />;
}

function getStuckDuration(updatedAt: string): string {
  const diffMs = Date.now() - new Date(updatedAt).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h`;
  return `${Math.floor(diffHours / 24)}d`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FileHealthIssueList({ health, onClose }: FileHealthIssueListProps) {
  const {
    issues,
    isLoading,
    totalIssueCount,
    fetchHealthIssues,
    retryFile,
    retryAllRetriable,
    deleteFile,
    acceptBlobMissing,
    removeAllExternalNotFound,
    retryingFileIds,
    deletingFileIds,
  } = health;

  const handleAcceptBlobMissing = useCallback(
    (issue: FileHealthIssue) => {
      onClose();
      void acceptBlobMissing(issue);
    },
    [acceptBlobMissing, onClose],
  );

  // Group issues by type
  const grouped = new Map<FileHealthIssueType, FileHealthIssue[]>();
  for (const issue of issues) {
    const group = grouped.get(issue.issueType) ?? [];
    group.push(issue);
    grouped.set(issue.issueType, group);
  }

  return (
    <div className="flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-amber-500" />
          <h3 className="text-sm font-semibold">File Issues</h3>
          {totalIssueCount > 0 && (
            <span className="text-xs text-muted-foreground">({totalIssueCount})</span>
          )}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => void fetchHealthIssues()}
              disabled={isLoading}
            >
              <RefreshCw className={cn('size-3.5', isLoading && 'animate-spin')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
      </div>

      {/* Content */}
      <div className="max-h-96 overflow-y-auto scrollbar-thin scrollbar-thumb-rounded scrollbar-thumb-muted">
        {/* Loading */}
        {isLoading && totalIssueCount === 0 && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="size-5 animate-spin mr-2" />
            <span className="text-sm">Checking files...</span>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && totalIssueCount === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
            <CheckCircle2 className="size-8 text-green-500" />
            <span className="text-sm font-medium">All files are healthy</span>
          </div>
        )}

        {/* Issue sections */}
        {SECTIONS.map((section) => {
          const sectionIssues = grouped.get(section.type);
          if (!sectionIssues || sectionIssues.length === 0) return null;

          return (
            <div key={section.type} className="border-b last:border-b-0">
              {/* Section header */}
              <div className={cn('flex items-center justify-between px-4 py-2 sticky top-0 bg-background/95 backdrop-blur z-10 shadow-sm border-b', section.bgColor)}>
                <div className={cn('flex items-center gap-1.5 text-xs font-medium', section.color)}>
                  {section.icon}
                  <span>{section.label}</span>
                  <span className="text-muted-foreground font-normal">({sectionIssues.length})</span>
                </div>
                {section.type === 'external_not_found' && sectionIssues.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs px-2"
                    onClick={() => void removeAllExternalNotFound()}
                  >
                    <Trash2 className="size-3 mr-1" />
                    Remove All
                  </Button>
                )}
                {section.showRetryAll && sectionIssues.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs px-2"
                    onClick={() => void retryAllRetriable()}
                  >
                    <RotateCcw className="size-3 mr-1" />
                    Retry All
                  </Button>
                )}
              </div>

              {/* Issue rows */}
              {sectionIssues.map((issue) => (
                <IssueRow
                  key={issue.fileId}
                  issue={issue}
                  isRetrying={retryingFileIds.has(issue.fileId)}
                  isDeleting={deletingFileIds.has(issue.fileId)}
                  onRetry={() => void retryFile(issue.fileId)}
                  onDelete={() => void deleteFile(issue.fileId)}
                  onAcceptBlobMissing={() => handleAcceptBlobMissing(issue)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Issue Row
// ---------------------------------------------------------------------------

interface IssueRowProps {
  issue: FileHealthIssue;
  isRetrying: boolean;
  isDeleting: boolean;
  onRetry: () => void;
  onDelete: () => void;
  onAcceptBlobMissing: () => void;
}

function IssueRow({ issue, isRetrying, isDeleting, onRetry, onDelete, onAcceptBlobMissing }: IssueRowProps) {
  const isBusy = isRetrying || isDeleting;

  return (
    <div className="flex items-center gap-2 px-4 py-2 hover:bg-muted/50 transition-colors overflow-hidden">
      {/* File icon */}
      <div className="shrink-0">
        {getMimeIcon(issue.mimeType)}
      </div>

      {/* File info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate" title={issue.fileName}>
          {issue.fileName}
        </p>
        {issue.issueType === 'external_not_found' && (
          <p className="text-xs text-red-500 dark:text-red-400 truncate">
            No longer exists in {issue.sourceType === 'sharepoint' ? 'SharePoint' : 'OneDrive'}
          </p>
        )}
        {issue.issueType === 'blob_missing' && (
          <p className="text-xs text-red-500 dark:text-red-400 truncate">
            File not found in storage
          </p>
        )}
        {issue.issueType === 'stuck_processing' && (
          <p className="text-xs text-muted-foreground truncate">
            Stuck for {getStuckDuration(issue.updatedAt)}
          </p>
        )}
        {issue.lastError && issue.issueType !== 'blob_missing' && issue.issueType !== 'external_not_found' && (
          <p className="text-xs text-muted-foreground truncate" title={issue.lastError}>
            {issue.lastError}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {issue.issueType === 'external_not_found' ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs px-2"
                onClick={onDelete}
                disabled={isBusy}
              >
                {isDeleting ? (
                  <Loader2 className="size-3 animate-spin mr-1" />
                ) : (
                  <Trash2 className="size-3 mr-1" />
                )}
                Remove
              </Button>
            </TooltipTrigger>
            <TooltipContent>Remove file record (source file no longer exists)</TooltipContent>
          </Tooltip>
        ) : issue.issueType === 'blob_missing' ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2"
                  onClick={onAcceptBlobMissing}
                  disabled={isBusy}
                >
                  {isDeleting ? (
                    <Loader2 className="size-3 animate-spin mr-1" />
                  ) : (
                    <FolderOpen className="size-3 mr-1" />
                  )}
                  Accept
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete file and navigate to folder for re-upload</TooltipContent>
            </Tooltip>
          </>
        ) : (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={onRetry}
                  disabled={isBusy}
                >
                  {isRetrying ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="size-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Retry processing</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  onClick={onDelete}
                  disabled={isBusy}
                >
                  {isDeleting ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete file</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
}
