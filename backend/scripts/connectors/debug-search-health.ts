/**
 * debug-search-health.ts — Verify search index integrity
 *
 * Checks DB embeddings, file_chunks, and AI Search documents to identify
 * why the RAG agent can't find images or files.
 */
import 'dotenv/config';
import { createPrisma } from '../_shared/prisma';
import { createSearchClient } from '../_shared/azure';

const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

interface SearchDoc {
  chunkId: string;
  fileId: string;
  userId: string;
  content: string;
  isImage: boolean;
  fileStatus: string;
  imageCaption: string | null;
  mimeType: string | null;
}

async function main() {
  const prisma = createPrisma();
  const searchClient = createSearchClient<SearchDoc>();

  try {
    const userId = '2DD10FBD-F1C1-4578-8B57-CB1B2421BE40';
    console.log(`\n${BOLD}${CYAN}=== Search Health Diagnostic ===${RESET}`);
    console.log(`User: ${userId}\n`);

    // ── 1. DB file counts ──
    console.log(`${BOLD}── 1. DB File Counts ──${RESET}`);
    const allFiles = await prisma.files.findMany({
      where: { user_id: userId, is_folder: false, deletion_status: null, pipeline_status: 'ready' },
      select: { id: true, source_type: true, mime_type: true, name: true },
    });
    const images = allFiles.filter(f => f.mime_type?.startsWith('image/'));
    const texts = allFiles.filter(f => !f.mime_type?.startsWith('image/'));
    console.log(`  Ready files: ${allFiles.length} (${GREEN}${images.length} images${RESET}, ${texts.length} text/docs)`);

    // ── 2. Image embeddings ──
    console.log(`\n${BOLD}── 2. Image Embeddings (DB) ──${RESET}`);
    const imageIds = images.map(f => f.id);
    const embeddings = await prisma.image_embeddings.findMany({
      where: { file_id: { in: imageIds } },
      select: { file_id: true, model: true, dimensions: true, caption: true },
    });
    const embeddingMap = new Map(embeddings.map(e => [e.file_id, e]));
    const missingEmb = images.filter(f => !embeddingMap.has(f.id));
    console.log(`  With embeddings: ${GREEN}${embeddings.length}${RESET} / ${images.length}`);
    if (missingEmb.length > 0) {
      console.log(`  ${RED}Missing: ${missingEmb.length}${RESET}`);
      for (const f of missingEmb.slice(0, 3)) {
        console.log(`    - ${f.name} (${f.id.substring(0, 8)})`);
      }
    }
    if (embeddings.length > 0) {
      const sample = embeddings[0];
      console.log(`  Sample: model=${sample.model}, dims=${sample.dimensions}, caption=${sample.caption ? 'yes' : 'NO'}`);
    }

    // ── 3. File chunks for text files ──
    console.log(`\n${BOLD}── 3. File Chunks (DB) ──${RESET}`);
    const textIds = texts.map(f => f.id);
    const chunkCount = await prisma.file_chunks.count({
      where: { file_id: { in: textIds } },
    });
    console.log(`  Total chunks: ${chunkCount} for ${texts.length} text files`);

    // ── 4. AI Search documents ──
    console.log(`\n${BOLD}── 4. AI Search Index ──${RESET}`);
    if (!searchClient) {
      console.log(`  ${RED}Search client not available (AZURE_SEARCH_ENDPOINT not set)${RESET}`);
    } else {
      // Count all docs for user
      const allDocs = await searchClient.search('*', {
        filter: `userId eq '${userId}'`,
        select: ['chunkId', 'fileId', 'isImage', 'fileStatus', 'imageCaption', 'content', 'mimeType'] as (keyof SearchDoc)[],
        top: 1000,
      });

      let totalDocs = 0;
      let imageDocs = 0;
      let activeDocs = 0;
      let deletingDocs = 0;
      let withCaption = 0;
      let withoutCaption = 0;
      const uniqueFileIds = new Set<string>();
      const sampleImages: Array<{ chunkId: string; fileId: string; content: string; caption: string | null; status: string }> = [];

      for await (const result of allDocs.results) {
        totalDocs++;
        uniqueFileIds.add(result.document.fileId);
        if (result.document.fileStatus === 'active') activeDocs++;
        if (result.document.fileStatus === 'deleting') deletingDocs++;
        if (result.document.isImage) {
          imageDocs++;
          if (result.document.imageCaption) withCaption++;
          else withoutCaption++;
          if (sampleImages.length < 5) {
            sampleImages.push({
              chunkId: result.document.chunkId,
              fileId: result.document.fileId,
              content: result.document.content?.substring(0, 50) ?? '(null)',
              caption: result.document.imageCaption?.substring(0, 60) ?? null,
              status: result.document.fileStatus,
            });
          }
        }
      }

      console.log(`  Total docs: ${totalDocs} (unique files: ${uniqueFileIds.size})`);
      console.log(`  Active: ${GREEN}${activeDocs}${RESET}, Deleting: ${deletingDocs > 0 ? RED : DIM}${deletingDocs}${RESET}`);
      console.log(`  Image docs: ${imageDocs}, Text docs: ${totalDocs - imageDocs}`);
      console.log(`  Image captions: ${withCaption} with, ${withoutCaption > 0 ? YELLOW : DIM}${withoutCaption} without${RESET}`);

      if (sampleImages.length > 0) {
        console.log(`\n  ${BOLD}Sample image documents:${RESET}`);
        for (const img of sampleImages) {
          console.log(`    ${DIM}${img.chunkId.substring(0, 20)}${RESET}  status:${img.status}  content:"${img.content}"  caption:${img.caption ? `"${img.caption}"` : RED + 'NULL' + RESET}`);
        }
      }

      // ── 5. Cross-check: DB images vs Search ──
      console.log(`\n${BOLD}── 5. Cross-Check ──${RESET}`);
      let inSearchCount = 0;
      let notInSearchCount = 0;
      for (const img of images.slice(0, 20)) {
        const imgChunkId = `img_${img.id.toUpperCase()}`;
        const searchResult = await searchClient.search('*', {
          filter: `chunkId eq '${imgChunkId}'`,
          select: ['chunkId', 'isImage', 'fileStatus'] as (keyof SearchDoc)[],
          top: 1,
        });
        let found = false;
        for await (const r of searchResult.results) {
          found = true;
        }
        if (found) inSearchCount++;
        else {
          notInSearchCount++;
          if (notInSearchCount <= 3) {
            console.log(`  ${RED}NOT in search:${RESET} ${img.name} (${img.id.substring(0, 8)}, chunkId=${imgChunkId.substring(0, 20)})`);
          }
        }
      }
      console.log(`  Images in search: ${GREEN}${inSearchCount}${RESET} / ${Math.min(images.length, 20)} (sampled)`);
      if (notInSearchCount > 0) {
        console.log(`  ${RED}Missing from search: ${notInSearchCount}${RESET}`);
      }
    }

    // ── Summary ──
    console.log(`\n${BOLD}── Summary ──${RESET}`);
    console.log(`  DB ready files:        ${allFiles.length}`);
    console.log(`  DB images:             ${images.length}`);
    console.log(`  DB image embeddings:   ${embeddings.length}`);
    console.log(`  DB text file chunks:   ${chunkCount}`);

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
