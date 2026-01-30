/**
 * Direct Azure Blob Storage verification - bypasses all abstractions
 */
import 'dotenv/config';
import { BlobServiceClient } from '@azure/storage-blob';

const USER_ID = 'BCD5A31B-C560-40D5-972F-50E134A8389D';
const CONNECTION_STRING = process.env.STORAGE_CONNECTION_STRING || '';
const CONTAINER_NAME = process.env.STORAGE_CONTAINER_NAME || 'user-files';

async function main() {
  console.log('=== DIRECT BLOB STORAGE VERIFICATION ===\n');
  console.log('User ID:', USER_ID);
  console.log('Container:', CONTAINER_NAME);

  if (!CONNECTION_STRING) {
    console.error('STORAGE_CONNECTION_STRING not set');
    process.exit(1);
  }

  const blobServiceClient = BlobServiceClient.fromConnectionString(CONNECTION_STRING);
  const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

  // Check container exists
  const exists = await containerClient.exists();
  if (!exists) {
    console.error('Container does not exist!');
    process.exit(1);
  }
  console.log('Container exists: ✅\n');

  // List all blobs for this user
  const prefix = `users/${USER_ID}/files/`;
  console.log(`Listing blobs with prefix: ${prefix}\n`);

  const blobs: string[] = [];
  for await (const blob of containerClient.listBlobsFlat({ prefix })) {
    blobs.push(blob.name);
  }

  console.log(`--- Blobs Found: ${blobs.length} ---`);

  // Group by type
  const byExtension: Record<string, number> = {};
  for (const blob of blobs) {
    const ext = blob.split('.').pop()?.toLowerCase() || 'unknown';
    byExtension[ext] = (byExtension[ext] || 0) + 1;
  }

  console.log('\n--- By Extension ---');
  for (const [ext, count] of Object.entries(byExtension).sort((a, b) => b[1] - a[1])) {
    console.log(`  .${ext}: ${count}`);
  }

  // Show first 15 blobs
  console.log('\n--- Sample Blobs ---');
  for (const blob of blobs.slice(0, 15)) {
    const shortName = blob.replace(prefix, '');
    console.log(`  ${shortName.substring(0, 70)}`);
  }
  if (blobs.length > 15) {
    console.log(`  ... and ${blobs.length - 15} more`);
  }

  // Check for "pending-" prefixed blobs (incomplete uploads)
  const pendingBlobs = blobs.filter(b => b.includes('pending-'));
  if (pendingBlobs.length > 0) {
    console.log(`\n⚠️  Found ${pendingBlobs.length} blobs with 'pending-' prefix (possibly incomplete uploads)`);
    for (const b of pendingBlobs.slice(0, 5)) {
      console.log(`  ${b.replace(prefix, '')}`);
    }
  }

  console.log('\n✅ Blob verification complete');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
