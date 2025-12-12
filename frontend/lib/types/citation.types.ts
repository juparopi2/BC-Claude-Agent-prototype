/**
 * Props for the CitationLink component
 */
export interface CitationLinkProps {
  /** The filename to display (e.g., "document.pdf") */
  fileName: string;
  /** File ID for opening the file, or null if unmatched */
  fileId: string | null;
  /** Callback when citation is clicked */
  onOpen?: (fileId: string) => void;
  /** Additional CSS classes */
  className?: string;
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
 * File map type for matching citations to file IDs
 */
export type CitationFileMap = Map<string, string>;
