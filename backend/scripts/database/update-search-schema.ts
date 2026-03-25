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
import { createSearchIndexClient, INDEX_NAME } from '../_shared/azure';
import { hasFlag } from '../_shared/args';
import { indexSchema } from '../../src/services/search/schema';

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

  // 3b. Check vectorizer configuration
  const currentVectorizers = (currentIndex.vectorSearch as Record<string, unknown>)?.vectorizers as Array<Record<string, unknown>> | undefined;
  const schemaVectorizers = (indexSchema.vectorSearch as Record<string, unknown>)?.vectorizers as Array<Record<string, unknown>> | undefined;
  const needsVectorizerUpdate = JSON.stringify(currentVectorizers ?? []) !== JSON.stringify(schemaVectorizers ?? []);

  if (needsVectorizerUpdate) {
    console.log('Vectorizer configuration changed:');
    console.log(`  Current: ${currentVectorizers?.map(v => `${v.vectorizerName} (${v.kind})`).join(', ') || 'none'}`);
    console.log(`  Target:  ${schemaVectorizers?.map(v => `${v.vectorizerName} (${v.kind})`).join(', ') || 'none'}\n`);
  }

  if (missingFields.length === 0 && !needsVectorizerUpdate) {
    console.log('Schema is up-to-date — no missing fields, vectorizer unchanged.\n');

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
  if (missingFields.length > 0) {
    console.log(`Found ${missingFields.length} missing field(s):\n`);
  }
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

  const changes = [
    missingFields.length > 0 ? `${missingFields.length} field(s)` : '',
    needsVectorizerUpdate ? 'vectorizer config' : '',
  ].filter(Boolean).join(' + ');
  console.log(`Applying schema update (${changes})...`);

  // Use REST API directly because the @azure/search-documents SDK v12.2 does not
  // support 'aml' vectorizer kind (only 'azureOpenAI' and 'customWebApi').
  // Strategy: GET the current index definition in REST format, patch the vectorizers,
  // and PUT it back. This avoids SDK↔REST property name translation issues.
  const searchEndpoint = process.env.AZURE_SEARCH_ENDPOINT!;
  const searchKey = process.env.AZURE_SEARCH_KEY!;
  // AML vectorizer with Cohere-embed-v4 requires preview API version
  const apiVersion = '2025-05-01-Preview';
  const url = `${searchEndpoint}/indexes/${INDEX_NAME}?api-version=${apiVersion}&allowIndexDowntime=true`;

  // 1. GET current index in REST API native format
  const getRes = await fetch(url, {
    method: 'GET',
    headers: { 'api-key': searchKey, 'Accept': 'application/json' },
  });
  if (!getRes.ok) {
    throw new Error(`Failed to GET index: ${getRes.status} ${await getRes.text()}`);
  }
  const restIndex = await getRes.json() as Record<string, unknown>;

  // 2. Patch vectorizers and profile vectorizer linkage
  const vectorSearch = restIndex.vectorSearch as Record<string, unknown>;
  vectorSearch.vectorizers = [
    {
      name: 'cohere-vectorizer',
      kind: 'aml',
      amlParameters: {
        uri: process.env.COHERE_ENDPOINT,
        key: process.env.COHERE_API_KEY,
        modelName: 'Cohere-embed-v4',
      },
    },
  ];
  // Ensure the profile links to the vectorizer
  const profiles = vectorSearch.profiles as Array<Record<string, unknown>>;
  if (profiles?.[0]) {
    profiles[0].vectorizer = 'cohere-vectorizer';
  }

  // 3. Add missing fields (if any)
  if (missingFields.length > 0) {
    const restFields = restIndex.fields as Array<Record<string, unknown>>;
    for (const f of missingFields) {
      restFields.push(f as unknown as Record<string, unknown>);
    }
  }

  // 4. PUT the patched index back
  // Remove @odata properties that can't be sent back
  delete restIndex['@odata.context'];
  delete restIndex['@odata.etag'];

  const putRes = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'api-key': searchKey,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(restIndex),
  });

  if (!putRes.ok) {
    const body = await putRes.text();
    throw new Error(`REST API error ${putRes.status}: ${body}`);
  }

  console.log('Schema updated successfully via REST API.\n');

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
