/**
 * Citation Result Zod Schemas (PRD-071)
 *
 * Defines the structure for rich citation results returned by the RAG agent.
 * Uses `_type: 'citation_result'` discriminator for the AgentResultRenderer framework.
 *
 * @module @bc-agent/shared/schemas/citation-result
 */

import { z } from 'zod';

// ============================================
// Source Type Schema (matches source.types.ts)
// ============================================

const CitationSourceTypeSchema = z.enum([
  'blob_storage',
  'chat_attachment',
  'sharepoint',
  'onedrive',
  'email',
  'web',
]);

// ============================================
// Sub-Schemas
// ============================================

/**
 * Schema for a single passage/excerpt from a cited document.
 */
export const CitationPassageSchema = z.object({
  /** Unique identifier for this passage */
  citationId: z.string().min(1),
  /** Text excerpt from the source document */
  excerpt: z.string().max(500),
  /** Relevance score for this passage (0-1) */
  relevanceScore: z.number().min(0).max(1),
  /** Page number in the original document (if available) */
  pageNumber: z.number().int().nonnegative().optional(),
  /** Start character offset in source (if available) */
  startOffset: z.number().int().nonnegative().optional(),
  /** End character offset in source (if available) */
  endOffset: z.number().int().nonnegative().optional(),
  /** Highlighted caption from Azure AI Search Semantic Ranker with <em> tags (PRD-203) */
  highlightedCaption: z.string().optional(),
});

/**
 * Schema for an extractive answer from Azure AI Search Semantic Ranker (PRD-203).
 * Extractive answers are direct answers to questions extracted from documents.
 */
export const ExtractiveAnswerSchema = z.object({
  /** Extracted answer text */
  text: z.string(),
  /** Relevance score (0-1) */
  score: z.number().min(0).max(1),
  /** Highlighted answer text with <em> tags */
  highlights: z.string().optional(),
  /** Chunk ID in the search index that contains the answer */
  sourceChunkId: z.string(),
  /** File ID that contains the answer (resolved from chunk) */
  sourceFileId: z.string().optional(),
});

/**
 * Schema for a single cited document with its passages.
 */
export const CitedDocumentSchema = z.object({
  /** File ID (null for external sources without tracked files) */
  fileId: z.string().nullable(),
  /** Display name of the file */
  fileName: z.string().min(1),
  /** MIME type of the document */
  mimeType: z.string().min(1),
  /** Source type for routing fetch requests */
  sourceType: CitationSourceTypeSchema,
  /** Whether this is an image file */
  isImage: z.boolean(),
  /** Overall document relevance score (0-1) */
  documentRelevance: z.number().min(0).max(1),
  /** Passages/excerpts from this document */
  passages: z.array(CitationPassageSchema).min(1).max(10),
});

/**
 * Schema for the complete citation result.
 * Top-level schema returned by the RAG tool for rich rendering.
 */
export const CitationResultSchema = z.object({
  /** Discriminator for AgentResultRenderer framework */
  _type: z.literal('citation_result'),
  /** Array of cited documents */
  documents: z.array(CitedDocumentSchema).min(1).max(20),
  /** Human-readable summary of search results */
  summary: z.string(),
  /** Total number of results found */
  totalResults: z.number().int().nonnegative(),
  /** Original search query */
  query: z.string(),
  /** File type category filter used (only present for filtered searches) */
  fileTypeCategory: z.enum(['images', 'documents', 'spreadsheets', 'code', 'presentations']).optional(),
  /** Extractive answers from Azure AI Search Semantic Ranker (PRD-203) */
  extractiveAnswers: z.array(ExtractiveAnswerSchema).optional(),
});

// ============================================
// Type Exports (inferred from schemas)
// ============================================

/** Type for a single passage from a cited document */
export type CitationPassage = z.infer<typeof CitationPassageSchema>;

/** Type for a single cited document */
export type CitedDocument = z.infer<typeof CitedDocumentSchema>;

/** Type for the complete citation result */
export type CitationResult = z.infer<typeof CitationResultSchema>;

/** Type for an extractive answer from Semantic Ranker (PRD-203) */
export type ExtractiveAnswer = z.infer<typeof ExtractiveAnswerSchema>;
