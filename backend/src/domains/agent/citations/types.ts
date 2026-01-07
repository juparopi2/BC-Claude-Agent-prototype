/**
 * Citation Domain Types
 *
 * Types for citation extraction and processing.
 *
 * @module domains/agent/citations/types
 */

import type { CitedFile } from '@bc-agent/shared';

/**
 * List of tool names that produce extractable citations.
 * Add new tools here as they are implemented.
 */
export const CITATION_PRODUCING_TOOLS = ['search_knowledge_base'] as const;

/**
 * Type for tools that produce citations.
 */
export type CitationProducingTool = (typeof CITATION_PRODUCING_TOOLS)[number];

/**
 * Result of citation extraction from a tool result.
 */
export interface CitationExtractionResult {
  /** Extracted citations */
  citations: CitedFile[];
  /** Name of the tool that produced the citations */
  toolName: string;
  /** ISO timestamp when extraction occurred */
  extractedAt: string;
  /** Whether extraction was successful */
  success: boolean;
  /** Error message if extraction failed */
  error?: string;
}

/**
 * Interface for CitationExtractor service.
 * Allows for dependency injection and testing.
 */
export interface ICitationExtractor {
  /**
   * Extract citations from a tool result JSON string.
   *
   * @param toolName - Name of the tool that produced the result
   * @param resultJson - JSON string containing the tool result
   * @returns Array of CitedFile objects (empty if extraction fails or tool doesn't produce citations)
   */
  extract(toolName: string, resultJson: string): CitedFile[];

  /**
   * Check if a tool produces extractable citations.
   *
   * @param toolName - Name of the tool to check
   * @returns true if the tool produces citations that can be extracted
   */
  producesCitations(toolName: string): boolean;
}
