'use client';

/**
 * FileStatusIndicator Component
 *
 * Displays visual indicator for file processing state.
 * Shows different UI for uploading, processing, ready, and failed states.
 *
 * @module components/files/FileStatusIndicator
 */

import { memo, useCallback } from 'react';
import { Loader2, Check, AlertCircle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import {
  useFileProcessingStore,
  selectFileProcessingStatus,
} from '@/src/domains/files/stores/fileProcessingStore';
import { useFileRetry } from '@/src/domains/files/hooks/useFileRetry';
import type { FileReadinessState } from '@bc-agent/shared';

/**
 * Props for FileStatusIndicator
 */
export interface FileStatusIndicatorProps {
  /** File ID to show status for */
  fileId: string;
  /** Current readiness state from ParsedFile */
  readinessState: FileReadinessState;
  /** Additional CSS classes */
  className?: string;
  /** Show compact mode (no text, smaller icons) */
  compact?: boolean;
}

/**
 * Processing Spinner - Shows during uploading or processing
 */
function ProcessingSpinner({
  progress,
  attemptNumber,
  maxAttempts,
  isUploading,
  compact,
}: {
  progress?: number;
  attemptNumber?: number;
  maxAttempts?: number;
  isUploading: boolean;
  compact: boolean;
}) {
  const hasProgress = progress !== undefined && progress > 0 && progress < 100;
  const hasAttempts = attemptNumber !== undefined && maxAttempts !== undefined;

  const label = isUploading
    ? 'Uploading...'
    : hasAttempts
      ? `Processing (${attemptNumber}/${maxAttempts})...`
      : 'Processing...';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn('flex items-center gap-1', compact ? 'w-4' : 'w-auto')}
          role="status"
          aria-label={label}
        >
          <Loader2
            className={cn(
              'animate-spin text-blue-500',
              compact ? 'size-3' : 'size-4'
            )}
          />
          {!compact && hasProgress && (
            <div className="w-12">
              <Progress value={progress} className="h-1" />
            </div>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        <p>{label}</p>
        {hasProgress && <p className="text-muted-foreground">{progress}%</p>}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Ready Indicator - Shows checkmark when file is ready
 */
function ReadyIndicator({ compact }: { compact: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="flex items-center"
          role="status"
          aria-label="Ready"
        >
          <Check
            className={cn(
              'text-green-500',
              compact ? 'size-3' : 'size-4'
            )}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        Ready for use
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Failed Indicator - Shows error icon with retry button
 */
function FailedIndicator({
  fileId,
  error,
  canRetry,
  compact,
}: {
  fileId: string;
  error?: string;
  canRetry?: boolean;
  compact: boolean;
}) {
  const { retryFile, isRetrying } = useFileRetry();

  const handleRetry = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      retryFile(fileId);
    },
    [fileId, retryFile]
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="flex items-center gap-1"
          role="status"
          aria-label={error || 'Processing failed'}
        >
          <AlertCircle
            className={cn(
              'text-red-500',
              compact ? 'size-3' : 'size-4'
            )}
          />
          {canRetry && !compact && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRetry}
              disabled={isRetrying}
              className="h-5 px-1 text-xs"
              aria-label="Retry processing"
            >
              <RefreshCw
                className={cn('size-3', isRetrying && 'animate-spin')}
              />
            </Button>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs text-xs">
        <p className="font-medium text-red-500">Processing failed</p>
        {error && <p className="text-muted-foreground">{error}</p>}
        {canRetry && <p className="text-blue-500 mt-1">Click to retry</p>}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * FileStatusIndicator Component
 *
 * Displays visual indicator for file processing state:
 * - uploading: Spinner with progress
 * - processing: Spinner with attempt info and progress
 * - ready: Green checkmark
 * - failed: Red error icon with retry button
 *
 * @example
 * ```tsx
 * <FileStatusIndicator
 *   fileId={file.id}
 *   readinessState={file.readinessState}
 * />
 * ```
 */
export const FileStatusIndicator = memo(function FileStatusIndicator({
  fileId,
  readinessState,
  className,
  compact = false,
}: FileStatusIndicatorProps) {
  // Get processing status from store (real-time updates)
  const processingStatus = useFileProcessingStore((state) =>
    selectFileProcessingStatus(state, fileId)
  );

  // Use store status if available, fallback to prop
  const effectiveState = processingStatus?.readinessState ?? readinessState;

  // Don't show indicator for ready state in compact mode
  if (effectiveState === 'ready' && compact) {
    return null;
  }

  return (
    <div className={cn('inline-flex items-center', className)}>
      {effectiveState === 'uploading' && (
        <ProcessingSpinner
          progress={processingStatus?.progress}
          isUploading={true}
          compact={compact}
        />
      )}

      {effectiveState === 'processing' && (
        <ProcessingSpinner
          progress={processingStatus?.progress}
          attemptNumber={processingStatus?.attemptNumber}
          maxAttempts={processingStatus?.maxAttempts}
          isUploading={false}
          compact={compact}
        />
      )}

      {effectiveState === 'ready' && <ReadyIndicator compact={compact} />}

      {effectiveState === 'failed' && (
        <FailedIndicator
          fileId={fileId}
          error={processingStatus?.error}
          canRetry={processingStatus?.canRetryManually}
          compact={compact}
        />
      )}
    </div>
  );
});
