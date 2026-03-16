/**
 * File Mention Types
 *
 * Types for @mentions in chat input, supporting RAG context scoping.
 * The LLM decides how to use mentioned files (search scope + content blocks).
 *
 * @module @bc-agent/shared/types/file-mention
 */

/** A file/folder mention in the chat input */
export interface FileMention {
  /** File or folder ID (UUID, UPPERCASE) */
  fileId: string;
  /** Display name of the file/folder */
  name: string;
  /** Whether this is a folder (expands to descendants on backend) */
  isFolder: boolean;
  /** MIME type of the file (empty string for folders) */
  mimeType: string;
  /**
   * Mention target type (backward-compatible, defaults to 'file' when absent).
   * - 'file': a regular file
   * - 'folder': a folder
   * - 'site': a SharePoint site
   */
  type?: 'file' | 'folder' | 'site';
  /** SharePoint site ID (only present when type === 'site') */
  siteId?: string;
}
