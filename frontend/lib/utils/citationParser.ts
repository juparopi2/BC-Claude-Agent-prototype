import type { CitationSegment, CitationFileMap } from '../types/citation.types';

/**
 * Regex to match file citations like [filename.ext]
 * Matches: [document.pdf], [data.xlsx], [image.png]
 * Does NOT match: [1], [text without extension], [link](url)
 */
export const CITATION_REGEX = /\[([^\]]+\.[a-zA-Z0-9]+)\]/g;

/**
 * Parse text and extract citation segments
 *
 * @param text - Text to parse
 * @param fileMap - Optional map of fileName -> fileId for matching
 * @returns Array of text and citation segments
 */
export function parseCitations(
  text: string,
  fileMap?: CitationFileMap
): CitationSegment[] {
  const segments: CitationSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset regex state
  CITATION_REGEX.lastIndex = 0;

  while ((match = CITATION_REGEX.exec(text)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        content: text.slice(lastIndex, match.index),
      });
    }

    // Add citation segment
    const fileName = match[1]!;
    segments.push({
      type: 'citation',
      content: fileName,
      fileId: fileMap?.get(fileName) ?? null,
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({
      type: 'text',
      content: text.slice(lastIndex),
    });
  }

  return segments;
}

/**
 * Check if text contains any citations
 */
export function hasCitations(text: string): boolean {
  CITATION_REGEX.lastIndex = 0;
  return CITATION_REGEX.test(text);
}
