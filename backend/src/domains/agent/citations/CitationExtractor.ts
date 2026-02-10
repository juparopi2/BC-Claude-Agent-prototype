/**
 * Citation Extractor
 *
 * Extracts CitedFile[] from RAG tool results.
 * Stateless service following the domain pattern.
 *
 * @module domains/agent/citations/CitationExtractor
 */

import { createChildLogger } from '@/shared/utils/logger';
import { getFetchStrategy, type CitedFile, type CitationResult } from '@bc-agent/shared';
import { parseStructuredSearchResult } from '@/modules/agents/rag-knowledge/schemas';
import { CITATION_PRODUCING_TOOLS, type ICitationExtractor } from './types';

/**
 * Extracts citations from RAG tool results.
 *
 * This service parses structured JSON results from the search_knowledge_base tool
 * and converts them to CitedFile[] for frontend rendering.
 *
 * @example
 * ```typescript
 * const extractor = getCitationExtractor();
 *
 * if (extractor.producesCitations('search_knowledge_base')) {
 *   const citations = extractor.extract('search_knowledge_base', toolResult);
 *   ctx.citedSources.push(...citations);
 * }
 * ```
 */
export class CitationExtractor implements ICitationExtractor {
  private readonly logger = createChildLogger({ service: 'CitationExtractor' });

  /**
   * Check if a tool produces extractable citations.
   *
   * @param toolName - Name of the tool to check
   * @returns true if the tool is in CITATION_PRODUCING_TOOLS
   */
  producesCitations(toolName: string): boolean {
    return (CITATION_PRODUCING_TOOLS as readonly string[]).includes(toolName);
  }

  /**
   * Extract citations from a tool result JSON string.
   *
   * @param toolName - Name of the tool that produced the result
   * @param resultJson - JSON string containing the tool result
   * @returns Array of CitedFile objects (empty if extraction fails)
   */
  extract(toolName: string, resultJson: string): CitedFile[] {
    // Early exit if tool doesn't produce citations
    if (!this.producesCitations(toolName)) {
      return [];
    }

    // Early exit if result is empty or not a string
    if (!resultJson || typeof resultJson !== 'string') {
      this.logger.debug({ toolName }, 'Empty or invalid tool result');
      return [];
    }

    try {
      // Parse JSON first
      const parsed = JSON.parse(resultJson);

      // New format: CitationResult with _type discriminator (PRD-071)
      if (parsed && typeof parsed === 'object' && parsed._type === 'citation_result' && Array.isArray(parsed.documents)) {
        return this.extractFromCitationResult(parsed as CitationResult, toolName);
      }

      // Legacy format: StructuredSearchResult (backward compatibility)
      const parseResult = parseStructuredSearchResult(resultJson);

      if (!parseResult.success) {
        this.logger.warn(
          {
            toolName,
            errors: parseResult.error.issues.slice(0, 3),
          },
          'Tool result does not match structured schema - returning empty citations'
        );
        return [];
      }

      const { sources } = parseResult.data;

      if (!sources || sources.length === 0) {
        this.logger.debug({ toolName }, 'No sources found in search result');
        return [];
      }

      const citations: CitedFile[] = sources.map((source) => ({
        fileName: source.fileName,
        fileId: source.fileId,
        sourceType: source.sourceType,
        mimeType: source.mimeType,
        relevanceScore: source.relevanceScore,
        isImage: source.isImage,
        fetchStrategy: getFetchStrategy(source.sourceType),
      }));

      this.logger.debug(
        {
          toolName,
          citationCount: citations.length,
          fileNames: citations.map((c) => c.fileName),
        },
        'Successfully extracted citations from tool result (legacy format)'
      );

      return citations;
    } catch (error) {
      // Graceful degradation: if anything fails, return empty array
      const errorInfo =
        error instanceof Error
          ? { message: error.message, name: error.name }
          : { value: String(error) };

      this.logger.debug(
        {
          toolName,
          error: errorInfo,
        },
        'Failed to extract citations from tool result'
      );

      return [];
    }
  }

  /**
   * Extract citations from the new CitationResult format (PRD-071).
   */
  private extractFromCitationResult(result: CitationResult, toolName: string): CitedFile[] {
    if (!result.documents || result.documents.length === 0) {
      this.logger.debug({ toolName }, 'No documents in citation result');
      return [];
    }

    const citations: CitedFile[] = result.documents.map((doc) => ({
      fileName: doc.fileName,
      fileId: doc.fileId,
      sourceType: doc.sourceType,
      mimeType: doc.mimeType,
      relevanceScore: doc.documentRelevance,
      isImage: doc.isImage,
      fetchStrategy: getFetchStrategy(doc.sourceType),
    }));

    this.logger.debug(
      {
        toolName,
        citationCount: citations.length,
        fileNames: citations.map((c) => c.fileName),
      },
      'Successfully extracted citations from citation result format'
    );

    return citations;
  }
}

// ============================================================================
// Singleton Pattern
// ============================================================================

let instance: CitationExtractor | null = null;

/**
 * Get the singleton CitationExtractor instance.
 *
 * @returns The CitationExtractor singleton
 */
export function getCitationExtractor(): CitationExtractor {
  if (!instance) {
    instance = new CitationExtractor();
  }
  return instance;
}

/**
 * Reset the singleton instance (for testing).
 * @internal
 */
export function __resetCitationExtractor(): void {
  instance = null;
}
