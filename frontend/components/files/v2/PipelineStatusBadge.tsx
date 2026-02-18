'use client';

/**
 * PipelineStatusBadge
 *
 * Maps PipelineStatus to colored badges using shadcn Badge.
 *
 * @module components/files/v2/PipelineStatusBadge
 */

import { Badge } from '@/components/ui/badge';
import { PIPELINE_STATUS, type PipelineStatus } from '@bc-agent/shared';
import { cn } from '@/lib/utils';

interface PipelineStatusBadgeProps {
  status: PipelineStatus | string | null;
  className?: string;
}

const STATUS_CONFIG: Record<string, { label: string; variant: string; animate?: boolean }> = {
  [PIPELINE_STATUS.REGISTERED]: { label: 'Registered', variant: 'bg-muted text-muted-foreground' },
  [PIPELINE_STATUS.UPLOADED]: { label: 'Uploaded', variant: 'bg-muted text-muted-foreground' },
  [PIPELINE_STATUS.QUEUED]: { label: 'Queued', variant: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' },
  [PIPELINE_STATUS.EXTRACTING]: { label: 'Extracting', variant: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200', animate: true },
  [PIPELINE_STATUS.CHUNKING]: { label: 'Chunking', variant: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200', animate: true },
  [PIPELINE_STATUS.EMBEDDING]: { label: 'Embedding', variant: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200', animate: true },
  [PIPELINE_STATUS.READY]: { label: 'Ready', variant: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  [PIPELINE_STATUS.FAILED]: { label: 'Failed', variant: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
};

export function PipelineStatusBadge({ status, className }: PipelineStatusBadgeProps) {
  if (!status) return null;

  const config = STATUS_CONFIG[status] ?? { label: status, variant: 'bg-muted text-muted-foreground' };

  return (
    <Badge
      variant="outline"
      className={cn(
        'text-xs font-medium border-0',
        config.variant,
        config.animate && 'animate-pulse',
        className
      )}
    >
      {config.label}
    </Badge>
  );
}
