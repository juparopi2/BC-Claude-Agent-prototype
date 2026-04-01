'use client';

/**
 * ScopeContextMenu
 *
 * Reusable right-click context menu that adds "Use as Context" to any tree item
 * (site, library, folder). Wraps children with a Radix ContextMenu and dispatches
 * the appropriate FileMention event when the action is selected.
 *
 * @module components/files/ScopeContextMenu
 */

import { useCallback } from 'react';
import { AtSign, Check } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { useFileMentionStore } from '@/src/domains/chat/stores/fileMentionStore';
import { dispatchAddMentionEvent } from '@/src/domains/chat/utils/mentionEvent';
import { MENTION_TYPE, MENTION_MIME_TYPE } from '@bc-agent/shared';
import type { FileMention, MentionType } from '@bc-agent/shared';
import { toast } from 'sonner';

interface ScopeContextMenuProps {
  /** Unique ID for this scope (siteId, folder UUID, etc.) */
  scopeId: string;
  /** Display name shown in toast and mention chip */
  name: string;
  /** Type of scope — determines how backend resolves the search filter */
  scopeType: MentionType;
  /** For site mentions: the actual siteId (defaults to scopeId) */
  siteId?: string;
  /** Override synthetic MIME type (e.g., MENTION_MIME_TYPE.LIBRARY for libraries) */
  mimeType?: string;
  children: React.ReactNode;
}

export function ScopeContextMenu({
  scopeId,
  name,
  scopeType,
  siteId,
  mimeType,
  children,
}: ScopeContextMenuProps) {
  const mentions = useFileMentionStore((s) => s.mentions);
  const isAlreadyMentioned = mentions.some((m) => m.fileId === scopeId);

  const handleUseAsContext = useCallback(() => {
    if (isAlreadyMentioned) return;

    const isSite = scopeType === MENTION_TYPE.SITE;
    const resolvedMimeType = mimeType ?? (isSite ? MENTION_MIME_TYPE.SITE : '');

    const mention: FileMention = {
      fileId: scopeId,
      name,
      isFolder: scopeType === MENTION_TYPE.FOLDER,
      mimeType: resolvedMimeType,
      type: scopeType,
    };
    if (isSite) {
      mention.siteId = siteId ?? scopeId;
    }

    dispatchAddMentionEvent(mention);

    const label = isSite ? 'site'
      : scopeType === MENTION_TYPE.FOLDER ? 'folder'
      : 'scope';
    toast.success('Added as context', {
      description: `${name} (${label}) will be included in your next message`,
    });
  }, [scopeId, name, scopeType, siteId, mimeType, isAlreadyMentioned]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem
          onClick={handleUseAsContext}
          disabled={isAlreadyMentioned}
          className="text-emerald-700 dark:text-emerald-300 focus:text-emerald-700 dark:focus:text-emerald-300"
        >
          {isAlreadyMentioned ? (
            <>
              <Check className="size-4 mr-2 text-emerald-600 dark:text-emerald-400" />
              Added as context
            </>
          ) : (
            <>
              <AtSign className="size-4 mr-2 text-emerald-600 dark:text-emerald-400" />
              Use as Context
            </>
          )}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
