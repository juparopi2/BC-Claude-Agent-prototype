/**
 * Citation Types for Phase 5: Chat Integration with Files
 *
 * Defines types for parsing and tracking file citations in Claude's responses.
 */

/**
 * A parsed citation from Claude's response
 */
export interface ParsedCitation {
  /** The citation text as it appeared in response (e.g., "[report.pdf]") */
  rawText: string;

  /** The extracted file name/identifier */
  fileName: string;

  /** Matched file ID from context (null if not found) */
  fileId: string | null;

  /** Position in the response text (start index) */
  startIndex: number;

  /** Position in the response text (end index) */
  endIndex: number;
}

/**
 * Result of parsing citations from a response
 */
export interface CitationParseResult {
  /** Original response text */
  originalText: string;

  /** Response with citations replaced by structured markers */
  processedText: string;

  /** All parsed citations */
  citations: ParsedCitation[];

  /** File IDs that were successfully matched */
  matchedFileIds: string[];
}

/**
 * Usage type for file attachments in messages
 */
export type FileUsageType = 'direct' | 'citation' | 'semantic_match';

/**
 * Citation record for database persistence
 */
export interface CitationRecord {
  messageId: string;
  fileId: string;
  usageType: FileUsageType;
  relevanceScore: number | null;
}

/**
 * Result of recording attachments
 */
export interface AttachmentRecordResult {
  success: boolean;
  recordsCreated: number;
}

/**
 * Attachment info returned from database
 */
export interface MessageAttachmentInfo {
  fileId: string;
  usageType: FileUsageType;
  relevanceScore: number | null;
  createdAt: Date;
}
