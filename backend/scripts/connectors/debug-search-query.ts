/**
 * debug-search-query.ts — Direct Azure AI Search query test
 */
import 'dotenv/config';
import { SearchClient, AzureKeyCredential } from '@azure/search-documents';

const client = new SearchClient(
  process.env.AZURE_SEARCH_ENDPOINT!,
  'file-chunks-index-v2',
  new AzureKeyCredential(process.env.AZURE_SEARCH_KEY!),
  { serviceVersion: '2025-08-01-preview' },
);

async function main() {
  const userId = '2DD10FBD-F1C1-4578-8B57-CB1B2421BE40';

  // 1. Simple wildcard search for images
  console.log('=== Test 1: Wildcard search for images ===');
  const r1 = await client.search('*', {
    filter: `userId eq '${userId}' and isImage eq true`,
    top: 3,
    select: ['chunkId', 'fileId', 'imageCaption', 'isImage'],
  });
  let c1 = 0;
  for await (const r of r1.results) {
    c1++;
    const doc = r.document as Record<string, unknown>;
    console.log(`  ${c1}. caption="${String(doc.imageCaption ?? '').substring(0, 50)}" score=${r.score}`);
  }
  console.log(`  Found: ${c1}\n`);

  // 2. Vector text search for "truck"
  console.log('=== Test 2: Vector text search for "truck" ===');
  try {
    const r2 = await client.search('truck', {
      filter: `userId eq '${userId}' and isImage eq true`,
      top: 3,
      select: ['chunkId', 'fileId', 'imageCaption', 'isImage'],
      vectorSearchOptions: {
        queries: [{
          kind: 'text' as const,
          text: 'truck',
          fields: ['embeddingVector'],
          kNearestNeighborsCount: 10,
          weight: 1.0,
        }],
      },
    });
    let c2 = 0;
    for await (const r of r2.results) {
      c2++;
      const doc = r.document as Record<string, unknown>;
      console.log(`  ${c2}. caption="${String(doc.imageCaption ?? '').substring(0, 50)}" score=${r.score}`);
    }
    console.log(`  Found: ${c2}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ERROR: ${msg.substring(0, 300)}`);
  }

  // 3. Vector text search for "red light" (the user's query)
  console.log('\n=== Test 3: Vector text search for "red light strip" ===');
  try {
    const r3 = await client.search('red light strip', {
      filter: `userId eq '${userId}' and isImage eq true`,
      top: 3,
      select: ['chunkId', 'fileId', 'imageCaption', 'isImage'],
      vectorSearchOptions: {
        queries: [{
          kind: 'text' as const,
          text: 'red light strip',
          fields: ['embeddingVector'],
          kNearestNeighborsCount: 10,
          weight: 1.0,
        }],
      },
    });
    let c3 = 0;
    for await (const r of r3.results) {
      c3++;
      const doc = r.document as Record<string, unknown>;
      console.log(`  ${c3}. caption="${String(doc.imageCaption ?? '').substring(0, 50)}" score=${r.score}`);
    }
    console.log(`  Found: ${c3}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ERROR: ${msg.substring(0, 300)}`);
  }

  // 4. No vector, just BM25 text search
  console.log('\n=== Test 4: BM25 only text search for "truck" (no vector) ===');
  try {
    const r4 = await client.search('truck', {
      filter: `userId eq '${userId}'`,
      top: 3,
      select: ['chunkId', 'fileId', 'content', 'isImage'],
    });
    let c4 = 0;
    for await (const r of r4.results) {
      c4++;
      const doc = r.document as Record<string, unknown>;
      console.log(`  ${c4}. content="${String(doc.content ?? '').substring(0, 50)}" isImage=${doc.isImage} score=${r.score}`);
    }
    console.log(`  Found: ${c4}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ERROR: ${msg.substring(0, 300)}`);
  }
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
