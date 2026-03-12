/**
 * FolderHierarchyResolver (PRD-107, PRD-112)
 *
 * Stateless utility module providing shared folder hierarchy resolution logic
 * for sync services. Extracted from InitialSyncService so that both
 * InitialSyncService and DeltaSyncService can share the same DB interaction
 * patterns for building and maintaining the external-to-internal folder ID map.
 *
 * Design:
 * - All exports are pure functions (no class, no singleton).
 * - Each function is side-effect-free except for DB writes and map mutations
 *   that are explicitly documented in the parameter/return contracts.
 * - The FolderIdMap is mutated in-place by ensureScopeRootFolder and
 *   upsertFolder so callers can maintain a single map across multiple calls.
 *
 * @module services/sync
 */

import { randomUUID } from 'crypto';
import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';
import { FILE_SOURCE_TYPE } from '@bc-agent/shared';
import type { DeltaChange } from '@bc-agent/shared';

const logger = createChildLogger({ service: 'FolderHierarchyResolver' });

// ============================================================================
// Types
// ============================================================================

/**
 * Maps a OneDrive external folder ID (Graph API item.id) to the corresponding
 * internal DB folder UUID (UPPERCASE).
 */
export type FolderIdMap = Map<string, string>;

// ============================================================================
// Parameters interfaces
// ============================================================================

export interface EnsureScopeRootParams {
  connectionId: string;
  scopeId: string;
  userId: string;
  scopeResourceId: string;
  scopeDisplayName: string | null;
  microsoftDriveId: string | null;
  folderMap: FolderIdMap;
  provider: string;
}

export interface UpsertFolderParams {
  item: DeltaChange['item'];
  connectionId: string;
  scopeId: string;
  userId: string;
  microsoftDriveId: string | null;
  folderMap: FolderIdMap;
  provider: string;
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Query all existing folders for the connection from the DB and return a map
 * of external_id → internal_id.
 *
 * Used to seed the FolderIdMap before processing any delta changes, so that
 * parent resolution works correctly even for folders that were synced in a
 * previous run.
 */
export async function buildFolderMap(connectionId: string): Promise<FolderIdMap> {
  const existingFolders = await prisma.files.findMany({
    where: {
      connection_id: connectionId,
      is_folder: true,
    },
    select: { id: true, external_id: true },
  });

  const map = new Map<string, string>();
  for (const ef of existingFolders) {
    if (ef.external_id) {
      map.set(ef.external_id, ef.id);
    }
  }
  return map;
}

/**
 * For folder-type scopes, ensure the scope root folder exists in the DB and
 * is present in the folderMap.
 *
 * The scope root folder is filtered from delta results by Microsoft Graph
 * (it IS the scope, not a child), so it must be explicitly seeded into the
 * files table and the map so that child folders can reference it as their
 * parent_folder_id.
 *
 * Mutates params.folderMap in-place when a record is found or created.
 *
 * - If already in map → skip (no DB read needed).
 * - If in DB but not map → add to map.
 * - If neither → create in DB + add to map.
 */
export async function ensureScopeRootFolder(params: EnsureScopeRootParams): Promise<void> {
  const {
    connectionId,
    scopeId,
    userId,
    scopeResourceId,
    scopeDisplayName,
    microsoftDriveId,
    folderMap,
    provider,
  } = params;

  if (folderMap.has(scopeResourceId)) {
    return;
  }

  const existingScopeFolder = await prisma.files.findFirst({
    where: { connection_id: connectionId, external_id: scopeResourceId },
    select: { id: true },
  });

  if (existingScopeFolder) {
    folderMap.set(scopeResourceId, existingScopeFolder.id);
    return;
  }

  const scopeFolderId = randomUUID().toUpperCase();
  try {
    await prisma.files.create({
      data: {
        id: scopeFolderId,
        user_id: userId,
        name: scopeDisplayName ?? (provider === 'sharepoint' ? 'SharePoint Folder' : 'OneDrive Folder'),
        mime_type: 'inode/directory',
        size_bytes: BigInt(0),
        blob_path: null,
        is_folder: true,
        source_type: provider === 'sharepoint' ? FILE_SOURCE_TYPE.SHAREPOINT : FILE_SOURCE_TYPE.ONEDRIVE,
        external_id: scopeResourceId,
        external_drive_id: microsoftDriveId,
        connection_id: connectionId,
        connection_scope_id: scopeId,
        external_url: null,
        external_modified_at: null,
        parent_folder_id: null,
        pipeline_status: 'ready',
        processing_retry_count: 0,
        embedding_retry_count: 0,
        is_favorite: false,
      },
    });
    folderMap.set(scopeResourceId, scopeFolderId);

    logger.info(
      { scopeId, scopeFolderId, name: scopeDisplayName },
      'Created scope root folder'
    );
  } catch (err) {
    // Race condition: concurrent sync already created this folder
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2002') {
      const existing = await prisma.files.findFirst({
        where: { connection_id: connectionId, external_id: scopeResourceId },
        select: { id: true },
      });
      if (existing) {
        folderMap.set(scopeResourceId, existing.id);
        logger.debug({ scopeId, scopeResourceId }, 'Scope root folder already exists (concurrent create race)');
        return;
      }
    }
    throw err;
  }
}

/**
 * Resolve the internal parent_folder_id from the external parentId using the
 * folderMap. Returns null when parentId is null or the external ID is not yet
 * in the map (i.e. the parent has not been processed yet or is out of scope).
 */
export function resolveParentFolderId(
  parentId: string | null,
  folderMap: FolderIdMap
): string | null {
  return parentId ? folderMap.get(parentId) ?? null : null;
}

/**
 * Sort an array of folder DeltaChanges by their parentPath depth so that
 * parent folders are always processed before their children.
 *
 * Folders with a null/undefined parentPath receive depth -1 and are sorted
 * first (they are root-level items relative to the scope).
 *
 * Returns a new array; the original is not mutated.
 */
export function sortFoldersByDepth(folderChanges: DeltaChange[]): DeltaChange[] {
  return [...folderChanges].sort((a, b) => {
    const pathA = a.item.parentPath;
    const pathB = b.item.parentPath;
    const depthA = pathA ? pathA.split('/').length : -1;
    const depthB = pathB ? pathB.split('/').length : -1;
    return depthA - depthB;
  });
}

/**
 * Create or update a folder record in the DB and update the folderMap with
 * the external_id → internal_id mapping.
 *
 * Parent resolution is performed via the folderMap, which must already
 * contain the parent folder's entry (achieved by processing folders sorted
 * by depth via sortFoldersByDepth).
 *
 * Mutates params.folderMap in-place.
 *
 * @returns The internal folder UUID (UPPERCASE).
 */
export async function upsertFolder(params: UpsertFolderParams): Promise<string> {
  const { item, connectionId, scopeId, userId, microsoftDriveId, folderMap, provider } = params;

  const parentFolderId = resolveParentFolderId(item.parentId, folderMap);

  logger.debug(
    {
      folderName: item.name,
      externalId: item.id,
      parentId: item.parentId,
      resolvedParentFolderId: parentFolderId,
      mapSize: folderMap.size,
    },
    'Resolving folder parent'
  );

  const existing = await prisma.files.findFirst({
    where: { connection_id: connectionId, external_id: item.id },
    select: { id: true },
  });

  if (existing) {
    await prisma.files.update({
      where: { id: existing.id },
      data: {
        name: item.name,
        external_url: item.webUrl || null,
        external_modified_at: item.lastModifiedAt ? new Date(item.lastModifiedAt) : null,
        parent_folder_id: parentFolderId,
        connection_scope_id: scopeId,
        last_synced_at: new Date(),
      },
    });
    folderMap.set(item.id, existing.id);
    return existing.id;
  } else {
    const folderId = randomUUID().toUpperCase();
    await prisma.files.create({
      data: {
        id: folderId,
        user_id: userId,
        name: item.name,
        mime_type: 'inode/directory',
        size_bytes: BigInt(0),
        blob_path: null,
        is_folder: true,
        source_type: provider === 'sharepoint' ? FILE_SOURCE_TYPE.SHAREPOINT : FILE_SOURCE_TYPE.ONEDRIVE,
        external_id: item.id,
        external_drive_id: microsoftDriveId,
        connection_id: connectionId,
        connection_scope_id: scopeId,
        external_url: item.webUrl || null,
        external_modified_at: item.lastModifiedAt ? new Date(item.lastModifiedAt) : null,
        parent_folder_id: parentFolderId,
        pipeline_status: 'ready',
        processing_retry_count: 0,
        embedding_retry_count: 0,
        is_favorite: false,
      },
    });
    folderMap.set(item.id, folderId);
    return folderId;
  }
}
