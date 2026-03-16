/**
 * FileChunkRepository
 *
 * Prisma-based repository for file_chunks table CRUD.
 * Separates chunk operations from the main FileRepository to avoid bloat.
 *
 * @module services/files/repository
 */

import { randomUUID } from 'crypto';
import { createChildLogger } from '@/shared/utils/logger';
import { prisma as defaultPrisma } from '@/infrastructure/database/prisma';
import type { PrismaClient } from '@prisma/client';

const logger = createChildLogger({ service: 'FileChunkRepository' });

/** Batch size for createMany — safe under SQL Server's 2100-param limit */
const CREATE_BATCH_SIZE = 100;

// ============================================================================
// Types
// ============================================================================

export interface ChunkRecord {
  id: string;
  chunk_text: string;
  chunk_index: number;
  chunk_tokens: number;
}

export interface ChunkInsertInput {
  text: string;
  chunkIndex: number;
  tokenCount: number;
  metadata?: Record<string, unknown>;
}

export interface SearchDocumentIdUpdate {
  chunkId: string;
  searchDocumentId: string | null;
}

export interface IFileChunkRepository {
  findByFileId(fileId: string, userId: string): Promise<ChunkRecord[]>;
  createMany(fileId: string, userId: string, chunks: ChunkInsertInput[]): Promise<Array<{ id: string; text: string; chunkIndex: number; tokenCount: number }>>;
  updateSearchDocumentIds(updates: SearchDocumentIdUpdate[]): Promise<void>;
}

// ============================================================================
// Implementation
// ============================================================================

export class FileChunkRepository implements IFileChunkRepository {
  private readonly prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient ?? defaultPrisma;
  }

  /**
   * Find all chunks for a file, ordered by chunk_index.
   */
  async findByFileId(fileId: string, userId: string): Promise<ChunkRecord[]> {
    const chunks = await this.prisma.file_chunks.findMany({
      where: { file_id: fileId, user_id: userId },
      select: {
        id: true,
        chunk_text: true,
        chunk_index: true,
        chunk_tokens: true,
      },
      orderBy: { chunk_index: 'asc' },
    });

    return chunks;
  }

  /**
   * Insert chunks in batches of 100.
   * Generates UPPERCASE UUIDs and serializes metadata as JSON.
   */
  async createMany(
    fileId: string,
    userId: string,
    chunks: ChunkInsertInput[],
  ): Promise<Array<{ id: string; text: string; chunkIndex: number; tokenCount: number }>> {
    const records: Array<{ id: string; text: string; chunkIndex: number; tokenCount: number }> = [];

    for (let i = 0; i < chunks.length; i += CREATE_BATCH_SIZE) {
      const batch = chunks.slice(i, i + CREATE_BATCH_SIZE);
      const batchData = batch.map((chunk) => {
        const id = randomUUID().toUpperCase();
        records.push({
          id,
          text: chunk.text,
          chunkIndex: chunk.chunkIndex,
          tokenCount: chunk.tokenCount,
        });
        return {
          id,
          file_id: fileId,
          user_id: userId,
          chunk_index: chunk.chunkIndex,
          chunk_text: chunk.text,
          chunk_tokens: chunk.tokenCount,
          metadata: chunk.metadata ? JSON.stringify(chunk.metadata) : null,
        };
      });

      await this.prisma.file_chunks.createMany({ data: batchData });
    }

    logger.info({ fileId, insertedCount: records.length }, 'Inserted chunks into database');
    return records;
  }

  /**
   * Update search_document_id for each chunk individually.
   * Each chunk gets a different value, so updateMany doesn't apply.
   */
  async updateSearchDocumentIds(updates: SearchDocumentIdUpdate[]): Promise<void> {
    for (const { chunkId, searchDocumentId } of updates) {
      await this.prisma.file_chunks.update({
        where: { id: chunkId },
        data: { search_document_id: searchDocumentId },
      });
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: FileChunkRepository | null = null;

export function getFileChunkRepository(prismaClient?: PrismaClient): FileChunkRepository {
  if (!instance) {
    instance = new FileChunkRepository(prismaClient);
  }
  return instance;
}

/** Reset singleton (for testing) */
export function __resetFileChunkRepository(): void {
  instance = null;
}
