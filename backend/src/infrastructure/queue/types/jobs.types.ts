/**
 * Job Type Definitions
 *
 * Interfaces for all BullMQ job payloads.
 * Extracted from MessageQueue.ts for modularity.
 *
 * @module infrastructure/queue/types
 */

import type { EventType } from '@/services/events/EventStore';

/**
 * Message Persistence Job Data
 *
 * @description Contains all data needed to persist a message to the database.
 * Phase 1A adds token tracking fields (model, inputTokens, outputTokens).
 * Phase 1B uses Anthropic message IDs as primary key.
 */
export interface MessagePersistenceJob {
  sessionId: string;
  messageId: string;
  role: 'user' | 'assistant' | 'system';
  messageType: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'error';
  content: string;
  metadata?: Record<string, unknown>;
  /** Sequence number from EventStore */
  sequenceNumber?: number;
  /** Event ID from EventStore */
  eventId?: string;
  /** Tool use ID for correlating tool_use and tool_result */
  toolUseId?: string | null;
  /** Stop reason from Anthropic SDK */
  stopReason?: string | null;
  /** Model used for generation */
  model?: string;
  /** Input tokens consumed */
  inputTokens?: number;
  /** Output tokens generated */
  outputTokens?: number;
}

/**
 * Tool Execution Job Data
 */
export interface ToolExecutionJob {
  sessionId: string;
  toolUseId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  userId: string;
}

/**
 * Event Processing Job Data
 */
export interface EventProcessingJob {
  eventId: string;
  sessionId: string;
  eventType: EventType;
  data: Record<string, unknown>;
}

/**
 * Usage Aggregation Job Data
 *
 * Used by background workers for:
 * - Hourly/daily/monthly aggregation
 * - Monthly invoice generation
 * - Quota reset processing
 */
export interface UsageAggregationJob {
  type: 'hourly' | 'daily' | 'monthly' | 'monthly-invoices' | 'quota-reset';
  /** Optional: process specific user, or all users if omitted */
  userId?: string;
  /** ISO 8601 date string */
  periodStart?: string;
  /** Force re-aggregation even if already exists */
  force?: boolean;
}

/**
 * File Processing Job Data
 *
 * Used by background workers for document text extraction:
 * - PDF (Azure Document Intelligence with OCR)
 * - DOCX (mammoth.js)
 * - XLSX (xlsx library)
 * - Plain text (txt, csv, md)
 */
export interface FileProcessingJob {
  /** File ID from database */
  fileId: string;
  /** User ID for multi-tenant isolation */
  userId: string;
  /** Session ID for WebSocket events (optional) */
  sessionId?: string;
  /** MIME type to determine processor */
  mimeType: string;
  /** Azure Blob path for downloading */
  blobPath: string;
  /** Original filename for logging */
  fileName: string;
  /** Current retry attempt number (1-based) */
  attemptNumber?: number;
  /** Maximum retry attempts configured */
  maxAttempts?: number;
}

/**
 * Embedding Generation Job Data
 */
export interface EmbeddingGenerationJob {
  fileId: string;
  userId: string;
  /** Session ID for WebSocket events (optional) */
  sessionId?: string;
  chunks: Array<{
    id: string; // chunkId
    text: string;
    chunkIndex: number;
    tokenCount: number;
  }>;
}

/**
 * File Chunking Job Data
 *
 * Used by background workers to chunk extracted text and prepare for embedding:
 * - Read extracted_text from file
 * - Apply chunking strategy based on MIME type
 * - Insert chunks into file_chunks table
 * - Enqueue EmbeddingGenerationJob
 */
export interface FileChunkingJob {
  /** File ID from database */
  fileId: string;
  /** User ID for multi-tenant isolation */
  userId: string;
  /** Session ID for WebSocket events (optional) */
  sessionId?: string;
  /** MIME type to determine chunking strategy */
  mimeType: string;
}

/**
 * Citation Persistence Job Data
 *
 * Used by background workers to persist RAG citations to the database.
 * Fire-and-forget pattern: citations are persisted asynchronously after
 * the complete event is emitted to maintain chat flow performance.
 */
export interface CitationPersistenceJob {
  /** Message ID to associate citations with */
  messageId: string;
  /** Session ID for context */
  sessionId: string;
  /** Array of cited files from RAG tool results */
  citations: Array<{
    fileName: string;
    fileId: string | null;
    sourceType: string;
    mimeType: string;
    relevanceScore: number;
    isImage: boolean;
  }>;
}

/**
 * File Cleanup Job Data
 *
 * Used by scheduled background workers to clean up:
 * - Old failed files that exceeded retention period
 * - Orphaned chunks without parent files
 * - Orphaned search documents in Azure AI Search
 */
export interface FileCleanupJob {
  /** Type of cleanup operation */
  type: 'failed_files' | 'orphaned_chunks' | 'orphaned_search_docs' | 'daily_full';
  /** Optional user ID for targeted cleanup (omit for all users) */
  userId?: string;
  /** Retention days for failed files (default: 30) */
  failedFileRetentionDays?: number;
  /** Retention days for orphaned chunks (default: 7) */
  orphanedChunkRetentionDays?: number;
}

/**
 * Union type of all job data types
 *
 * Useful for generic job processing utilities.
 */
export type AnyJobData =
  | MessagePersistenceJob
  | ToolExecutionJob
  | EventProcessingJob
  | UsageAggregationJob
  | FileProcessingJob
  | EmbeddingGenerationJob
  | FileChunkingJob
  | CitationPersistenceJob
  | FileCleanupJob;
