/**
 * Mention Constants
 *
 * Shared constants for the @mention system: file, folder, and site context
 * scoping in chat messages.
 *
 * @module @bc-agent/shared/constants/mention
 */

/**
 * Discriminator values for FileMention.type.
 * Determines how the backend resolves the mention into a search scope filter.
 */
export const MENTION_TYPE = {
  /** Individual file — filter: search.in(fileId, ...) */
  FILE: 'file',
  /** Folder — filter: search.in(parentFolderId, ...) with recursive CTE expansion */
  FOLDER: 'folder',
  /** SharePoint site — filter: siteId eq '...' */
  SITE: 'site',
} as const;

export type MentionType = (typeof MENTION_TYPE)[keyof typeof MENTION_TYPE];

/**
 * Synthetic MIME types used internally to identify non-file mention targets.
 * These are NOT real MIME types — they are application-level markers used
 * for icon rendering, drag-drop, and mention type detection in the frontend.
 */
export const MENTION_MIME_TYPE = {
  /** SharePoint site mention — used in MentionAutocomplete, ChatInput, ScopeContextMenu */
  SITE: 'application/x-sharepoint-site',
  /** SharePoint library mention — frontend-only icon discriminator; backend treats as site scope */
  LIBRARY: 'application/x-sharepoint-library',
  /** Drag-drop data transfer format for file mentions between components */
  FILE_DRAG: 'application/x-file-mention',
} as const;
