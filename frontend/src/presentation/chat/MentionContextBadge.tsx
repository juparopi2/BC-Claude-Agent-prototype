'use client';

/**
 * MentionContextBadge Component
 *
 * Compact badge section showing all @mentioned files/folders as clickable chips.
 * Provides a clear visual indicator regardless of whether @[Name] markers
 * exist in the message text (e.g., drag-and-drop mentions).
 *
 * @module presentation/chat/MentionContextBadge
 */

import type { FileMention } from '@bc-agent/shared';
import { Paperclip, Folder, Image, File } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MentionContextBadgeProps {
  mentions: FileMention[];
  onMentionClick?: (mention: FileMention) => void;
}

function getMentionIcon(mention: FileMention) {
  if (mention.isFolder) return Folder;
  if (mention.mimeType?.startsWith('image/')) return Image;
  return File;
}

export function MentionContextBadge({ mentions, onMentionClick }: MentionContextBadgeProps) {
  if (mentions.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap justify-end text-xs text-muted-foreground mt-1 px-1">
      <span className="flex items-center gap-1 opacity-60">
        <Paperclip className="size-3" />
        <span>Referenced</span>
      </span>
      {mentions.map((mention) => {
        const Icon = getMentionIcon(mention);
        const isClickable = !!onMentionClick;

        return (
          <button
            key={mention.fileId}
            type="button"
            className={cn(
              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md',
              'bg-muted/50 border border-border/50',
              isClickable && 'cursor-pointer hover:bg-muted hover:border-border transition-colors',
              !isClickable && 'cursor-default',
            )}
            onClick={isClickable ? () => onMentionClick(mention) : undefined}
            tabIndex={isClickable ? 0 : -1}
          >
            <Icon className="size-3 shrink-0" />
            <span className="max-w-[120px] truncate">{mention.name}</span>
          </button>
        );
      })}
    </div>
  );
}
