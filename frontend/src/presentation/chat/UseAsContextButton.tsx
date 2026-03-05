'use client';

/**
 * UseAsContextButton Component
 *
 * Button that adds the currently previewed file as a chat context mention.
 * Shows "Added" state when file is already in mentions.
 *
 * @module presentation/chat/UseAsContextButton
 */

import { useCallback } from 'react';
import { AtSign, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useFileMentionStore } from '@/src/domains/chat/stores/fileMentionStore';
import { dispatchAddMentionEvent } from '@/src/domains/chat/utils/mentionEvent';

interface UseAsContextButtonProps {
  fileId: string;
  fileName: string;
  mimeType: string;
}

export function UseAsContextButton({ fileId, fileName, mimeType }: UseAsContextButtonProps) {
  const mentions = useFileMentionStore((s) => s.mentions);

  const isAlreadyAdded = mentions.some((m) => m.fileId === fileId);

  const handleClick = useCallback(() => {
    if (isAlreadyAdded) return;

    dispatchAddMentionEvent({
      fileId,
      name: fileName,
      isFolder: false,
      mimeType,
    });

    toast.success('Added as context', {
      description: `${fileName} will be included in your next message`,
    });
  }, [fileId, fileName, mimeType, isAlreadyAdded]);

  if (isAlreadyAdded) {
    return (
      <Button
        variant="outline"
        disabled
        className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
        aria-label="File already added as context"
      >
        <Check className="size-4" />
        Added
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      onClick={handleClick}
      className="border-emerald-500/30 hover:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      aria-label="Use file as chat context"
    >
      <AtSign className="size-4" />
      Use as Context
    </Button>
  );
}
