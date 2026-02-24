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

interface InlineMentionProps {
  name: string;
  isFolder: boolean;
  mimeType?: string;
}

export function InlineMention({ name, isFolder, mimeType }: InlineMentionProps) {
  const isImage = mimeType?.startsWith('image/');

  const Icon = isFolder ? Folder : isImage ? Image : File;

  return (
    <span className="inline-flex items-center gap-0.5 px-1 py-0.5 mx-0.5 rounded text-xs font-medium bg-emerald-500/15 text-emerald-200 border border-emerald-500/25">
      <Icon className="size-3 shrink-0" />
      <span>@{name}</span>
    </span>
  );
}
