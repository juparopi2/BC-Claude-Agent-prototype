/**
 * Backfill mimeType Field in Azure AI Search Index
 *
 * One-time migration script to populate the `mimeType` field for existing
 * documents in the Azure AI Search index. Uses merge-or-upload to update
 * only the mimeType field without re-generating embeddings.
 *
 * Prerequisites:
 * - The `mimeType` field must already exist in the index schema
 *   (deploy schema changes first via VectorSearchService.createOrUpdateIndex)
 * - Database must be accessible (reads file metadata from SQL)
 * - Azure AI Search must be accessible
 *
 * Usage:
 *   npx tsx backend/src/scripts/backfill-mimeType.ts
 *
 * @module scripts/backfill-mimeType
 */

import { SearchClient, AzureKeyCredential } from '@azure/search-documents';
import { prisma } from '../infrastructure/database/prisma';
import { INDEX_NAME } from '../services/search/schema';
import { createChildLogger } from '../shared/utils/logger';

const logger = createChildLogger({ service: 'BackfillMimeType' });

// Batch size for Azure AI Search upload operations
const BATCH_SIZE = 1000;

interface ChunkDocument {
  chunkId: string;
  fileId: string;
}

async function main(): Promise<void> {
  logger.info('Starting mimeType backfill migration');

  const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const apiKey = process.env.AZURE_SEARCH_API_KEY;

  if (!endpoint || !apiKey) {
    throw new Error('Missing AZURE_SEARCH_ENDPOINT or AZURE_SEARCH_API_KEY environment variables');
  }

  const searchClient = new SearchClient<Record<string, unknown>>(
    endpoint,
    INDEX_NAME,
    new AzureKeyCredential(apiKey)
  );

  // 1. Get all files with their mimeTypes from the database
  logger.info('Fetching file metadata from database...');
  const files = await prisma.files.findMany({
    select: {
      id: true,
      mime_type: true,
    },
  });

  const fileMimeTypeMap = new Map<string, string>();
  for (const file of files) {
    fileMimeTypeMap.set(file.id.toUpperCase(), file.mime_type);
  }

  logger.info({ fileCount: fileMimeTypeMap.size }, 'File metadata loaded');

  // 2. Query all chunks from the search index to get chunkId -> fileId mapping
  logger.info('Querying search index for existing documents...');

  const allChunks: ChunkDocument[] = [];
  let skip = 0;
  const pageSize = 5000;

  // Paginate through all documents in the index
  let hasMore = true;
  while (hasMore) {
    const results = await searchClient.search('*', {
      select: ['chunkId', 'fileId'] as never,
      top: pageSize,
      skip,
      queryType: 'full',
    });

    let count = 0;
    for await (const result of results.results) {
      const doc = result.document as unknown as ChunkDocument;
      allChunks.push({
        chunkId: doc.chunkId,
        fileId: doc.fileId,
      });
      count++;
    }

    logger.info({ skip, fetched: count, total: allChunks.length }, 'Fetched page of documents');

    if (count < pageSize) {
      hasMore = false;
    } else {
      skip += pageSize;
    }
  }

  logger.info({ totalChunks: allChunks.length }, 'All chunks fetched from index');

  // 3. Build partial update documents
  const updates: Array<Record<string, unknown>> = [];
  let skipped = 0;

  for (const chunk of allChunks) {
    const mimeType = fileMimeTypeMap.get(chunk.fileId.toUpperCase());
    if (mimeType) {
      updates.push({
        chunkId: chunk.chunkId,
        mimeType,
        '@search.action': 'merge',
      });
    } else {
      skipped++;
    }
  }

  logger.info(
    { updatesCount: updates.length, skipped },
    'Prepared update documents'
  );

  // 4. Upload in batches
  let uploaded = 0;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);

    try {
      const result = await searchClient.mergeOrUploadDocuments(batch);
      const succeeded = result.results.filter(r => r.succeeded).length;
      const failed = result.results.filter(r => !r.succeeded).length;
      uploaded += succeeded;

      logger.info(
        { batch: Math.floor(i / BATCH_SIZE) + 1, succeeded, failed, totalUploaded: uploaded },
        'Batch uploaded'
      );

      if (failed > 0) {
        const failures = result.results.filter(r => !r.succeeded);
        logger.warn(
          { failedKeys: failures.map(f => f.key).slice(0, 5) },
          'Some documents failed to update'
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message, batchStart: i }, 'Batch upload failed');
    }
  }

  logger.info(
    { totalUpdated: uploaded, totalChunks: allChunks.length, skipped },
    'mimeType backfill migration completed'
  );

  await prisma.$disconnect();
}

main().catch((error) => {
  logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Migration failed');
  process.exit(1);
});
