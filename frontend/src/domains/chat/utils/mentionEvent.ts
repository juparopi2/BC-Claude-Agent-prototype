/**
 * Mention Event Utility
 *
 * Dispatches a CustomEvent on `window` so that the ChatInput component
 * (which listens for `file-mention:add`) can call the correct `addMention`
 * depending on whether it is in pending mode or normal mode.
 *
 * This mirrors the drag-and-drop flow where ChatInput handles the actual
 * store mutation, ensuring consistent behavior across all entry points.
 *
 * @module domains/chat/utils/mentionEvent
 */

import type { FileMention } from '@bc-agent/shared';

/** Event name used for programmatic mention additions */
export const FILE_MENTION_ADD_EVENT = 'file-mention:add';

/**
 * Dispatch a file-mention:add event for ChatInput to handle.
 *
 * @param mentions - Single mention or array of mentions to add
 */
export function dispatchAddMentionEvent(mentions: FileMention | FileMention[]): void {
  window.dispatchEvent(
    new CustomEvent(FILE_MENTION_ADD_EVENT, { detail: mentions }),
  );
}
