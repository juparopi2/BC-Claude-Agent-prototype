import type { SourceType, FetchStrategy } from '@bc-agent/shared';

/**
 * Props for the CitationLink component
 */
export interface CitationLinkProps {
  /** The filename to display (e.g., "document.pdf") */
  fileName: string;
  /** File ID for opening the file, or null if unmatched/deleted */
  fileId: string | null;
  /** Callback when citation is clicked */
  onOpen?: (fileId: string) => void;
  /** Additional CSS classes */
  className?: string;
  /** Source type for icon selection (default: 'blob_storage') */
  sourceType?: SourceType;
  /** MIME type for better icon selection */
  mimeType?: string;
  /** Relevance score (0-1) for badge display */
  relevanceScore?: number;
  /** Whether file is deleted (tombstone) */
  isDeleted?: boolean;
}

/**
 * Parsed segment from citation parser
 */
export interface CitationSegment {
  /** Type of segment */
  type: 'text' | 'citation';
  /** Content (text or filename) */
  content: string;
  /** File ID if matched, null if not found */
  fileId?: string | null;
}

/**
 * File map type for matching citations to file IDs (legacy)
 */
export type CitationFileMap = Map<string, string>;

/**
 * Rich citation info with all metadata from RAG tool.
 * Used for enhanced UI rendering (badges, icons, carousel).
 */
export interface CitationInfo {
  /** File name as referenced in content */
  fileName: string;
  /** File ID (null for tombstone/deleted files) */
  fileId: string | null;
  /** Source type for icon selection */
  sourceType: SourceType;
  /** MIME type for file icon */
  mimeType: string;
  /** Relevance score from semantic search (0-1) */
  relevanceScore: number;
  /** Whether file is an image */
  isImage: boolean;
  /** Fetch strategy for previews */
  fetchStrategy: FetchStrategy;
  /** Derived: true if fileId is null (deleted file) */
  isDeleted: boolean;
}

/**
 * Map of fileName -> CitationInfo for rich citation lookup
 */
export type CitationInfoMap = Map<string, CitationInfo>;
