/**
 * Script to manually run the OrphanCleanupJob
 *
 * Usage: npx tsx scripts/run-orphan-cleanup.ts [--userId <id>]
 */

import { initDatabase, closeDatabase } from '../src/infrastructure/database/database';
import { getOrphanCleanupJob } from '../src/jobs/OrphanCleanupJob';

async function main() {
  // Initialize database connection
  console.log('📡 Connecting to database...');
  await initDatabase();
  console.log('✅ Database connected\n');
  console.log('🧹 Starting Orphan Cleanup Job...\n');

  const args = process.argv.slice(2);
  const userIdIndex = args.indexOf('--userId');
  const userId = userIdIndex !== -1 ? args[userIdIndex + 1] : undefined;

  const job = getOrphanCleanupJob();

  try {
    if (userId) {
      console.log(`Running cleanup for user: ${userId}\n`);
      const result = await job.cleanOrphansForUser(userId);
      console.log('\n📊 Results:');
      console.log(`  User ID: ${result.userId}`);
      console.log(`  Total Orphans Found: ${result.totalOrphans}`);
      console.log(`  Successfully Deleted: ${result.deletedOrphans}`);
      console.log(`  Failed Deletions: ${result.failedDeletions}`);
      console.log(`  Duration: ${result.durationMs}ms`);
      if (result.orphanFileIds.length > 0) {
        console.log(`  Orphan File IDs: ${result.orphanFileIds.join(', ')}`);
      }
      if (result.errors.length > 0) {
        console.log(`  Errors: ${result.errors.join(', ')}`);
      }
    } else {
      console.log('Running full cleanup for all users...\n');
      const summary = await job.runFullCleanup();
      console.log('\n📊 Summary:');
      console.log(`  Total Users Processed: ${summary.totalUsers}`);
      console.log(`  Total Orphans Found: ${summary.totalOrphans}`);
      console.log(`  Total Successfully Deleted: ${summary.totalDeleted}`);
      console.log(`  Total Failed: ${summary.totalFailed}`);
      console.log(`  Duration: ${summary.completedAt.getTime() - summary.startedAt.getTime()}ms`);

      if (summary.userResults.length > 0) {
        console.log('\n📁 Per-User Results:');
        for (const result of summary.userResults) {
          if (result.totalOrphans > 0) {
            console.log(`  - User ${result.userId}: ${result.deletedOrphans}/${result.totalOrphans} orphans cleaned`);
          }
        }
      }
    }

    console.log('\n✅ Orphan cleanup completed!');
    await closeDatabase();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Orphan cleanup failed:', error);
    await closeDatabase();
    process.exit(1);
  }
}

main();
