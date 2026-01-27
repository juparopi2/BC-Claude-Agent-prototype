/**
 * Verify and Update AI Search Index Schema
 *
 * This script checks the current AI Search index schema and verifies/updates it
 * to include the fileStatus field for soft delete support.
 *
 * Usage: npx tsx scripts/verify-search-schema.ts [--update]
 *
 * Options:
 *   --update    Apply missing schema changes to the index
 */

import 'dotenv/config';
import { SearchIndexClient, AzureKeyCredential } from '@azure/search-documents';
import { indexSchema, INDEX_NAME } from '../src/services/search/schema';

// Load configuration from environment variables
const SEARCH_ENDPOINT = process.env.AZURE_SEARCH_ENDPOINT || '';
const SEARCH_KEY = process.env.AZURE_SEARCH_KEY || '';

interface FieldComparison {
  name: string;
  status: 'ok' | 'missing' | 'different';
  expected?: unknown;
  actual?: unknown;
}

async function main() {
  const shouldUpdate = process.argv.includes('--update');

  console.log('=== AI SEARCH SCHEMA VERIFICATION ===\n');
  console.log(`Index: ${INDEX_NAME}`);
  console.log(`Endpoint: ${SEARCH_ENDPOINT}`);
  console.log(`Mode: ${shouldUpdate ? 'UPDATE' : 'READ-ONLY (use --update to apply changes)'}\n`);

  if (!SEARCH_ENDPOINT || !SEARCH_KEY) {
    console.error('ERROR: AZURE_SEARCH_ENDPOINT and AZURE_SEARCH_KEY must be set');
    process.exit(1);
  }

  const indexClient = new SearchIndexClient(
    SEARCH_ENDPOINT,
    new AzureKeyCredential(SEARCH_KEY)
  );

  try {
    // Get current index schema
    console.log('Fetching current index schema...\n');
    const currentIndex = await indexClient.getIndex(INDEX_NAME);

    // Compare fields
    console.log('=== FIELD COMPARISON ===\n');
    const comparisons: FieldComparison[] = [];
    const expectedFields = indexSchema.fields;
    const currentFields = currentIndex.fields;

    // Create a map of current fields for easy lookup
    const currentFieldMap = new Map(currentFields.map((f) => [f.name, f]));

    // Check each expected field
    for (const expectedField of expectedFields) {
      const currentField = currentFieldMap.get(expectedField.name);

      if (!currentField) {
        comparisons.push({
          name: expectedField.name,
          status: 'missing',
          expected: {
            type: expectedField.type,
            filterable: expectedField.filterable,
          },
        });
      } else {
        // Check if key properties match
        const typeMatch = currentField.type === expectedField.type;
        const filterableMatch = currentField.filterable === expectedField.filterable;

        if (typeMatch && filterableMatch) {
          comparisons.push({
            name: expectedField.name,
            status: 'ok',
          });
        } else {
          comparisons.push({
            name: expectedField.name,
            status: 'different',
            expected: {
              type: expectedField.type,
              filterable: expectedField.filterable,
            },
            actual: {
              type: currentField.type,
              filterable: currentField.filterable,
            },
          });
        }
      }
    }

    // Print comparison results
    const okFields = comparisons.filter((c) => c.status === 'ok');
    const missingFields = comparisons.filter((c) => c.status === 'missing');
    const differentFields = comparisons.filter((c) => c.status === 'different');

    console.log(`Fields OK: ${okFields.length}`);
    okFields.forEach((c) => console.log(`  ✓ ${c.name}`));

    if (missingFields.length > 0) {
      console.log(`\nFields MISSING: ${missingFields.length}`);
      missingFields.forEach((c) => {
        console.log(`  ✗ ${c.name}`);
        console.log(`    Expected: ${JSON.stringify(c.expected)}`);
      });
    }

    if (differentFields.length > 0) {
      console.log(`\nFields DIFFERENT: ${differentFields.length}`);
      differentFields.forEach((c) => {
        console.log(`  ! ${c.name}`);
        console.log(`    Expected: ${JSON.stringify(c.expected)}`);
        console.log(`    Actual: ${JSON.stringify(c.actual)}`);
      });
    }

    // Check specifically for fileStatus field
    console.log('\n=== SOFT DELETE FIELD CHECK ===\n');
    const fileStatusField = currentFieldMap.get('fileStatus');
    if (fileStatusField) {
      console.log('✓ fileStatus field exists');
      console.log(`  Type: ${fileStatusField.type}`);
      console.log(`  Filterable: ${fileStatusField.filterable}`);
      console.log(`  Facetable: ${fileStatusField.facetable}`);
    } else {
      console.log('✗ fileStatus field is MISSING');
      console.log('  This field is required for soft delete filtering in RAG searches');
    }

    // Apply updates if requested
    if (shouldUpdate && missingFields.length > 0) {
      console.log('\n=== APPLYING UPDATES ===\n');

      // Azure AI Search supports adding new fields to an existing index
      // We need to merge the missing fields with the current schema
      const updatedFields = [...currentFields];

      for (const missing of missingFields) {
        const expectedField = expectedFields.find((f) => f.name === missing.name);
        if (expectedField) {
          console.log(`Adding field: ${missing.name}`);
          updatedFields.push(expectedField);
        }
      }

      // Update the index
      const updatedIndex = {
        ...currentIndex,
        fields: updatedFields,
      };

      await indexClient.createOrUpdateIndex(updatedIndex);
      console.log('\n✓ Index updated successfully');

      // Verify the update
      const verifyIndex = await indexClient.getIndex(INDEX_NAME);
      const verifyField = verifyIndex.fields.find((f) => f.name === 'fileStatus');
      if (verifyField) {
        console.log('✓ fileStatus field verified in updated index');
      }
    } else if (missingFields.length === 0) {
      console.log('\n✓ Schema is up to date, no changes needed');
    } else {
      console.log('\n⚠ Missing fields detected. Run with --update to apply changes.');
    }

    // Summary
    console.log('\n=== SUMMARY ===\n');
    console.log(`Total fields in schema: ${expectedFields.length}`);
    console.log(`Current fields in index: ${currentFields.length}`);
    console.log(`Fields OK: ${okFields.length}`);
    console.log(`Fields missing: ${missingFields.length}`);
    console.log(`Fields different: ${differentFields.length}`);

  } catch (error: unknown) {
    const err = error as Error & { statusCode?: number };
    console.error('ERROR:', err.message);
    if (err.statusCode === 404) {
      console.error(`Index '${INDEX_NAME}' not found. It may need to be created.`);
    }
    process.exit(1);
  }
}

main().catch(console.error);
