'use client';

/**
 * InlineMention Component
 *
 * Renders an inline styled badge for @mentions in message content.
 * Used within MentionAwareContent to display mention markers as styled elements.
 *
 * @module presentation/chat/InlineMention
 */

import { File, Folder, Image } from 'lucide-react';
import { cn } from '@/lib/utils';

interface InlineMentionProps {
  name: string;
  isFolder: boolean;
  mimeType?: string;
  onClick?: () => void;
}

export function InlineMention({ name, isFolder, mimeType, onClick }: InlineMentionProps) {
  const isImage = mimeType?.startsWith('image/');

  const Icon = isFolder ? Folder : isImage ? Image : File;
  const isClickable = !!onClick;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 px-1 py-0.5 mx-0.5 rounded text-xs font-medium bg-white/20 text-primary-foreground border border-white/30',
        isClickable && 'cursor-pointer hover:bg-white/30 transition-colors',
      )}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={isClickable ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      } : undefined}
    >
      <Icon className="size-3 shrink-0" />
      <span>@{name}</span>
    </span>
  );
}
