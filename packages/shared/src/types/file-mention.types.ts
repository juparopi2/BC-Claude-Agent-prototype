/**
 * File Mention Types
 *
 * Types for @mentions in chat input, supporting RAG context scoping
 * and direct vision mode for KB images.
 *
 * @module @bc-agent/shared/types/file-mention
 */

/** Mode for how a mentioned file is used */
export type FileMentionMode = 'rag_context' | 'direct_vision';

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
  /** How this mention is used: RAG search scope or direct vision */
  mode: FileMentionMode;
}
