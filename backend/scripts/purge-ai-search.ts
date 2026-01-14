/**
 * Purge AI Search documents one by one
 */

import 'dotenv/config';
import { SearchClient, SearchIndexClient, AzureKeyCredential } from '@azure/search-documents';

// Load configuration from environment variables
const SEARCH_ENDPOINT = process.env.AZURE_SEARCH_ENDPOINT || '';
const SEARCH_KEY = process.env.AZURE_SEARCH_KEY || '';
const SEARCH_INDEX = process.env.AZURE_SEARCH_INDEX_NAME || 'file-chunks-index';

async function main() {
  console.log('=== PURGING AI SEARCH DOCUMENTS ===\n');

  const searchClient = new SearchClient(
    SEARCH_ENDPOINT,
    SEARCH_INDEX,
    new AzureKeyCredential(SEARCH_KEY)
  );

  // Get all document IDs
  console.log('Fetching all documents...');
  const documents: { chunkId: string }[] = [];

  const searchResults = await searchClient.search('*', {
    select: ['chunkId'],
    top: 1000
  });

  for await (const result of searchResults.results) {
    const doc = result.document as any;
    if (doc.chunkId) {
      documents.push({ chunkId: doc.chunkId });
    }
  }

  console.log(`Found ${documents.length} documents to delete\n`);

  if (documents.length === 0) {
    console.log('No documents to delete');
    return;
  }

  // Delete using merge or upload batch API
  console.log('Deleting documents...');

  const batchSize = 100;
  let totalDeleted = 0;

  for (let i = 0; i < documents.length; i += batchSize) {
    const batch = documents.slice(i, i + batchSize);

    try {
      // Use deleteDocuments method which handles the action internally
      const result = await searchClient.deleteDocuments(batch);
      const succeeded = result.results.filter(r => r.succeeded).length;
      totalDeleted += succeeded;
      console.log(`Batch ${Math.floor(i/batchSize) + 1}: Deleted ${succeeded}/${batch.length}`);
    } catch (error: any) {
      console.error(`Batch ${Math.floor(i/batchSize) + 1} failed:`, error.message);
    }
  }

  console.log(`\nTotal deleted: ${totalDeleted}/${documents.length}`);

  // Verify
  console.log('\nVerifying...');
  const verifyResults = await searchClient.search('*', { top: 1 });
  let remaining = 0;
  for await (const _ of verifyResults.results) {
    remaining++;
  }
  console.log(`Remaining documents: ${remaining}`);
}

main().catch(console.error);
