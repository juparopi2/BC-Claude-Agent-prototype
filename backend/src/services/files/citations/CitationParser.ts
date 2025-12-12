/**
 * Citation Parser for Phase 5: Chat Integration with Files
 *
 * Parses file citations from Claude's response text.
 * Format: [filename.ext] where filename contains a dot (to distinguish from [1] references)
 *
 * The PromptBuilder instructs Claude to use this format when citing documents.
 */

import type { ParsedCitation, CitationParseResult } from './types';

export class CitationParser {
  /**
   * Regex pattern to match file citations.
   * Requires at least one dot to distinguish from numeric references like [1].
   * Captures content inside brackets that contains at least one dot.
   */
  private readonly CITATION_PATTERN = /\[([^\]]+\.[^\]]+)\]/g;

  /**
   * Parses citations from Claude's response text and matches them to known files.
   *
   * @param text - The response text from Claude
   * @param fileMap - Map of file names to file IDs (from context)
   * @returns Parse result with citations and matched file IDs
   *
   * @example
   * ```typescript
   * const parser = new CitationParser();
   * const fileMap = new Map([['report.pdf', 'file-uuid-1']]);
   * const result = parser.parseCitations('According to [report.pdf], the value is 100.', fileMap);
   * // result.citations[0].fileName === 'report.pdf'
   * // result.citations[0].fileId === 'file-uuid-1'
   * ```
   */
  parseCitations(text: string, fileMap: Map<string, string>): CitationParseResult {
    const citations: ParsedCitation[] = [];
    const matchedFileIds = new Set<string>();

    // Reset regex lastIndex to ensure fresh matching
    this.CITATION_PATTERN.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = this.CITATION_PATTERN.exec(text)) !== null) {
      const fullMatch = match[0];
      const fileName = match[1];

      if (!fullMatch || !fileName) {
        continue;
      }

      const fileId = fileMap.get(fileName) ?? null;

      citations.push({
        rawText: fullMatch,
        fileName,
        fileId,
        startIndex: match.index,
        endIndex: match.index + fullMatch.length,
      });

      if (fileId) {
        matchedFileIds.add(fileId);
      }
    }

    return {
      originalText: text,
      processedText: text, // Could transform citations to structured markers in future
      citations,
      matchedFileIds: Array.from(matchedFileIds),
    };
  }

  /**
   * Builds a file map from an array of files for use with parseCitations.
   *
   * @param files - Array of objects with fileName and fileId properties
   * @returns Map of file names to file IDs
   */
  buildFileMap(files: Array<{ fileName: string; fileId: string }>): Map<string, string> {
    const map = new Map<string, string>();
    for (const file of files) {
      map.set(file.fileName, file.fileId);
    }
    return map;
  }
}

// Singleton instance
let instance: CitationParser | null = null;

/**
 * Gets the singleton instance of CitationParser
 */
export function getCitationParser(): CitationParser {
  if (!instance) {
    instance = new CitationParser();
  }
  return instance;
}
