/**
 * BatchStatusIcon Component
 *
 * Status icon for a folder batch in the upload progress panel.
 *
 * @module components/files/upload-progress/BatchStatusIcon
 */

import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FolderBatch } from '@bc-agent/shared';

interface BatchStatusIconProps {
  status: FolderBatch['status'];
  isCurrentBatch?: boolean;
}

export function BatchStatusIcon({ status, isCurrentBatch = false }: BatchStatusIconProps) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="size-3 text-green-600" />;
    case 'failed':
      return <AlertCircle className="size-3 text-red-600" />;
    case 'uploading':
    case 'processing':
    case 'creating':
    case 'registering':
      return (
        <Loader2
          className={cn(
            'size-3 animate-spin',
            isCurrentBatch ? 'text-primary-foreground' : 'text-primary'
          )}
        />
      );
    default:
      return null;
  }
}
