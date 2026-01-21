'use client';

/**
 * MessageAttachmentCarousel Component
 *
 * Displays chat attachments associated with a user message as a horizontal carousel.
 * Shows file type icons, file names, and status indicators.
 *
 * Based on SourceCarousel pattern but simplified for chat attachments.
 *
 * @module presentation/chat/MessageAttachmentCarousel
 */

import { useCallback, useMemo } from 'react';
import {
  ChevronRight,
  FileText,
  FileSpreadsheet,
  FileImage,
  File,
  FileCode,
  FileArchive,
  FileWarning,
  Clock,
  Trash2,
} from 'lucide-react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ChatAttachmentSummary } from '@bc-agent/shared';
import { env } from '@/lib/config/env';

/**
 * Props for MessageAttachmentCarousel
 */
export interface MessageAttachmentCarouselProps {
  /** List of attachments to display */
  attachments: ChatAttachmentSummary[];
  /** Callback when an attachment card is clicked */
  onAttachmentClick?: (attachment: ChatAttachmentSummary, allAttachments: ChatAttachmentSummary[]) => void;
  /** Maximum number of cards visible before showing "+N more" */
  maxVisible?: number;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Get file extension from filename
 */
function getExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() || '';
}

/**
 * Get icon type based on file type
 */
function getFileIconType(fileName: string, mimeType: string): 'text' | 'spreadsheet' | 'image' | 'code' | 'archive' | 'file' {
  // Check mimeType first for images
  if (mimeType?.startsWith('image/')) {
    return 'image';
  }

  const ext = getExtension(fileName);

  switch (ext) {
    case 'pdf':
    case 'doc':
    case 'docx':
    case 'txt':
    case 'md':
      return 'text';
    case 'xls':
    case 'xlsx':
    case 'csv':
      return 'spreadsheet';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
      return 'image';
    case 'js':
    case 'ts':
    case 'jsx':
    case 'tsx':
    case 'json':
    case 'html':
    case 'css':
      return 'code';
    case 'zip':
    case 'rar':
    case '7z':
    case 'tar':
    case 'gz':
      return 'archive';
    default:
      return 'file';
  }
}

/**
 * Renders the appropriate file icon based on type
 */
function FileIcon({ iconType, className }: { iconType: ReturnType<typeof getFileIconType>; className?: string }) {
  switch (iconType) {
    case 'text':
      return <FileText className={className} />;
    case 'spreadsheet':
      return <FileSpreadsheet className={className} />;
    case 'image':
      return <FileImage className={className} />;
    case 'code':
      return <FileCode className={className} />;
    case 'archive':
      return <FileArchive className={className} />;
    default:
      return <File className={className} />;
  }
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * StatusBadge - shows attachment status indicator
 */
function StatusBadge({ status }: { status: ChatAttachmentSummary['status'] }) {
  if (status === 'ready') {
    return null; // Don't show badge for ready status
  }

  const config = status === 'expired'
    ? { icon: Clock, label: 'Expired', color: 'bg-amber-100 text-amber-700 border-amber-300' }
    : { icon: Trash2, label: 'Deleted', color: 'bg-red-100 text-red-700 border-red-300' };

  const Icon = config.icon;

  return (
    <Badge variant="outline" className={cn('gap-1 px-1.5 py-0 text-[10px] h-5', config.color)}>
      <Icon className="size-3" />
      {config.label}
    </Badge>
  );
}

/**
 * Get chat attachment thumbnail URL
 */
function getAttachmentThumbnailUrl(attachmentId: string): string {
  return `${env.apiUrl}/api/chat/attachments/${attachmentId}/content`;
}

/**
 * AttachmentThumbnail - renders thumbnail or icon for attachment
 */
function AttachmentThumbnail({
  attachment,
}: {
  attachment: ChatAttachmentSummary;
}) {
  const isUnavailable = attachment.status !== 'ready';

  // Unavailable attachment: show warning icon
  if (isUnavailable) {
    return (
      <div className="flex items-center justify-center w-full h-16 rounded-lg bg-red-50">
        <FileWarning className="size-6 text-red-400" />
      </div>
    );
  }

  // Image with valid ID: show thumbnail
  if (attachment.isImage && attachment.id) {
    return (
      <div className="flex items-center justify-center w-full h-16 rounded-lg overflow-hidden bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={getAttachmentThumbnailUrl(attachment.id)}
          alt={`Thumbnail of ${attachment.name}`}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => {
            // On error, hide the image and let parent show fallback
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      </div>
    );
  }

  // Non-image: show file type icon
  const iconType = getFileIconType(attachment.name, attachment.mimeType);

  return (
    <div className="flex items-center justify-center w-full h-16 rounded-lg bg-muted">
      <FileIcon iconType={iconType} className="size-6 text-muted-foreground" />
    </div>
  );
}

/**
 * AttachmentCard - individual card in the carousel
 */
function AttachmentCard({
  attachment,
  onClick,
}: {
  attachment: ChatAttachmentSummary;
  onClick?: () => void;
}) {
  const isClickable = attachment.status === 'ready' && onClick !== undefined;
  const isUnavailable = attachment.status !== 'ready';

  return (
    <Card
      className={cn(
        'w-36 shrink-0 transition-all overflow-hidden gap-1 py-2',
        isUnavailable
          ? 'opacity-60 border-red-200 bg-red-50/50'
          : isClickable
            ? 'cursor-pointer hover:border-primary hover:shadow-md'
            : 'opacity-70'
      )}
      onClick={isClickable ? onClick : undefined}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      {/* Thumbnail Area */}
      <div className="px-2 pt-1">
        <AttachmentThumbnail attachment={attachment} />
      </div>

      <CardContent className="p-2 space-y-1">
        {/* File Name */}
        <p
          className={cn(
            'text-xs font-medium truncate',
            isUnavailable && 'line-through text-red-600'
          )}
          title={attachment.name}
        >
          {attachment.name}
        </p>

        {/* Footer: Size or Status */}
        {!isUnavailable ? (
          <p className="text-[10px] text-muted-foreground">
            {formatFileSize(attachment.sizeBytes)}
          </p>
        ) : (
          <StatusBadge status={attachment.status} />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * MessageAttachmentCarousel Component
 *
 * Displays chat attachments associated with a user message as a horizontal carousel:
 * - File type icons or image thumbnails
 * - File names and sizes
 * - Status badges for expired/deleted attachments
 * - "+N more" indicator when exceeding maxVisible
 *
 * @example
 * ```tsx
 * <MessageAttachmentCarousel
 *   attachments={attachments}
 *   onAttachmentClick={(attachment) => openPreview(attachment)}
 *   maxVisible={5}
 * />
 * ```
 */
export function MessageAttachmentCarousel({
  attachments,
  onAttachmentClick,
  maxVisible = 5,
  className,
}: MessageAttachmentCarouselProps) {
  // Determine visible attachments and overflow count
  const visibleAttachments = useMemo(
    () => attachments.slice(0, maxVisible),
    [attachments, maxVisible]
  );
  const overflowCount = attachments.length - maxVisible;

  const handleCardClick = useCallback(
    (attachment: ChatAttachmentSummary) => {
      if (attachment.status === 'ready' && onAttachmentClick) {
        onAttachmentClick(attachment, attachments);
      }
    },
    [onAttachmentClick, attachments]
  );

  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className={cn('w-full', className)}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          Attachments ({attachments.length})
        </span>
      </div>

      {/* Carousel */}
      <ScrollArea className="w-full whitespace-nowrap">
        <div className="flex gap-2 pb-2">
          {visibleAttachments.map((attachment) => (
            <AttachmentCard
              key={attachment.id}
              attachment={attachment}
              onClick={() => handleCardClick(attachment)}
            />
          ))}

          {/* Overflow indicator */}
          {overflowCount > 0 && (
            <Card className="w-20 shrink-0 flex items-center justify-center border-dashed">
              <CardContent className="p-2 flex flex-col items-center gap-1 text-muted-foreground">
                <ChevronRight className="size-4" />
                <span className="text-xs font-medium">+{overflowCount}</span>
                <span className="text-[10px]">more</span>
              </CardContent>
            </Card>
          )}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}
