/**
 * Emergency reset: restore ALL non-ready files for a user back to ready.
 * Only use after simulate-file-health-issues.ts left orphaned corruptions.
 */
import { createPrisma } from '../_shared/prisma';
import { getFlag } from '../_shared/args';

const prisma = createPrisma();
const userId = getFlag('--userId') ?? '2DD10FBD-F1C1-4578-8B57-CB1B2421BE40';

async function main() {
  // Find files with [SIMULATED] errors or stuck in non-ready state with suspicious error
  const corrupted = await prisma.files.findMany({
    where: {
      user_id: userId,
      deleted_at: null,
      OR: [
        { last_error: { contains: '[SIMULATED]' } },
        { pipeline_status: { in: ['failed'] }, pipeline_retry_count: { gte: 3 } },
        { pipeline_status: { in: ['extracting', 'chunking', 'embedding'] } },
      ],
    },
    select: { id: true, name: true, pipeline_status: true, last_error: true, blob_path: true },
  });

  // Also find files with mangled blob_path from blob_missing simulation
  const mangledBlob = await prisma.files.findMany({
    where: {
      user_id: userId,
      deleted_at: null,
      blob_path: { contains: '__MISSING__' },
    },
    select: { id: true, name: true, blob_path: true },
  });

  console.log(`Found ${corrupted.length} simulated-corrupted files, ${mangledBlob.length} mangled blob paths`);

  for (const f of corrupted) {
    await prisma.files.update({
      where: { id: f.id },
      data: {
        pipeline_status: 'ready',
        pipeline_retry_count: 0,
        last_error: null,
        updated_at: new Date(),
      },
    });
    console.log(`  [RESET] ${f.name} (${f.pipeline_status} → ready)`);
  }

  for (const f of mangledBlob) {
    const realPath = f.blob_path!.replace('__MISSING__', '');
    await prisma.files.update({
      where: { id: f.id },
      data: {
        pipeline_status: 'ready',
        pipeline_retry_count: 0,
        last_error: null,
        blob_path: realPath,
        updated_at: new Date(),
      },
    });
    console.log(`  [RESET+BLOB] ${f.name} (blob_path restored)`);
  }

  console.log('\nDone. Refresh browser.');
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });
