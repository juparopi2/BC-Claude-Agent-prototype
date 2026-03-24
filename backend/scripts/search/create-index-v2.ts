/**
 * Create the file-chunks-index-v2 index in Azure AI Search.
 *
 * Usage:
 *   npx tsx scripts/search/create-index-v2.ts
 *   npx tsx scripts/search/create-index-v2.ts --dry-run
 */
import 'dotenv/config';
import { SearchIndexClient, AzureKeyCredential } from '@azure/search-documents';
import { indexSchemaV2, INDEX_NAME_V2 } from '../../src/services/search/schema-v2';

const dryRun = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const key = process.env.AZURE_SEARCH_KEY;

  if (!endpoint || !key) {
    console.error('❌ AZURE_SEARCH_ENDPOINT and AZURE_SEARCH_KEY are required');
    process.exit(1);
  }

  const indexClient = new SearchIndexClient(endpoint, new AzureKeyCredential(key));

  console.log(`\n📋 Index: ${INDEX_NAME_V2}`);
  console.log(`   Endpoint: ${endpoint}`);
  console.log(`   Fields: ${indexSchemaV2.fields.length}`);
  console.log(`   Vector profiles: ${indexSchemaV2.vectorSearch?.profiles?.length ?? 0}`);
  console.log(`   Semantic configs: ${indexSchemaV2.semanticSearch?.configurations?.length ?? 0}`);

  if (dryRun) {
    console.log('\n🔍 Dry run — no changes made');
    return;
  }

  try {
    const existing = await indexClient.getIndex(INDEX_NAME_V2);
    console.log(`\n⚠️  Index '${INDEX_NAME_V2}' already exists (${existing.fields.length} fields). Updating schema...`);
    await indexClient.createOrUpdateIndex(indexSchemaV2);
    console.log(`✅ Index '${INDEX_NAME_V2}' updated successfully.`);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'statusCode' in error && (error as { statusCode: number }).statusCode === 404) {
      console.log(`\n🆕 Index '${INDEX_NAME_V2}' not found. Creating...`);
      await indexClient.createIndex(indexSchemaV2);
      console.log(`✅ Index '${INDEX_NAME_V2}' created successfully.`);
    } else {
      console.error('❌ Error:', error);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
