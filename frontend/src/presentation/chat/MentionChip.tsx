'use client';

/**
 * MentionChip Component
 *
 * Styled chip for displaying a file/folder mention in the chat input.
 * Shows file icon, name, mode toggle (for images), and remove button.
 *
 * @module presentation/chat/MentionChip
 */

import type { FileMention } from '@bc-agent/shared';
import { X, FileText, Folder, Image, Eye, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface MentionChipProps {
  /** The mention to display */
  mention: FileMention;
  /** Toggle between rag_context and direct_vision */
  onToggleMode: () => void;
  /** Remove this mention */
  onRemove: () => void;
}

/**
 * Get icon for file type
 */
function getMentionIcon(mention: FileMention) {
  if (mention.isFolder) return <Folder className="size-3 text-amber-500" />;
  if (mention.mimeType?.startsWith('image/')) return <Image className="size-3" />;
  return <FileText className="size-3" />;
}

/**
 * Check if mention can toggle to vision mode
 */
function canToggleVision(mention: FileMention): boolean {
  return !mention.isFolder && Boolean(mention.mimeType?.startsWith('image/'));
}

export function MentionChip({ mention, onToggleMode, onRemove }: MentionChipProps) {
  const isVision = mention.mode === 'direct_vision';
  const showToggle = canToggleVision(mention);

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border',
        'max-w-[200px]',
        isVision
          ? 'bg-purple-500/10 border-purple-500/30 text-purple-700 dark:text-purple-300'
          : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
      )}
    >
      {getMentionIcon(mention)}

      <span className="truncate" title={mention.name}>
        {mention.name}
      </span>

      {showToggle && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleMode();
                }}
                className={cn(
                  'p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors',
                  'flex items-center justify-center'
                )}
              >
                {isVision ? (
                  <Eye className="size-3" />
                ) : (
                  <Search className="size-3" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs">
                {isVision ? 'Vision mode: image sent directly to AI' : 'RAG mode: used for search context'}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

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
