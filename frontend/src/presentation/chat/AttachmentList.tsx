/**
 * AttachmentList Component
 *
 * Displays a list of file attachments with their upload status.
 *
 * @module presentation/chat/AttachmentList
 */

import { FileAttachmentChip } from './FileAttachmentChip';
import type { Attachment } from '@/src/domains/chat/hooks/useFileAttachments';

interface AttachmentListProps {
  /** List of attachments to display */
  attachments: Attachment[];
  /** Callback when attachment remove button is clicked */
  onRemove: (tempId: string) => void;
}

/**
 * Renders a list of file attachment chips
 */
export function AttachmentList({ attachments, onRemove }: AttachmentListProps) {
  if (attachments.length === 0) {
    return null;
  }

  // Map status - FileAttachmentChip doesn't support 'pending', treat as 'uploading'
  const mapStatus = (status: Attachment['status']): 'uploading' | 'completed' | 'error' => {
    if (status === 'pending') return 'uploading';
    return status;
  };

  return (
    <div className="flex flex-wrap gap-2" data-testid="attachment-list">
      {attachments.map((attachment) => (
        <FileAttachmentChip
          key={attachment.tempId}
          name={attachment.name}
          size={attachment.size}
          type={attachment.type}
          status={mapStatus(attachment.status)}
          progress={attachment.progress}
          error={attachment.error}
          onRemove={() => onRemove(attachment.tempId)}
        />
      ))}
    </div>
  );
}

export default AttachmentList;
