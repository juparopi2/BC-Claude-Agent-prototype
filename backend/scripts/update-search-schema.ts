/**
 * Update Azure AI Search Index Schema
 *
 * Compares the current index fields against the canonical schema definition
 * in schema.ts and applies any missing fields via createOrUpdateIndex.
 *
 * This is safe to run multiple times (idempotent) — it only modifies the index
 * if new fields are detected.
 *
 * Usage:
 *   npx tsx scripts/update-search-schema.ts --dry-run    # Preview changes without applying
 *   npx tsx scripts/update-search-schema.ts              # Apply schema updates
 */

import 'dotenv/config';
import { createSearchIndexClient, INDEX_NAME } from './_shared/azure';
import { hasFlag } from './_shared/args';
import { indexSchema } from '../src/services/search/schema';

// ============================================================================
// Configuration
// ============================================================================

const DRY_RUN = hasFlag('--dry-run');

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('=== Azure AI Search — Schema Update ===\n');
  console.log(`Index:   ${INDEX_NAME}`);
  console.log(`Mode:    ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}\n`);

  // 1. Connect
  const indexClient = createSearchIndexClient();
  if (!indexClient) {
    console.error('ERROR: AZURE_SEARCH_ENDPOINT and AZURE_SEARCH_KEY must be set.');
    process.exit(1);
  }

  // 2. Fetch current index
  let currentIndex;
  try {
    currentIndex = await indexClient.getIndex(INDEX_NAME);
    console.log(`Current index has ${currentIndex.fields.length} fields.\n`);
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 404) {
      console.log(`Index "${INDEX_NAME}" does not exist. Creating from scratch...`);
      if (!DRY_RUN) {
        await indexClient.createIndex(indexSchema);
        console.log('Index created successfully with all fields.');
      } else {
        console.log('[DRY RUN] Would create index with all fields.');
      }
      return;
    }
    throw err;
  }

  // 3. Detect missing fields
  const existingFieldNames = new Set(currentIndex.fields.map(f => f.name));
  const schemaFields = indexSchema.fields;
  const missingFields = schemaFields.filter(f => !existingFieldNames.has(f.name));

  if (missingFields.length === 0) {
    console.log('Schema is up-to-date — no missing fields.\n');

    // Show existing fields for reference
    console.log('Existing fields:');
    for (const f of currentIndex.fields) {
      const meta = [
        f.type,
        f.filterable ? 'filterable' : '',
        f.searchable ? 'searchable' : '',
        f.sortable ? 'sortable' : '',
      ].filter(Boolean).join(', ');
      console.log(`  ${f.name.padEnd(20)} ${meta}`);
    }
    return;
  }

  // 4. Report what will change
  console.log(`Found ${missingFields.length} missing field(s):\n`);
  for (const f of missingFields) {
    const meta = [
      f.type,
      f.filterable ? 'filterable' : '',
      f.searchable ? 'searchable' : '',
      f.sortable ? 'sortable' : '',
    ].filter(Boolean).join(', ');
    console.log(`  + ${f.name.padEnd(20)} ${meta}`);
  }
  console.log();

  // 5. Apply
  if (DRY_RUN) {
    console.log('[DRY RUN] No changes applied. Remove --dry-run to apply.');
    return;
  }

  console.log('Applying schema update...');
  await indexClient.createOrUpdateIndex(indexSchema);
  console.log('Schema updated successfully.\n');

  // 6. Verify
  const updated = await indexClient.getIndex(INDEX_NAME);
  const newFieldNames = new Set(updated.fields.map(f => f.name));
  const verified = missingFields.every(f => newFieldNames.has(f.name));

  if (verified) {
    console.log(`Verified: all ${missingFields.length} new field(s) are present.`);
    console.log(`Total fields: ${updated.fields.length}`);
  } else {
    const stillMissing = missingFields.filter(f => !newFieldNames.has(f.name));
    console.error(`WARNING: ${stillMissing.length} field(s) still missing after update:`);
    for (const f of stillMissing) {
      console.error(`  - ${f.name}`);
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
