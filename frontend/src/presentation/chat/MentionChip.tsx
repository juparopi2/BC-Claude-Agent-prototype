'use client';

/**
 * MentionChip Component
 *
 * Styled chip for displaying a file/folder mention in the chat input.
 * Shows file icon, name, and remove button.
 *
 * @module presentation/chat/MentionChip
 */

import type { FileMention } from '@bc-agent/shared';
import { MENTION_TYPE, MENTION_MIME_TYPE } from '@bc-agent/shared';
import { X, FileText, Folder, Image, Globe, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MentionChipProps {
  /** The mention to display */
  mention: FileMention;
  /** Remove this mention */
  onRemove: () => void;
}

/**
 * Get icon for mention type — distinguishes sites, libraries, folders, images, and files.
 */
function getMentionIcon(mention: FileMention) {
  if (mention.mimeType === MENTION_MIME_TYPE.LIBRARY) {
    return <BookOpen className="size-3 text-teal-600" />;
  }
  if (mention.type === MENTION_TYPE.SITE || mention.mimeType === MENTION_MIME_TYPE.SITE) {
    return <Globe className="size-3 text-teal-600" />;
  }
  if (mention.isFolder) return <Folder className="size-3 text-amber-500" />;
  if (mention.mimeType?.startsWith('image/')) return <Image className="size-3" />;
  return <FileText className="size-3" />;
}

export function MentionChip({ mention, onRemove }: MentionChipProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border',
        'max-w-[200px]',
        'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
      )}
    >
      {getMentionIcon(mention)}

      <span className="truncate" title={mention.name}>
        {mention.name}
      </span>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors flex items-center justify-center"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
