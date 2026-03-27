/**
 * audit-file-health.ts
 *
 * Comprehensive file health audit for MyWorkMate.
 * Cross-references Azure SQL, Blob Storage, and AI Search to determine
 * the health state of every file owned by a user (or all users).
 *
 * Usage:
 *   npx tsx scripts/storage/audit-file-health.ts --userId <ID>
 *   npx tsx scripts/storage/audit-file-health.ts --all
 *   npx tsx scripts/storage/audit-file-health.ts --userId <ID> --check-vectors
 *   npx tsx scripts/storage/audit-file-health.ts --userId <ID> --fix --confirm
 *   npx tsx scripts/storage/audit-file-health.ts --userId <ID> --json
 *   npx tsx scripts/storage/audit-file-health.ts --userId <ID> --env prod
 *   npx tsx scripts/storage/audit-file-health.ts --help
 *
 * Exit codes:
 *   0  -  Audit complete (no BROKEN files, or --strict not set)
 *   1  -  BROKEN files detected (when --strict is set), or fatal error
 */

import 'dotenv/config';
import { execSync } from 'child_process';
import { randomUUID } from 'node:crypto';
import { FlowProducer, type FlowJob } from 'bullmq';
import { createPrisma } from '../_shared/prisma';
import {
  createBlobContainerClient,
  createSearchClient,
} from '../_shared/azure';
import { getFlag, hasFlag } from '../_shared/args';

// ─── ANSI Colors ───────────────────────────────────────────────────────────────
const RED    = '\x1b[31m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const RESET  = '\x1b[0m';

// ─── Environment Config ────────────────────────────────────────────────────────
const ENV_CONFIG = {
  dev: {
    keyVault: 'kv-bcagent-dev',
    sqlServer: 'sqlsrv-bcagent-dev',
    resourceGroup: 'rg-BCAgentPrototype-data-dev',
    sqlDb: 'sqldb-bcagent-dev',
  },
  prod: {
    keyVault: 'kv-myworkmate-prod',
    sqlServer: 'sqlsrv-myworkmate-prod',
    resourceGroup: 'rg-myworkmate-data-prod',
    sqlDb: 'sqldb-myworkmate-prod',
  },
} as const;

// ─── Queue Constants (mirrors reprocess-files-for-v2.ts) ──────────────────────
const QUEUE_PREFIX = process.env.QUEUE_NAME_PREFIX || '';

const QUEUE_NAMES = {
  FILE_EXTRACT:           'file-extract',
  FILE_CHUNK:             'file-chunk',
  FILE_EMBED:             'file-embed',
  FILE_PIPELINE_COMPLETE: 'file-pipeline-complete',
} as const;

const DEFAULT_BACKOFF = {
  FILE_EXTRACT:           { type: 'exponential' as const, delay: 5000, attempts: 3 },
  FILE_CHUNK:             { type: 'exponential' as const, delay: 3000, attempts: 3 },
  FILE_EMBED:             { type: 'exponential' as const, delay: 3000, attempts: 3 },
  FILE_PIPELINE_COMPLETE: { type: 'exponential' as const, delay: 1000, attempts: 2 },
} as const;

// ─── Firewall Cleanup State ────────────────────────────────────────────────────
let firewallRuleName: string | null = null;
let firewallResourceGroup: string | null = null;
let firewallSqlServer: string | null = null;
let cleanupRan = false;

function cleanupFirewallRule(): void {
  if (cleanupRan || !firewallRuleName) return;
  cleanupRan = true;
  try {
    execSync(
      `az sql server firewall-rule delete` +
      ` --resource-group "${firewallResourceGroup}"` +
      ` --server "${firewallSqlServer}"` +
      ` --name "${firewallRuleName}"`,
      { encoding: 'utf-8', timeout: 30_000, stdio: 'pipe' },
    );
    console.error(`${DIM}Firewall rule "${firewallRuleName}" deleted.${RESET}`);
  } catch {
    // Best-effort cleanup
  }
}

process.on('exit', cleanupFirewallRule);
process.on('SIGINT', () => { cleanupFirewallRule(); process.exit(130); });
process.on('SIGTERM', () => { cleanupFirewallRule(); process.exit(143); });

// ─── Types ─────────────────────────────────────────────────────────────────────

type FileHealthStatus = 'HEALTHY' | 'DEGRADED' | 'BROKEN' | 'RECOVERABLE' | 'IN_PROGRESS' | 'ORPHANED';
type IssueSeverity = 'error' | 'warning' | 'info';

interface FileHealthIssue {
  check: string;
  severity: IssueSeverity;
  detail: string;
}

interface FileHealthRecord {
  fileId: string;
  fileName: string;
  userId: string;
  mimeType: string | null;
  sourceType: string | null;
  pipelineStatus: string;
  status: FileHealthStatus;
  issues: FileHealthIssue[];
  retryCount: number;
  lastError: string | null;
  blobPath: string | null;
  sizeBytes: bigint | null;
}

interface AuditSearchDoc {
  chunkId?: string;
  fileId?: string;
  content?: string;
  embeddingModel?: string;
  mimeType?: string;
  sourceType?: string;
  fileName?: string;
  isImage?: boolean;
  fileStatus?: string;
  chunkIndex?: number;
  embeddingVector?: number[];
}

interface SearchDocSummary {
  fileId: string;
  chunkCount: number;
  embeddingModel: string | null;
  hasVector: boolean;
}

interface ChunkRecord {
  id: string;
  file_id: string;
  chunk_index: number;
  search_document_id: string | null;
  chunk_tokens: number;
}

interface ImageEmbRecord {
  file_id: string;
  model: string | null;
  dimensions: number | null;
  caption: string | null;
}

interface ScopeRecord {
  id: string;
  sync_status: string;
  last_sync_error: string | null;
  subscription_id: string | null;
  subscription_expires_at: Date | null;
  scope_display_name: string | null;
  updated_at: Date | null;
}

interface FileRecord {
  id: string;
  name: string;
  blob_path: string | null;
  pipeline_status: string;
  mime_type: string | null;
  source_type: string;
  external_id: string | null;
  external_modified_at: Date | null;
  last_synced_at: Date | null;
  connection_scope_id: string | null;
  size_bytes: bigint;
  connection_id: string | null;
  pipeline_retry_count: number;
  updated_at: Date | null;
  last_error: string | null;
  created_at: Date | null;
}

interface PipelineStatusRow {
  pipeline_status: string;
  count: bigint;
}

interface UserAuditResult {
  userId: string;
  files: FileHealthRecord[];
  orphanBlobs: string[];
  orphanSearchFileIds: string[];
  totalSearchDocs: number;
  stuckDeletions: number;
  scopes: ScopeRecord[];
  byHealthStatus: Record<string, number>;
  byPipelineStatus: Record<string, number>;
}

interface AuditSummary {
  generatedAt: string;
  environment: string;
  totalFiles: number;
  byPipelineStatus: Record<string, number>;
  byHealthStatus: Record<string, number>;
  bySourceType: Record<string, number>;
  consistencyScore: number;
  topFailurePatterns: Array<{ pattern: string; count: number }>;
  recommendations: string[];
  syncHealth: {
    totalScopes: number;
    byStatus: Record<string, number>;
    stuckScopes: number;
    expiredSubscriptions: number;
    staleFiles: number;
  };
  orphans: { searchDocs: number; blobs: number };
  stuckDeletions: number;
}

// ─── Help ─────────────────────────────────────────────────────────────────────

function showHelp(): void {
  console.log(`
${BOLD}${CYAN}audit-file-health.ts${RESET}  -  Comprehensive file health audit

${BOLD}Usage:${RESET}
  npx tsx scripts/storage/audit-file-health.ts --userId <ID>
  npx tsx scripts/storage/audit-file-health.ts --all
  npx tsx scripts/storage/audit-file-health.ts --userId <ID> --env prod

${BOLD}Flags:${RESET}
  ${CYAN}--userId <ID>${RESET}     Single user audit (UUID, will be uppercased)
  ${CYAN}--all${RESET}             All users aggregate dashboard
  ${CYAN}--env dev|prod${RESET}    Environment (default: uses .env directly)
  ${CYAN}--check-vectors${RESET}   Deep vector validation (fetches 1536d embeddingVector)
  ${CYAN}--fix${RESET}             Preview recovery actions (dry-run)
  ${CYAN}--confirm${RESET}         Execute recovery when combined with --fix
  ${CYAN}--json${RESET}            Machine-readable JSON output to stdout
  ${CYAN}--strict${RESET}          Exit 1 if any BROKEN files found
  ${CYAN}--verbose${RESET}         Show all files including HEALTHY ones
  ${CYAN}--help${RESET}            Show this help

${BOLD}Health Statuses:${RESET}
  ${GREEN}HEALTHY${RESET}      File is indexed and all cross-system checks pass
  ${YELLOW}DEGRADED${RESET}     File has warnings (partial indexing, stale pipeline)
  ${YELLOW}IN_PROGRESS${RESET}  File is currently being processed
  ${CYAN}RECOVERABLE${RESET}  File failed but can be re-queued automatically
  ${RED}BROKEN${RESET}       File has unrecoverable errors (missing blob, exhausted retries)
  ${DIM}ORPHANED${RESET}     File data found in search/blob with no DB record

${BOLD}Examples:${RESET}
  # Basic audit
  npx tsx scripts/storage/audit-file-health.ts --userId ABC123

  # Deep audit with vector check
  npx tsx scripts/storage/audit-file-health.ts --userId ABC123 --check-vectors

  # Preview recovery actions for broken files
  npx tsx scripts/storage/audit-file-health.ts --userId ABC123 --fix

  # Execute recovery
  npx tsx scripts/storage/audit-file-health.ts --userId ABC123 --fix --confirm

  # CI gate (fails if any broken files)
  npx tsx scripts/storage/audit-file-health.ts --userId ABC123 --strict

  # Production audit
  npx tsx scripts/storage/audit-file-health.ts --all --env prod
`);
}

// ─── Azure CLI Helpers ─────────────────────────────────────────────────────────

function execAz(args: string): string {
  return execSync(`az ${args}`, { encoding: 'utf-8', timeout: 30_000 }).trim();
}

function parseSqlConnectionString(connStr: string): {
  server: string;
  database: string;
  user: string;
  password: string;
} {
  const get = (key: string): string => {
    const match = connStr.match(new RegExp(`${key}=([^;]+)`, 'i'));
    return match?.[1]?.trim() ?? '';
  };
  return {
    server:   get('Server').replace('tcp:', '').replace(',1433', ''),
    database: get('Initial Catalog'),
    user:     get('User ID'),
    password: get('Password'),
  };
}

// ─── Phase 0: Environment Setup ────────────────────────────────────────────────

async function setupEnvironment(targetEnv: 'dev' | 'prod'): Promise<void> {
  const cfg = ENV_CONFIG[targetEnv];
  console.error(`${DIM}Setting up environment: ${targetEnv}${RESET}`);

  // Verify az CLI login
  try {
    execAz('account show');
  } catch {
    console.error(`${RED}Error: Not logged in to Azure CLI. Run: az login${RESET}`);
    process.exit(1);
  }

  // Fetch secrets from Key Vault
  console.error(`${DIM}Fetching secrets from ${cfg.keyVault}...${RESET}`);

  const fetchSecret = (name: string): string => {
    try {
      const result = execAz(`keyvault secret show --vault-name "${cfg.keyVault}" --name "${name}" --query value -o tsv`);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${RED}Failed to fetch secret "${name}" from Key Vault: ${msg}${RESET}`);
      process.exit(1);
    }
  };

  const sqlConnStr  = fetchSecret('SqlDb-ConnectionString');
  const storageConn = fetchSecret('Storage-ConnectionString');
  const searchEndpt = fetchSecret('AZURE-SEARCH-ENDPOINT');
  const searchKey   = fetchSecret('AZURE-SEARCH-KEY');

  // Parse SQL connection string and set env vars
  const { server, database, user, password } = parseSqlConnectionString(sqlConnStr);
  process.env.DATABASE_SERVER   = server;
  process.env.DATABASE_NAME     = database;
  process.env.DATABASE_USER     = user;
  process.env.DATABASE_PASSWORD = password;

  process.env.STORAGE_CONNECTION_STRING = storageConn;
  process.env.AZURE_SEARCH_ENDPOINT     = searchEndpt;
  process.env.AZURE_SEARCH_KEY          = searchKey;

  // Get Redis if --fix is requested (best-effort)
  if (hasFlag('--fix') && hasFlag('--confirm')) {
    try {
      const redisConn = fetchSecret('Redis-ConnectionString');
      process.env.REDIS_CONNECTION_STRING = redisConn;
    } catch {
      // Non-fatal  -  Redis only needed for --fix --confirm
    }
  }

  // Add temp firewall rule for SQL
  let publicIp: string;
  try {
    const resp = await fetch('https://api.ipify.org');
    publicIp = (await resp.text()).trim();
  } catch {
    console.error(`${RED}Failed to get public IP for firewall rule.${RESET}`);
    process.exit(1);
  }

  const ruleName = `audit-temp-${Date.now()}`;
  console.error(`${DIM}Creating SQL firewall rule for IP ${publicIp}...${RESET}`);

  try {
    execAz(
      `sql server firewall-rule create` +
      ` --resource-group "${cfg.resourceGroup}"` +
      ` --server "${cfg.sqlServer}"` +
      ` --name "${ruleName}"` +
      ` --start-ip-address "${publicIp}"` +
      ` --end-ip-address "${publicIp}"`,
    );
    firewallRuleName    = ruleName;
    firewallResourceGroup = cfg.resourceGroup;
    firewallSqlServer   = cfg.sqlServer;
    console.error(`${DIM}Firewall rule "${ruleName}" created.${RESET}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${RED}Failed to create firewall rule: ${msg}${RESET}`);
    process.exit(1);
  }
}

// ─── Phase 1: Data Collection ──────────────────────────────────────────────────

interface UserData {
  files: FileRecord[];
  chunksByFileId: Map<string, ChunkRecord[]>;
  imageEmbsByFileId: Map<string, ImageEmbRecord>;
  scopeById: Map<string, ScopeRecord>;
  filesWithText: Set<string>;
  stuckDeletions: number;
  byPipelineStatus: Record<string, number>;
}

async function collectUserData(
  prisma: ReturnType<typeof createPrisma>,
  userId: string,
): Promise<UserData> {
  const [
    files,
    chunks,
    imageEmbs,
    scopes,
    stuckDeletions,
    pipelineDistRows,
    textFileRows,
  ] = await Promise.all([
    // 1. Files
    prisma.files.findMany({
      where: { user_id: userId, is_folder: false, deletion_status: null },
      select: {
        id:                    true,
        name:                  true,
        blob_path:             true,
        pipeline_status:       true,
        mime_type:             true,
        source_type:           true,
        external_id:           true,
        external_modified_at:  true,
        last_synced_at:        true,
        connection_scope_id:   true,
        size_bytes:            true,
        connection_id:         true,
        pipeline_retry_count:  true,
        updated_at:            true,
        last_error: true,
        created_at:            true,
      },
    }),
    // 2. Chunks
    prisma.file_chunks.findMany({
      where: { user_id: userId },
      select: {
        id:                 true,
        file_id:            true,
        chunk_index:        true,
        search_document_id: true,
        chunk_tokens:       true,
      },
    }),
    // 3. Image embeddings
    prisma.image_embeddings.findMany({
      where: { user_id: userId },
      select: {
        file_id:    true,
        model:      true,
        dimensions: true,
        caption:    true,
      },
    }),
    // 4. Connection scopes
    prisma.connection_scopes.findMany({
      where: { connections: { user_id: userId } },
      select: {
        id:                       true,
        sync_status:              true,
        last_sync_error:          true,
        subscription_id:          true,
        subscription_expires_at:  true,
        scope_display_name:       true,
        updated_at:               true,
      },
    }),
    // 5. Stuck deletions count
    prisma.files.count({
      where: { user_id: userId, deletion_status: { not: null } },
    }),
    // 6. Pipeline distribution
    prisma.$queryRaw<PipelineStatusRow[]>`
      SELECT pipeline_status, COUNT(*) as count
      FROM files
      WHERE user_id = ${userId}
        AND is_folder = 0
        AND deletion_status IS NULL
      GROUP BY pipeline_status
    `,
    // 7. Files with extracted text
    prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM files
      WHERE user_id = ${userId}
        AND extracted_text IS NOT NULL
        AND is_folder = 0
        AND deletion_status IS NULL
    `,
  ]);

  // Build Maps
  const chunksByFileId = new Map<string, ChunkRecord[]>();
  for (const chunk of chunks) {
    const fid = chunk.file_id.toUpperCase();
    const list = chunksByFileId.get(fid) ?? [];
    list.push(chunk as ChunkRecord);
    chunksByFileId.set(fid, list);
  }

  const imageEmbsByFileId = new Map<string, ImageEmbRecord>();
  for (const emb of imageEmbs) {
    imageEmbsByFileId.set(emb.file_id.toUpperCase(), emb as ImageEmbRecord);
  }

  const scopeById = new Map<string, ScopeRecord>();
  for (const scope of scopes) {
    scopeById.set(scope.id.toUpperCase(), scope as ScopeRecord);
  }

  const filesWithText = new Set<string>(
    textFileRows.map((r) => r.id.toUpperCase()),
  );

  const byPipelineStatus: Record<string, number> = {};
  for (const row of pipelineDistRows) {
    byPipelineStatus[row.pipeline_status] = Number(row.count);
  }

  return {
    files:            files as FileRecord[],
    chunksByFileId,
    imageEmbsByFileId,
    scopeById,
    filesWithText,
    stuckDeletions,
    byPipelineStatus,
  };
}

async function getAllUserIds(prisma: ReturnType<typeof createPrisma>): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ user_id: string }>>`
    SELECT DISTINCT user_id FROM files WHERE deletion_status IS NULL AND is_folder = 0
  `;
  return rows.map((r) => r.user_id.toUpperCase());
}

// ─── Phase 2a: Blob Verification ──────────────────────────────────────────────

async function verifyBlobs(
  containerClient: ReturnType<typeof createBlobContainerClient>,
  userId: string,
  files: FileRecord[],
): Promise<{ blobExistsMap: Map<string, boolean>; orphanBlobs: string[] }> {
  const blobExistsMap = new Map<string, boolean>();
  const orphanBlobs: string[] = [];

  if (!containerClient) {
    // No blob client  -  mark all blobs as unknown
    for (const f of files) {
      if (f.blob_path) blobExistsMap.set(f.id.toUpperCase(), false);
    }
    return { blobExistsMap, orphanBlobs };
  }

  // Build Set of known blob paths from DB
  const knownBlobPaths = new Set<string>();
  for (const f of files) {
    if (f.blob_path) knownBlobPaths.add(f.blob_path);
  }

  // List all blobs under users/<userId>/
  const prefix = `users/${userId}/`;
  const listedBlobNames = new Set<string>();

  try {
    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
      listedBlobNames.add(blob.name);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ${YELLOW}Warning: Failed to list blobs for user ${userId}: ${msg}${RESET}`);
  }

  // Cross-reference: files with blob_path vs listed blobs
  for (const f of files) {
    if (f.blob_path) {
      blobExistsMap.set(f.id.toUpperCase(), listedBlobNames.has(f.blob_path));
    }
  }

  // Orphan blobs: in storage but not referenced by any file
  for (const blobName of listedBlobNames) {
    if (!knownBlobPaths.has(blobName)) {
      orphanBlobs.push(blobName);
    }
  }

  return { blobExistsMap, orphanBlobs };
}

// ─── Phase 2b: Search Index Verification ──────────────────────────────────────

async function verifySearchIndex(
  searchClient: ReturnType<typeof createSearchClient<AuditSearchDoc>>,
  userId: string,
  checkVectors: boolean,
): Promise<{
  docsByFileId: Map<string, SearchDocSummary>;
  orphanSearchFileIds: string[];
  totalSearchDocs: number;
}> {
  const docsByFileId = new Map<string, SearchDocSummary>();
  const orphanSearchFileIds: string[] = [];
  let totalSearchDocs = 0;

  if (!searchClient) {
    return { docsByFileId, orphanSearchFileIds, totalSearchDocs };
  }

  const pageSize  = checkVectors ? 100 : 500;
  let skip        = 0;
  let hasMore     = true;
  const selectFields: string[] = [
    'chunkId', 'fileId', 'content', 'embeddingModel',
    'mimeType', 'sourceType', 'fileName', 'isImage', 'fileStatus', 'chunkIndex',
  ];
  if (checkVectors) selectFields.push('embeddingVector');

  try {
    while (hasMore) {
      const results = await searchClient.search('*', {
        filter:  `userId eq '${userId}'`,
        select:  selectFields,
        top:     pageSize,
        skip,
      } as Record<string, unknown>);

      let pageCount = 0;
      for await (const result of results.results) {
        const doc = result.document;
        const fileId = doc.fileId?.toUpperCase();
        if (!fileId) { pageCount++; continue; }

        const existing = docsByFileId.get(fileId);
        const hasVector = checkVectors
          ? (Array.isArray(doc.embeddingVector) && doc.embeddingVector.length > 0)
          : false;

        if (existing) {
          existing.chunkCount++;
          if (hasVector) existing.hasVector = true;
        } else {
          docsByFileId.set(fileId, {
            fileId,
            chunkCount:     1,
            embeddingModel: doc.embeddingModel ?? null,
            hasVector,
          });
        }

        pageCount++;
        totalSearchDocs++;
      }

      hasMore = pageCount === pageSize;
      skip   += pageCount;

      if (skip >= 100_000) hasMore = false;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ${YELLOW}Warning: Search query failed for user ${userId}: ${msg}${RESET}`);
  }

  return { docsByFileId, orphanSearchFileIds, totalSearchDocs };
}

// ─── Phase 3: Per-File Health Scoring ─────────────────────────────────────────

function classifyHealth(
  issues: FileHealthIssue[],
  pipelineStatus: string,
): FileHealthStatus {
  const errors   = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  if (pipelineStatus === 'failed') {
    // blob_missing only applies to local files — external files can always retry via Graph API
    const blobMissing    = errors.some((i) => i.check === 'blob_missing');
    const retryExhausted = errors.some((i) => i.check === 'retry_exhausted');
    return (blobMissing || retryExhausted) ? 'BROKEN' : 'RECOVERABLE';
  }

  const intermediateStates = ['queued', 'extracting', 'chunking', 'embedding'];
  if (intermediateStates.includes(pipelineStatus)) {
    if (errors.length > 0) return 'BROKEN';
    if (warnings.length > 0) return 'DEGRADED';
    return 'IN_PROGRESS';
  }

  if (errors.length > 0) return 'BROKEN';
  if (warnings.length > 0) return 'DEGRADED';
  return 'HEALTHY';
}

const THIRTY_MIN_MS = 30 * 60 * 1000;
const TEN_MIN_MS    = 10 * 60 * 1000;
const ONE_HOUR_MS   = 60 * 60 * 1000;

function scoreFileHealth(
  file: FileRecord,
  userId: string,
  chunks: ChunkRecord[],
  imageEmb: ImageEmbRecord | undefined,
  blobExists: boolean | undefined,
  searchSummary: SearchDocSummary | undefined,
  hasExtractedText: boolean,
  checkVectors: boolean,
): FileHealthRecord {
  const issues: FileHealthIssue[] = [];
  const now = Date.now();
  const updatedMs = file.updated_at ? new Date(file.updated_at).getTime() : 0;
  const ageMs = updatedMs > 0 ? now - updatedMs : Infinity;

  // ── Ready files: full cross-system checks ─────────────────────────────────
  if (file.pipeline_status === 'ready') {
    const isImage    = file.mime_type?.startsWith('image/') ?? false;
    const isExternal = file.source_type !== 'local';

    // Blob check — only LOCAL files need blob_path
    // External files (SharePoint/OneDrive) download content on-demand via Graph API
    if (!isExternal) {
      if (!file.blob_path) {
        issues.push({ check: 'no_blob_path', severity: 'error', detail: 'Local file has no blob_path recorded' });
      } else if (blobExists === false) {
        issues.push({ check: 'blob_missing', severity: 'error', detail: `Blob not found: ${file.blob_path}` });
      }
    }

    // External ID check — external files must have external_id
    if (isExternal && !file.external_id) {
      issues.push({ check: 'no_external_id', severity: 'warning', detail: 'External file has no external_id for Graph API' });
    }

    // Extracted text check (images have placeholder [Image: ...], not real text)
    if (!isImage && !hasExtractedText) {
      issues.push({ check: 'no_extracted_text', severity: 'warning', detail: 'File is ready but has no extracted text' });
    }

    // Chunk check — images use image_embeddings, NOT file_chunks (0 chunks is correct)
    if (!isImage) {
      if (chunks.length === 0) {
        issues.push({ check: 'no_chunks', severity: 'error', detail: 'Non-image file is ready but has no chunks in DB' });
      } else {
        const unlinkedChunks = chunks.filter((c) => !c.search_document_id);
        if (unlinkedChunks.length > 0) {
          issues.push({
            check:    'unlinked_chunks',
            severity: 'warning',
            detail:   `${unlinkedChunks.length}/${chunks.length} chunks have no search_document_id`,
          });
        }
      }
    }

    // Image embedding check — images MUST have an image_embedding record
    if (isImage && !imageEmb) {
      issues.push({ check: 'missing_image_embedding', severity: 'error', detail: 'Image file has no image_embedding record' });
    }

    // Search index check — all file types should be in AI Search when ready
    if (!searchSummary) {
      issues.push({ check: 'not_in_search', severity: 'error', detail: 'File is ready but has no documents in AI Search' });
    } else {
      // Chunk count consistency (text files only — images have 1 doc, 0 chunks)
      if (!isImage && chunks.length > 0 && searchSummary.chunkCount < chunks.length) {
        issues.push({
          check:    'search_chunk_mismatch',
          severity: 'warning',
          detail:   `Search has ${searchSummary.chunkCount} docs, DB has ${chunks.length} chunks`,
        });
      }
      // Vector coverage (only with --check-vectors)
      if (checkVectors && !searchSummary.hasVector) {
        issues.push({ check: 'missing_vectors', severity: 'warning', detail: 'Search documents have no embedding vectors' });
      }
    }

    // Stale sync check (for cloud files)
    if (isExternal && file.external_modified_at && file.last_synced_at) {
      const externalMs = new Date(file.external_modified_at).getTime();
      const syncedMs   = new Date(file.last_synced_at).getTime();
      if (externalMs > syncedMs) {
        issues.push({
          check:    'stale_content',
          severity: 'warning',
          detail:   'Remote file was modified after last sync  -  content may be outdated',
        });
      }
    }
  }

  // ── Failed files ───────────────────────────────────────────────────────────
  else if (file.pipeline_status === 'failed') {
    issues.push({
      check:    'pipeline_failed',
      severity: 'error',
      detail:   file.last_error ?? 'Pipeline failed (no error message recorded)',
    });

    // Blob check only for local files — external files download from Graph API
    if (file.source_type === 'local' && file.blob_path && blobExists === false) {
      issues.push({ check: 'blob_missing', severity: 'error', detail: `Blob not found: ${file.blob_path}` });
    }

    if (file.pipeline_retry_count >= 3) {
      issues.push({
        check:    'retry_exhausted',
        severity: 'error',
        detail:   `Retry count is ${file.pipeline_retry_count} (>= 3)  -  manual intervention required`,
      });
    } else {
      issues.push({
        check:    'retry_available',
        severity: 'info',
        detail:   `${file.pipeline_retry_count} retries used, can be re-queued`,
      });
    }

    if (chunks.length > 0) {
      issues.push({
        check:    'partial_chunks',
        severity: 'warning',
        detail:   `Failed file has ${chunks.length} leftover chunks in DB`,
      });
    }
    if (searchSummary) {
      issues.push({
        check:    'partial_search_docs',
        severity: 'warning',
        detail:   `Failed file has ${searchSummary.chunkCount} leftover docs in AI Search`,
      });
    }
  }

  // ── Intermediate pipeline states ───────────────────────────────────────────
  else if (['queued', 'extracting', 'chunking', 'embedding'].includes(file.pipeline_status)) {
    if (ageMs > THIRTY_MIN_MS) {
      issues.push({
        check:    'pipeline_stuck',
        severity: 'error',
        detail:   `Pipeline in '${file.pipeline_status}' for ${Math.round(ageMs / 60_000)} min (> 30 min threshold)`,
      });
    } else if (ageMs > TEN_MIN_MS) {
      issues.push({
        check:    'pipeline_stale',
        severity: 'warning',
        detail:   `Pipeline in '${file.pipeline_status}' for ${Math.round(ageMs / 60_000)} min (> 10 min)`,
      });
    } else {
      issues.push({
        check:    'pipeline_in_progress',
        severity: 'info',
        detail:   `Pipeline in '${file.pipeline_status}' (recently updated)`,
      });
    }

    // Blob check only for local files
    if (file.source_type === 'local' && file.blob_path && blobExists === false) {
      issues.push({ check: 'blob_missing', severity: 'error', detail: `Blob not found: ${file.blob_path}` });
    }

    if (file.pipeline_retry_count >= 2) {
      issues.push({
        check:    'high_retry_count',
        severity: 'warning',
        detail:   `Pipeline retry count is ${file.pipeline_retry_count}`,
      });
    }
  }

  // ── Early states ───────────────────────────────────────────────────────────
  else if (file.pipeline_status === 'registered') {
    const createdMs = file.created_at ? new Date(file.created_at).getTime() : 0;
    const createdAge = createdMs > 0 ? now - createdMs : Infinity;
    if (createdAge > TEN_MIN_MS) {
      issues.push({
        check:    'upload_incomplete',
        severity: 'warning',
        detail:   `File registered ${Math.round(createdAge / 60_000)} min ago but never uploaded`,
      });
    }
  }

  else if (file.pipeline_status === 'uploaded') {
    // Only local files need blob_path at upload stage
    if (file.source_type === 'local' && !file.blob_path) {
      issues.push({ check: 'no_blob_path', severity: 'error', detail: 'Local uploaded file has no blob_path' });
    }
    const createdMs = file.created_at ? new Date(file.created_at).getTime() : 0;
    const createdAge = createdMs > 0 ? now - createdMs : Infinity;
    if (createdAge > ONE_HOUR_MS) {
      issues.push({
        check:    'never_processed',
        severity: 'warning',
        detail:   `File uploaded ${Math.round(createdAge / 60_000)} min ago but never entered pipeline`,
      });
    }
  }

  const status = classifyHealth(issues, file.pipeline_status);

  return {
    fileId:         file.id.toUpperCase(),
    fileName:       file.name,
    userId,
    mimeType:       file.mime_type,
    sourceType:     file.source_type,
    pipelineStatus: file.pipeline_status,
    status,
    issues,
    retryCount:     file.pipeline_retry_count,
    lastError:      file.last_error,
    blobPath:       file.blob_path,
    sizeBytes:      file.size_bytes,
  };
}

// ─── Phase 4 Helpers ───────────────────────────────────────────────────────────

function generateRecommendations(
  files: FileHealthRecord[],
  orphanSearchCount: number,
  orphanBlobCount: number,
  stuckScopeCount: number,
  userId?: string,
): string[] {
  const recommendations: string[] = [];
  const userFlag = userId ? `--userId ${userId}` : '';

  const broken      = files.filter((f) => f.status === 'BROKEN');
  const recoverable = files.filter((f) => f.status === 'RECOVERABLE');
  const degraded    = files.filter((f) => f.status === 'DEGRADED');
  const inProgress  = files.filter((f) => f.status === 'IN_PROGRESS');

  if (recoverable.length > 0) {
    recommendations.push(
      `${recoverable.length} file(s) are RECOVERABLE  -  run: npx tsx scripts/storage/audit-file-health.ts ${userFlag} --fix --confirm`,
    );
  }

  if (broken.length > 0) {
    const blobMissing = broken.filter((f) => f.issues.some((i) => i.check === 'blob_missing'));
    if (blobMissing.length > 0) {
      recommendations.push(
        `${blobMissing.length} file(s) are BROKEN with missing blobs  -  these must be re-uploaded manually`,
      );
    }
    const retryExhausted = broken.filter((f) => f.issues.some((i) => i.check === 'retry_exhausted'));
    if (retryExhausted.length > 0) {
      recommendations.push(
        `${retryExhausted.length} file(s) exhausted retries  -  review errors and reset pipeline_retry_count before re-queuing`,
      );
    }
  }

  if (degraded.length > 0) {
    const missingSearch = degraded.filter((f) => f.issues.some((i) => i.check === 'not_in_search' || i.check === 'no_chunks'));
    if (missingSearch.length > 0) {
      recommendations.push(
        `${missingSearch.length} file(s) are DEGRADED with missing search docs  -  consider reprocessing: npx tsx scripts/operations/reprocess-files-for-v2.ts ${userFlag ? `--user-id ${userId}` : ''}`,
      );
    }
  }

  if (inProgress.length > 0) {
    const stuckPipeline = inProgress.filter((f) => f.issues.some((i) => i.check === 'pipeline_stuck'));
    if (stuckPipeline.length > 0) {
      recommendations.push(
        `${stuckPipeline.length} file(s) have stuck pipelines  -  check queue workers: npx tsx scripts/redis/queue-status.ts --verbose`,
      );
    }
  }

  if (orphanSearchCount > 0) {
    recommendations.push(
      `${orphanSearchCount} orphan file IDs in AI Search (no matching DB record)  -  run: npx tsx scripts/storage/fix-storage.ts ${userFlag} --dry-run`,
    );
  }

  if (orphanBlobCount > 0) {
    recommendations.push(
      `${orphanBlobCount} orphan blobs in storage  -  run: npx tsx scripts/storage/fix-storage.ts ${userFlag} --dry-run`,
    );
  }

  if (stuckScopeCount > 0) {
    recommendations.push(
      `${stuckScopeCount} sync scope(s) are stuck  -  run: npx tsx scripts/connectors/fix-stuck-scopes.ts ${userFlag} --fix`,
    );
  }

  if (recommendations.length === 0) {
    recommendations.push('All systems healthy  -  no action required.');
  }

  return recommendations;
}

function buildSummary(
  result: UserAuditResult,
  environment: string,
): AuditSummary {
  const bySourceType: Record<string, number> = {};
  const issueCounts: Record<string, number> = {};

  for (const f of result.files) {
    const st = f.sourceType ?? 'unknown';
    bySourceType[st] = (bySourceType[st] ?? 0) + 1;
    for (const issue of f.issues) {
      issueCounts[issue.check] = (issueCounts[issue.check] ?? 0) + 1;
    }
  }

  const topFailurePatterns = Object.entries(issueCounts)
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const healthyCount = result.byHealthStatus['HEALTHY'] ?? 0;
  const totalFiles   = result.files.length;
  const consistencyScore = totalFiles > 0
    ? Math.round((healthyCount / totalFiles) * 100)
    : 100;

  const scopeStatusByStatus: Record<string, number> = {};
  let stuckScopes       = 0;
  let expiredSubs       = 0;
  const now = new Date();

  for (const scope of result.scopes) {
    const s = scope.sync_status;
    scopeStatusByStatus[s] = (scopeStatusByStatus[s] ?? 0) + 1;
    if (s === 'syncing' && scope.updated_at) {
      const ageMs = Date.now() - new Date(scope.updated_at).getTime();
      if (ageMs > TEN_MIN_MS) stuckScopes++;
    }
    if (scope.subscription_expires_at && new Date(scope.subscription_expires_at) < now) {
      expiredSubs++;
    }
  }

  const staleFiles = result.files.filter((f) =>
    f.issues.some((i) => i.check === 'stale_content'),
  ).length;

  const orphanSearchFileIds = result.orphanSearchFileIds;
  const stuckScopeCount = stuckScopes;

  const recommendations = generateRecommendations(
    result.files,
    orphanSearchFileIds.length,
    result.orphanBlobs.length,
    stuckScopeCount,
    result.userId,
  );

  return {
    generatedAt:       new Date().toISOString(),
    environment,
    totalFiles,
    byPipelineStatus:  result.byPipelineStatus,
    byHealthStatus:    result.byHealthStatus,
    bySourceType,
    consistencyScore,
    topFailurePatterns,
    recommendations,
    syncHealth: {
      totalScopes:          result.scopes.length,
      byStatus:             scopeStatusByStatus,
      stuckScopes,
      expiredSubscriptions: expiredSubs,
      staleFiles,
    },
    orphans: {
      searchDocs: orphanSearchFileIds.length,
      blobs:      result.orphanBlobs.length,
    },
    stuckDeletions: result.stuckDeletions,
  };
}

// ─── Phase 4: Reporting ────────────────────────────────────────────────────────

function statusColor(status: FileHealthStatus): string {
  switch (status) {
    case 'HEALTHY':     return GREEN;
    case 'DEGRADED':    return YELLOW;
    case 'IN_PROGRESS': return CYAN;
    case 'RECOVERABLE': return CYAN;
    case 'BROKEN':      return RED;
    case 'ORPHANED':    return DIM;
  }
}

function severityColor(sev: IssueSeverity): string {
  switch (sev) {
    case 'error':   return RED;
    case 'warning': return YELLOW;
    case 'info':    return DIM;
  }
}

function printUserReport(result: UserAuditResult, verbose: boolean, environment: string): void {
  const summary = buildSummary(result, environment);

  console.log(`\n${BOLD}${CYAN}=== File Health Audit: ${result.userId} ===${RESET}`);
  console.log(`${DIM}Generated: ${summary.generatedAt}  Environment: ${summary.environment}${RESET}`);

  // ── Pipeline Status Distribution ─────────────────────────────────────────
  console.log(`\n${BOLD}--- Pipeline Status Distribution ---${RESET}`);
  const pipelineOrder = ['ready', 'embedding', 'chunking', 'extracting', 'queued', 'uploaded', 'registered', 'failed'];
  const allStatuses = [...new Set([...pipelineOrder, ...Object.keys(summary.byPipelineStatus)])];
  for (const status of allStatuses) {
    const count = summary.byPipelineStatus[status] ?? 0;
    if (count === 0) continue;
    const color = status === 'ready' ? GREEN : status === 'failed' ? RED : YELLOW;
    console.log(`${color}  ${status.padEnd(16)} ${String(count).padStart(5)}${RESET}`);
  }

  // ── Health Status Summary ────────────────────────────────────────────────
  console.log(`\n${BOLD}--- Health Status Summary ---${RESET}`);
  const healthOrder: FileHealthStatus[] = ['HEALTHY', 'IN_PROGRESS', 'RECOVERABLE', 'DEGRADED', 'BROKEN', 'ORPHANED'];
  for (const hs of healthOrder) {
    const count = summary.byHealthStatus[hs] ?? 0;
    if (count === 0) continue;
    console.log(`${statusColor(hs)}  ${hs.padEnd(16)} ${String(count).padStart(5)}${RESET}`);
  }
  console.log(`  ${BOLD}Consistency Score: ${summary.consistencyScore}%${RESET}`);

  // ── File Details ─────────────────────────────────────────────────────────
  const filesToShow = verbose
    ? result.files
    : result.files.filter((f) => f.status !== 'HEALTHY' && f.status !== 'IN_PROGRESS');

  if (filesToShow.length > 0) {
    const detailsHeader = verbose ? 'File Details' : 'File Details (problems only - use --verbose for all)';
    console.log(`\n${BOLD}--- ${detailsHeader} ---${RESET}`);
    for (const f of filesToShow) {
      const sc = statusColor(f.status);
      console.log(`\n  ${sc}[${f.status}]${RESET} ${BOLD}${f.fileName}${RESET}`);
      console.log(`  ${DIM}ID: ${f.fileId}  Pipeline: ${f.pipelineStatus}  Retries: ${f.retryCount}${RESET}`);
      if (f.mimeType) console.log(`  ${DIM}MIME: ${f.mimeType}  Source: ${f.sourceType ?? 'unknown'}${RESET}`);
      for (const issue of f.issues) {
        if (!verbose && issue.severity === 'info') continue;
        const ic = severityColor(issue.severity);
        console.log(`    ${ic}[${issue.severity.toUpperCase()}] ${issue.check}: ${issue.detail}${RESET}`);
      }
    }
  }

  // ── Orphans ──────────────────────────────────────────────────────────────
  if (summary.orphans.searchDocs > 0 || summary.orphans.blobs > 0) {
    console.log(`\n${BOLD}--- Orphans ---${RESET}`);
    if (summary.orphans.searchDocs > 0) {
      console.log(`  ${YELLOW}Search orphan file IDs: ${summary.orphans.searchDocs}${RESET}`);
      for (const id of result.orphanSearchFileIds.slice(0, 5)) {
        console.log(`    ${DIM}- ${id}${RESET}`);
      }
      if (result.orphanSearchFileIds.length > 5) {
        console.log(`    ${DIM}... and ${result.orphanSearchFileIds.length - 5} more${RESET}`);
      }
    }
    if (summary.orphans.blobs > 0) {
      console.log(`  ${YELLOW}Orphan blobs: ${summary.orphans.blobs}${RESET}`);
      for (const b of result.orphanBlobs.slice(0, 5)) {
        console.log(`    ${DIM}- ${b}${RESET}`);
      }
      if (result.orphanBlobs.length > 5) {
        console.log(`    ${DIM}... and ${result.orphanBlobs.length - 5} more${RESET}`);
      }
    }
  }

  // ── Sync Health ──────────────────────────────────────────────────────────
  if (result.scopes.length > 0) {
    console.log(`\n${BOLD}--- Sync Health ---${RESET}`);
    console.log(`  Scopes: ${result.scopes.length}`);
    for (const [s, count] of Object.entries(summary.syncHealth.byStatus)) {
      const color = s === 'synced' ? GREEN : s === 'error' ? RED : YELLOW;
      console.log(`  ${color}${s.padEnd(16)} ${String(count).padStart(4)}${RESET}`);
    }
    if (summary.syncHealth.stuckScopes > 0) {
      console.log(`  ${YELLOW}Stuck scopes (syncing > 10 min): ${summary.syncHealth.stuckScopes}${RESET}`);
    }
    if (summary.syncHealth.expiredSubscriptions > 0) {
      console.log(`  ${YELLOW}Expired subscriptions: ${summary.syncHealth.expiredSubscriptions}${RESET}`);
    }
    if (summary.syncHealth.staleFiles > 0) {
      console.log(`  ${YELLOW}Stale files (remote modified after sync): ${summary.syncHealth.staleFiles}${RESET}`);
    }
  }

  if (summary.stuckDeletions > 0) {
    console.log(`\n  ${YELLOW}Stuck deletions (deletion_status IS NOT NULL): ${summary.stuckDeletions}${RESET}`);
  }

  // ── Failure Patterns ─────────────────────────────────────────────────────
  if (summary.topFailurePatterns.length > 0) {
    const notablePatterms = summary.topFailurePatterns.filter((p) => p.count > 0);
    if (notablePatterms.length > 0) {
      console.log(`\n${BOLD}--- Top Issue Patterns ---${RESET}`);
      for (const p of notablePatterms) {
        console.log(`  ${YELLOW}${p.pattern.padEnd(28)} ${String(p.count).padStart(4)}${RESET}`);
      }
    }
  }

  // ── Recommendations ──────────────────────────────────────────────────────
  console.log(`\n${BOLD}--- Recommendations ---${RESET}`);
  for (const rec of summary.recommendations) {
    const color = rec.startsWith('All systems') ? GREEN : YELLOW;
    console.log(`  ${color}> ${rec}${RESET}`);
  }

  console.log('');
}

function printCompactLine(result: UserAuditResult): void {
  const broken     = result.byHealthStatus['BROKEN'] ?? 0;
  const recoverable = result.byHealthStatus['RECOVERABLE'] ?? 0;
  const degraded   = result.byHealthStatus['DEGRADED'] ?? 0;
  const healthy    = result.byHealthStatus['HEALTHY'] ?? 0;
  const total      = result.files.length;
  const color      = broken > 0 ? RED : (recoverable + degraded) > 0 ? YELLOW : GREEN;
  console.log(
    `${color}${result.userId}${RESET}  ` +
    `total=${total}  ` +
    `${GREEN}healthy=${healthy}${RESET}  ` +
    `${YELLOW}degraded=${degraded}  recoverable=${recoverable}${RESET}  ` +
    `${RED}broken=${broken}${RESET}`,
  );
}

// ─── Phase 5: Fix / Recovery ───────────────────────────────────────────────────

function prefixedQueueName(baseName: string): string {
  return QUEUE_PREFIX ? `${QUEUE_PREFIX}--${baseName}` : baseName;
}

function parseRedisConfig(): { host: string; port: number; password?: string; tls?: boolean } {
  const connStr = process.env.REDIS_CONNECTION_STRING;
  if (connStr) {
    const parts    = connStr.split(',');
    const hostPort = parts[0]?.trim() ?? '';
    const [host, portStr] = hostPort.includes(':')
      ? hostPort.split(':')
      : [hostPort, '6380'];
    const port = parseInt(portStr ?? '6380', 10);
    let password: string | undefined;
    for (const part of parts.slice(1)) {
      const trimmed = part.trim();
      if (trimmed.toLowerCase().startsWith('password=')) {
        password = trimmed.substring(9) || undefined;
        break;
      }
    }
    return { host: host ?? 'localhost', port, password, tls: port === 6380 };
  }
  return {
    host:     process.env.REDIS_HOST || 'localhost',
    port:     parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  };
}

function buildFileFlow(params: {
  fileId:   string;
  userId:   string;
  mimeType: string;
  blobPath: string;
  fileName: string;
}): FlowJob {
  const { fileId, userId, mimeType, blobPath, fileName } = params;
  const batchId = randomUUID().toUpperCase();

  return {
    name:      `pipeline-complete--${fileId}`,
    queueName: prefixedQueueName(QUEUE_NAMES.FILE_PIPELINE_COMPLETE),
    data:      { fileId, batchId, userId },
    opts: {
      jobId:    `pipeline-complete--${fileId}`,
      attempts: DEFAULT_BACKOFF.FILE_PIPELINE_COMPLETE.attempts,
      backoff:  { type: DEFAULT_BACKOFF.FILE_PIPELINE_COMPLETE.type, delay: DEFAULT_BACKOFF.FILE_PIPELINE_COMPLETE.delay },
    },
    children: [
      {
        name:      `embed--${fileId}`,
        queueName: prefixedQueueName(QUEUE_NAMES.FILE_EMBED),
        data:      { fileId, batchId, userId },
        opts: {
          jobId:    `embed--${fileId}`,
          attempts: DEFAULT_BACKOFF.FILE_EMBED.attempts,
          backoff:  { type: DEFAULT_BACKOFF.FILE_EMBED.type, delay: DEFAULT_BACKOFF.FILE_EMBED.delay },
        },
        children: [
          {
            name:      `chunk--${fileId}`,
            queueName: prefixedQueueName(QUEUE_NAMES.FILE_CHUNK),
            data:      { fileId, batchId, userId, mimeType },
            opts: {
              jobId:    `chunk--${fileId}`,
              attempts: DEFAULT_BACKOFF.FILE_CHUNK.attempts,
              backoff:  { type: DEFAULT_BACKOFF.FILE_CHUNK.type, delay: DEFAULT_BACKOFF.FILE_CHUNK.delay },
            },
            children: [
              {
                name:      `extract--${fileId}`,
                queueName: prefixedQueueName(QUEUE_NAMES.FILE_EXTRACT),
                data:      { fileId, batchId, userId, mimeType, blobPath, fileName },
                opts: {
                  jobId:    `extract--${fileId}`,
                  attempts: DEFAULT_BACKOFF.FILE_EXTRACT.attempts,
                  backoff:  { type: DEFAULT_BACKOFF.FILE_EXTRACT.type, delay: DEFAULT_BACKOFF.FILE_EXTRACT.delay },
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// BigInt cannot be serialized by JSON.stringify — coerce to number
function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? Number(value) : value;
}

async function handleFix(
  prisma:  ReturnType<typeof createPrisma>,
  result:  UserAuditResult,
  confirm: boolean,
): Promise<void> {
  const recoverableFiles = result.files.filter((f) => f.status === 'RECOVERABLE');
  const stuckFiles       = result.files.filter(
    (f) => f.issues.some((i) => i.check === 'pipeline_stuck'),
  );

  const candidates = [...recoverableFiles, ...stuckFiles];

  if (candidates.length === 0) {
    console.log(`\n${GREEN}No recoverable or stuck files found  -  nothing to fix.${RESET}`);
    return;
  }

  console.log(`\n${BOLD}--- Recovery Preview ---${RESET}`);
  console.log(`${YELLOW}${candidates.length} file(s) eligible for recovery:${RESET}`);

  for (const f of candidates.slice(0, 20)) {
    const reason = f.status === 'RECOVERABLE' ? 'RECOVERABLE (failed, retries available)' : 'STUCK (pipeline stale > 30 min)';
    console.log(`  ${DIM}- ${f.fileId} "${f.fileName}" [${reason}]${RESET}`);
  }
  if (candidates.length > 20) {
    console.log(`  ${DIM}... and ${candidates.length - 20} more${RESET}`);
  }

  if (!confirm) {
    console.log(`\n${YELLOW}Dry-run mode  -  pass --confirm to execute recovery.${RESET}`);
    console.log(`  Actions that would be taken:`);
    console.log(`  1. UPDATE pipeline_status='queued', pipeline_retry_count=0, last_error=NULL`);
    console.log(`  2. Enqueue BullMQ flow: extract -> chunk -> embed -> pipeline-complete`);
    return;
  }

  console.log(`\n${CYAN}Executing recovery...${RESET}`);

  // Connect Redis
  const redisConfig = parseRedisConfig();
  const flowProducer = new FlowProducer({
    connection: {
      host:                 redisConfig.host,
      port:                 redisConfig.port,
      password:             redisConfig.password,
      maxRetriesPerRequest: null,
      enableReadyCheck:     true,
      tls: redisConfig.tls ? { rejectUnauthorized: true } : undefined,
    },
  });

  try {
    const BATCH_SIZE = 50;
    let recovered = 0;
    let errors    = 0;

    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);

      // Update DB
      try {
        await prisma.files.updateMany({
          where: {
            id:              { in: batch.map((f) => f.fileId) },
            deletion_status: null,
          },
          data: {
            pipeline_status:       'queued',
            pipeline_retry_count:  0,
            last_error: null,
            updated_at:            new Date(),
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ${RED}DB update failed for batch ${i}: ${msg}${RESET}`);
        errors += batch.length;
        continue;
      }

      // Enqueue flows
      for (const f of batch) {
        try {
          // External files have no blob_path — workers use GraphApiContentProvider
          const flow = buildFileFlow({
            fileId:   f.fileId,
            userId:   f.userId,
            mimeType: f.mimeType ?? 'application/octet-stream',
            blobPath: f.blobPath ?? '',
            fileName: f.fileName,
          });
          await flowProducer.add(flow);
          recovered++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  ${RED}Flow enqueue failed for ${f.fileId}: ${msg}${RESET}`);
          errors++;
        }
      }

      if (i + BATCH_SIZE < candidates.length) {
        console.log(`  ${DIM}Batch ${Math.floor(i / BATCH_SIZE) + 1} done, waiting 2s...${RESET}`);
        await sleep(2000);
      }
    }

    console.log(`\n${GREEN}Recovery complete: ${recovered} file(s) re-queued, ${errors} error(s).${RESET}`);
    if (recovered > 0) {
      console.log(`${DIM}Monitor progress: npx tsx scripts/redis/queue-status.ts --verbose${RESET}`);
    }
  } finally {
    try { await flowProducer.close(); } catch { /* ignore */ }
  }
}

// ─── Core Audit Function ───────────────────────────────────────────────────────

async function auditUser(
  prisma:        ReturnType<typeof createPrisma>,
  containerClient: ReturnType<typeof createBlobContainerClient>,
  searchClient:  ReturnType<typeof createSearchClient<AuditSearchDoc>>,
  userId:        string,
  opts:          { checkVectors: boolean; verbose: boolean },
): Promise<UserAuditResult> {
  // Phase 1: Collect DB data
  const data = await collectUserData(prisma, userId);

  // Phase 2a: Verify blobs
  const { blobExistsMap, orphanBlobs } = await verifyBlobs(containerClient, userId, data.files);

  // Phase 2b: Verify search index
  const { docsByFileId, orphanSearchFileIds, totalSearchDocs } = await verifySearchIndex(
    searchClient,
    userId,
    opts.checkVectors,
  );

  // Find orphan search file IDs (in search but not in DB)
  const dbFileIds = new Set(data.files.map((f) => f.id.toUpperCase()));
  for (const [fileId] of docsByFileId) {
    if (!dbFileIds.has(fileId)) {
      orphanSearchFileIds.push(fileId);
    }
  }

  // Phase 3: Score each file
  const healthRecords: FileHealthRecord[] = [];
  const byHealthStatus: Record<string, number> = {};

  for (const file of data.files) {
    const fileIdUp    = file.id.toUpperCase();
    const chunks      = data.chunksByFileId.get(fileIdUp) ?? [];
    const imageEmb    = data.imageEmbsByFileId.get(fileIdUp);
    const blobExists  = blobExistsMap.get(fileIdUp);
    const searchSummary = docsByFileId.get(fileIdUp);
    const hasText     = data.filesWithText.has(fileIdUp);

    const record = scoreFileHealth(
      file,
      userId,
      chunks,
      imageEmb,
      blobExists,
      searchSummary,
      hasText,
      opts.checkVectors,
    );

    healthRecords.push(record);
    byHealthStatus[record.status] = (byHealthStatus[record.status] ?? 0) + 1;
  }

  return {
    userId,
    files:              healthRecords,
    orphanBlobs,
    orphanSearchFileIds,
    totalSearchDocs,
    stuckDeletions:     data.stuckDeletions,
    scopes:             Array.from(data.scopeById.values()),
    byHealthStatus,
    byPipelineStatus:   data.byPipelineStatus,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (hasFlag('--help')) { showHelp(); return; }

  const targetEnvRaw = getFlag('--env') as 'dev' | 'prod' | null;
  const userId       = getFlag('--userId')?.toUpperCase();
  const allUsers     = hasFlag('--all');
  const checkVectors = hasFlag('--check-vectors');
  const fix          = hasFlag('--fix');
  const confirm      = hasFlag('--confirm');
  const jsonOutput   = hasFlag('--json');
  const strict       = hasFlag('--strict');
  const verbose      = hasFlag('--verbose');

  if (!userId && !allUsers) {
    console.error(`${RED}Error: --userId or --all required${RESET}`);
    console.error('Run with --help for usage.');
    process.exit(1);
  }

  // Phase 0: Environment setup (only when --env is explicitly passed)
  const environment = targetEnvRaw ?? 'dev';
  if (targetEnvRaw) {
    await setupEnvironment(targetEnvRaw);
  }

  // Create service clients
  const prisma          = createPrisma();
  const containerClient = createBlobContainerClient();
  const searchClient    = createSearchClient<AuditSearchDoc>();

  let hasBroken = false;

  try {
    if (allUsers) {
      // ── Aggregate mode ───────────────────────────────────────────────────
      if (!jsonOutput) {
        console.log(`${BOLD}${CYAN}=== File Health Audit  -  All Users ===${RESET}`);
        console.log(`${DIM}Fetching user list...${RESET}\n`);
      }

      const userIds = await getAllUserIds(prisma);

      if (userIds.length === 0) {
        console.log('No users with files found.');
        return;
      }

      const allResults: UserAuditResult[] = [];
      const globalByHealth: Record<string, number> = {};
      const globalByPipeline: Record<string, number> = {};
      let globalOrphanSearch = 0;
      let globalOrphanBlobs  = 0;
      let globalStuckDels    = 0;

      for (const uid of userIds) {
        const result = await auditUser(prisma, containerClient, searchClient, uid, { checkVectors, verbose: false });
        allResults.push(result);

        if (!jsonOutput) printCompactLine(result);

        for (const [k, v] of Object.entries(result.byHealthStatus)) {
          globalByHealth[k] = (globalByHealth[k] ?? 0) + v;
        }
        for (const [k, v] of Object.entries(result.byPipelineStatus)) {
          globalByPipeline[k] = (globalByPipeline[k] ?? 0) + v;
        }
        globalOrphanSearch += result.orphanSearchFileIds.length;
        globalOrphanBlobs  += result.orphanBlobs.length;
        globalStuckDels    += result.stuckDeletions;

        if ((result.byHealthStatus['BROKEN'] ?? 0) > 0) hasBroken = true;
      }

      if (jsonOutput) {
        const output = {
          generatedAt:     new Date().toISOString(),
          environment,
          users:           allResults.map((r) => ({
            userId:           r.userId,
            totalFiles:       r.files.length,
            byHealthStatus:   r.byHealthStatus,
            byPipelineStatus: r.byPipelineStatus,
            orphans:          { searchDocs: r.orphanSearchFileIds.length, blobs: r.orphanBlobs.length },
            stuckDeletions:   r.stuckDeletions,
          })),
          globalByHealth,
          globalByPipeline,
          orphans:         { searchDocs: globalOrphanSearch, blobs: globalOrphanBlobs },
          stuckDeletions:  globalStuckDels,
        };
        console.log(JSON.stringify(output, jsonReplacer, 2));
      } else {
        console.log(`\n${BOLD}--- Global Summary ---${RESET}`);
        console.log(`  Users audited: ${allResults.length}`);
        console.log(`  Total files:   ${Object.values(globalByHealth).reduce((a, b) => a + b, 0)}`);
        for (const [hs, count] of Object.entries(globalByHealth)) {
          const color = hs === 'HEALTHY' ? GREEN : hs === 'BROKEN' ? RED : YELLOW;
          console.log(`  ${color}${hs.padEnd(16)} ${String(count).padStart(5)}${RESET}`);
        }
        if (globalOrphanSearch > 0) console.log(`  ${YELLOW}Orphan search docs: ${globalOrphanSearch}${RESET}`);
        if (globalOrphanBlobs > 0)  console.log(`  ${YELLOW}Orphan blobs: ${globalOrphanBlobs}${RESET}`);
        if (globalStuckDels > 0)    console.log(`  ${YELLOW}Stuck deletions: ${globalStuckDels}${RESET}`);
      }
    } else {
      // ── Single user mode ─────────────────────────────────────────────────
      const result = await auditUser(prisma, containerClient, searchClient, userId!, { checkVectors, verbose });

      if (fix) {
        await handleFix(prisma, result, confirm);
      }

      if (jsonOutput) {
        const summary = buildSummary(result, environment);
        console.log(JSON.stringify({
          ...summary,
          files: result.files,
          orphanBlobs:       result.orphanBlobs,
          orphanSearchFileIds: result.orphanSearchFileIds,
        }, jsonReplacer, 2));
      } else {
        printUserReport(result, verbose, environment);
      }

      hasBroken = (result.byHealthStatus['BROKEN'] ?? 0) > 0;
    }
  } finally {
    await prisma.$disconnect().catch(() => { /* ignore */ });
    cleanupFirewallRule();
  }

  if (strict && hasBroken) {
    console.error(`\n${RED}--strict: BROKEN files detected. Exiting with code 1.${RESET}`);
    process.exit(1);
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`${RED}Fatal error: ${msg}${RESET}`);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  cleanupFirewallRule();
  process.exit(1);
});
