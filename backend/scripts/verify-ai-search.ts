/**
 * Verify AI Search documents for a specific user
 * Usage: npx ts-node -r tsconfig-paths/register scripts/verify-ai-search.ts [userId]
 */

import 'dotenv/config';
import { SearchClient, AzureKeyCredential } from '@azure/search-documents';

// Load configuration from environment variables
const SEARCH_ENDPOINT = process.env.AZURE_SEARCH_ENDPOINT || '';
const SEARCH_KEY = process.env.AZURE_SEARCH_KEY || '';
const SEARCH_INDEX = process.env.AZURE_SEARCH_INDEX_NAME || 'file-chunks-index';

interface SearchDocument {
  chunkId: string;
  fileId: string;
  userId: string;
  fileName?: string;
  chunkIndex?: number;
  content?: string;
  [key: string]: unknown; // Allow additional fields
}

async function main() {
  const userId = process.argv[2] || 'BCD5A31B-C560-40D5-972F-50E134A8389D';

  console.log('=== VERIFYING AI SEARCH DOCUMENTS ===\n');
  console.log(`User ID: ${userId}`);
  console.log(`Index: ${SEARCH_INDEX}`);
  console.log(`Endpoint: ${SEARCH_ENDPOINT}\n`);

  if (!SEARCH_ENDPOINT || !SEARCH_KEY) {
    console.error('ERROR: AZURE_SEARCH_ENDPOINT and AZURE_SEARCH_KEY must be set');
    process.exit(1);
  }

  const searchClient = new SearchClient<SearchDocument>(
    SEARCH_ENDPOINT,
    SEARCH_INDEX,
    new AzureKeyCredential(SEARCH_KEY)
  );

  // Search for documents by userId
  console.log('Searching for documents...\n');

  try {
    // First, get all available fields by searching without select
    const searchResults = await searchClient.search('*', {
      filter: `userId eq '${userId}'`,
      top: 100
    });

    const documents: SearchDocument[] = [];
    for await (const result of searchResults.results) {
      documents.push(result.document);
    }

    console.log(`Found ${documents.length} documents for user\n`);

    // Print schema of first document
    if (documents.length > 0) {
      const firstDoc = documents[0]!;
      console.log('=== DOCUMENT SCHEMA ===');
      console.log('Fields found:', Object.keys(firstDoc).join(', '));
      console.log('');
    }

    if (documents.length === 0) {
      console.log('No documents found. Possible issues:');
      console.log('  1. Files not processed yet');
      console.log('  2. userId case mismatch (should be UPPERCASE)');
      console.log('  3. Embedding indexing failed');

      // Try searching without filter to see what exists
      console.log('\n--- Checking all documents in index ---');
      const allResults = await searchClient.search('*', {
        select: ['chunkId', 'fileId', 'userId'],
        top: 10
      });

      let count = 0;
      const uniqueUserIds = new Set<string>();
      for await (const result of allResults.results) {
        count++;
        uniqueUserIds.add(result.document.userId);
      }
      console.log(`Total documents in index (sample): ${count}`);
      console.log(`Unique userIds found: ${Array.from(uniqueUserIds).join(', ')}`);

      return;
    }

    // Group by fileId
    const byFile: Record<string, SearchDocument[]> = {};
    for (const doc of documents) {
      if (!byFile[doc.fileId]) {
        byFile[doc.fileId] = [];
      }
      byFile[doc.fileId]!.push(doc);
    }

    console.log('=== DOCUMENTS BY FILE ===\n');
    for (const [fileId, docs] of Object.entries(byFile)) {
      const firstDoc = docs[0];
      if (!firstDoc) continue;
      // Try different field names for file name
      const fileName = (firstDoc.fileName || firstDoc['name'] || firstDoc['title'] || 'Unknown') as string;
      console.log(`File: ${fileName}`);
      console.log(`  ID: ${fileId}`);
      console.log(`  Chunks: ${docs.length}`);
      console.log(`  userId case: ${firstDoc.userId === firstDoc.userId.toUpperCase() ? 'UPPERCASE ✓' : 'MIXED/LOWER ✗'}`);
      console.log('');
    }

    // Case sensitivity analysis
    console.log('=== CASE SENSITIVITY ANALYSIS ===\n');
    const userIdCases = documents.map(d => ({
      userId: d.userId,
      isUpper: d.userId === d.userId.toUpperCase()
    }));

    const allUpper = userIdCases.every(c => c.isUpper);
    console.log(`All userIds UPPERCASE: ${allUpper ? 'YES ✓' : 'NO ✗'}`);

    if (!allUpper) {
      const mixedCases = userIdCases.filter(c => !c.isUpper);
      console.log(`Documents with non-UPPERCASE userId: ${mixedCases.length}`);
      mixedCases.slice(0, 5).forEach(c => console.log(`  - ${c.userId}`));
    }

  } catch (error: any) {
    console.error('Search failed:', error.message);
    if (error.statusCode === 400) {
      console.error('Possible filter syntax error or index schema mismatch');
    }
  }
}

main().catch(console.error);
