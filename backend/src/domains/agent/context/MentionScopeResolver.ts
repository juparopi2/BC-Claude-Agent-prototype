/**
 * @module domains/agent/context/MentionScopeResolver
 *
 * Centralized service for resolving @mention inputs into a ready-to-use
 * OData filter string for Azure AI Search and rich metadata for LLM annotation.
 *
 * Replaces the ad-hoc folder-expansion logic that lived in FileContextPreparer.
 *
 * ## Resolution strategy
 *
 * | Mention type     | Filter built                                         |
 * |------------------|------------------------------------------------------|
 * | type === 'site'  | `siteId eq 'SITE-ID'`                                |
 * | isFolder / folder| `search.in(parentFolderId, 'A,B,C,...', ',')`        |
 * | file (default)   | `search.in(fileId, 'FILE-ID', ',')`                  |
 *
 * Individual filter parts are joined with ` or `.
 *
 * ## Deduplication
 *
 * If the user mentions folder A and sub-folder B (where B is a descendant of A),
 * B is silently dropped and a warning is emitted.
 *
 * @example
 * ```typescript
 * const resolver = new MentionScopeResolver();
 * const resolution = await resolver.resolve('USER-1', [
 *   { fileId: 'FOLDER-ID', name: 'Reports', isFolder: true },
 *   { fileId: 'FILE-ID',   name: 'Summary.pdf', isFolder: false },
 * ]);
 * console.log(resolution.searchFilter);
 * // "(search.in(parentFolderId, 'FOLDER-ID,CHILD-1', ',')) or (search.in(fileId, 'FILE-ID', ','))"
 * ```
 */

import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/** Input shape for a single @mention. */
export interface MentionInput {
  /** File or folder UUID (UPPERCASE). */
  fileId: string;
  /** Display name. */
  name: string;
  /** True when the mention is a folder. */
  isFolder: boolean;
  /** Optional explicit type — overrides isFolder when set to 'site' or 'folder'. */
  type?: 'file' | 'folder' | 'site';
  /** Site ID for site-scoped mentions (populated when type === 'site'). */
  siteId?: string;
}

/** Metadata about a single resolved mention — used for LLM annotation. */
export interface ResolvedMention {
  type: 'file' | 'folder' | 'site';
  id: string;
  name: string;
  /** For folders: total descendant file count (not capped). */
  descendantFileCount?: number;
  /** For sites: total indexed file count. */
  fileCount?: number;
}

/** Full resolution result returned by MentionScopeResolver.resolve(). */
export interface ScopeResolution {
  /** OData filter string ready for Azure AI Search — null when no scope applies. */
  searchFilter: string | null;
  /** Rich metadata about each resolved mention for prompt annotation. */
  resolvedMentions: ResolvedMention[];
  /** Human-readable warnings about deduplication or resolution skips. */
  warnings: string[];
  /** True when any scope filter was built (false = global search). */
  isScoped: boolean;
}

// ---------------------------------------------------------------------------
// Internal helper types
// ---------------------------------------------------------------------------

/** Folder node used for ancestor deduplication. */
interface FolderNode {
  mentionId: string;
  mentionName: string;
  /** All folder IDs in the subtree (including the root folder itself). */
  allFolderIds: string[];
}

// ---------------------------------------------------------------------------
// MentionScopeResolver
// ---------------------------------------------------------------------------

/**
 * Stateless singleton — safe to share across concurrent requests.
 * All mutable state lives in the per-call local variables.
 */
export class MentionScopeResolver {
  private readonly logger = createChildLogger({ service: 'MentionScopeResolver' });

  /**
   * Resolve an array of @mention inputs into a ready-to-use OData scope filter
   * and LLM annotation metadata.
   *
   * @param userId - The authenticated user ID (UPPERCASE). Used for all DB queries.
   * @param mentions - The raw @mention inputs from the chat message.
   * @returns ScopeResolution with filter, metadata, and any warnings.
   */
  async resolve(userId: string, mentions: MentionInput[]): Promise<ScopeResolution> {
    if (mentions.length === 0) {
      return { searchFilter: null, resolvedMentions: [], warnings: [], isScoped: false };
    }

    const resolvedMentions: ResolvedMention[] = [];
    const warnings: string[] = [];

    // Classify incoming mentions
    const siteMentions = mentions.filter(m => m.type === 'site');
    const folderMentions = mentions.filter(m => m.type !== 'site' && (m.isFolder || m.type === 'folder'));
    const fileMentions = mentions.filter(m => m.type !== 'site' && !m.isFolder && m.type !== 'folder');

    // Collect OData filter parts — one per logical group
    const filterParts: string[] = [];

    // ------------------------------------------------------------------
    // 1. Site mentions
    // ------------------------------------------------------------------
    for (const site of siteMentions) {
      const siteId = site.siteId ?? site.fileId;
      if (!siteId) {
        this.logger.warn({ mention: site.name }, 'Site mention missing siteId, skipping');
        warnings.push(`Could not resolve site "${site.name}" — no site ID available.`);
        continue;
      }

      const fileCount = await this.countFilesForSite(siteId, userId);

      resolvedMentions.push({
        type: 'site',
        id: siteId.toUpperCase(),
        name: site.name,
        fileCount,
      });

      filterParts.push(`siteId eq '${siteId.toUpperCase()}'`);
    }

    // ------------------------------------------------------------------
    // 2. Folder mentions — expand to subtree, deduplicate nested folders
    // ------------------------------------------------------------------
    if (folderMentions.length > 0) {
      const folderNodes = await this.expandFolderMentions(userId, folderMentions);
      const deduped = this.deduplicateFolders(folderNodes, warnings);

      for (const node of deduped) {
        const descendantFileCount = await this.countDescendantFiles(userId, node.mentionId);
        resolvedMentions.push({
          type: 'folder',
          id: node.mentionId.toUpperCase(),
          name: node.mentionName,
          descendantFileCount,
        });

        // Build scope filter: files whose parentFolderId is one of the subtree folders
        // (allFolderIds already UPPERCASE from expandFolderMentions normalization)
        const allFolderIds = node.allFolderIds.join(',');
        filterParts.push(`search.in(parentFolderId, '${allFolderIds}', ',')`);
      }
    }

    // ------------------------------------------------------------------
    // 3. File mentions — plain fileId filter
    // ------------------------------------------------------------------
    if (fileMentions.length > 0) {
      const fileIds = fileMentions.map(m => m.fileId.toUpperCase()).join(',');
      filterParts.push(`search.in(fileId, '${fileIds}', ',')`);

      for (const fm of fileMentions) {
        resolvedMentions.push({
          type: 'file',
          id: fm.fileId.toUpperCase(),
          name: fm.name,
        });
      }
    }

    const searchFilter = filterParts.length > 0
      ? filterParts.map(p => `(${p})`).join(' or ')
      : null;

    this.logger.info(
      {
        userId,
        mentionCount: mentions.length,
        resolvedCount: resolvedMentions.length,
        warningCount: warnings.length,
        hasFilter: searchFilter !== null,
        searchFilter: searchFilter ?? '(none)',
        filterParts,
      },
      'Mention scope resolved — full OData filter'
    );

    return {
      searchFilter,
      resolvedMentions,
      warnings,
      isScoped: searchFilter !== null,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Expand each folder mention into a FolderNode containing all subfolder IDs.
   * Uses a recursive CTE to walk the folder tree up to depth 20.
   */
  private async expandFolderMentions(
    userId: string,
    folderMentions: MentionInput[]
  ): Promise<FolderNode[]> {
    const nodes: FolderNode[] = [];

    for (const mention of folderMentions) {
      const folderId = mention.fileId.toUpperCase();

      try {
        // Collect all folder IDs in the subtree (root + all descendants that are folders)
        const rawFolderIds = await this.getDescendantFolderIds(userId, folderId);
        // Normalize to UPPERCASE — DB returns original case but filters and dedup use UPPERCASE
        const allFolderIds = rawFolderIds.map(id => id.toUpperCase());

        // LOG POINT 1: Full CTE expansion result — critical for diagnosing scope filter issues
        this.logger.debug(
          { folderId, folderName: mention.name, userId, allFolderIds, depth: allFolderIds.length },
          'CTE folder expansion result — all descendant folder IDs'
        );

        nodes.push({
          mentionId: folderId,
          mentionName: mention.name,
          allFolderIds,
        });
      } catch (err) {
        const errorInfo = err instanceof Error
          ? { message: err.message, name: err.name }
          : { value: String(err) };
        this.logger.warn({ folderId, userId, error: errorInfo }, 'Failed to expand folder mention, skipping');
        // Still add a partial node so the root folder at least appears in the filter
        nodes.push({
          mentionId: folderId,
          mentionName: mention.name,
          allFolderIds: [folderId],
        });
      }
    }

    return nodes;
  }

  /**
   * Get all folder IDs in the subtree rooted at `folderId` (inclusive).
   * Returns `[folderId, child1, child2, ...]`.
   *
   * Uses $queryRaw tagged template to avoid SQL injection.
   * OPTION (MAXRECURSION 20) prevents runaway queries on deep trees.
   */
  private async getDescendantFolderIds(userId: string, folderId: string): Promise<string[]> {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      ;WITH folder_tree AS (
        SELECT id
        FROM files
        WHERE id = ${folderId}
          AND user_id = ${userId}
      UNION ALL
        SELECT f.id
        FROM files f
        INNER JOIN folder_tree ft ON f.parent_folder_id = ft.id
        WHERE f.user_id = ${userId}
          AND f.is_folder = 1
          AND f.deletion_status IS NULL
      )
      SELECT id FROM folder_tree
      OPTION (MAXRECURSION 20)
      `;

    return rows.map(r => r.id);
  }

  /**
   * Count the number of non-folder descendant files in a folder's subtree.
   * Used for the `descendant_file_count` annotation in the LLM context.
   * NOT capped — returns the real count.
   */
  private async countDescendantFiles(userId: string, folderId: string): Promise<number> {
    try {
      const rows = await prisma.$queryRaw<Array<{ cnt: number }>>`
        ;WITH folder_tree AS (
          SELECT id
          FROM files
          WHERE id = ${folderId}
            AND user_id = ${userId}
        UNION ALL
          SELECT f.id
          FROM files f
          INNER JOIN folder_tree ft ON f.parent_folder_id = ft.id
          WHERE f.user_id = ${userId}
            AND f.is_folder = 1
            AND f.deletion_status IS NULL
        )
        SELECT COUNT(*) AS cnt
        FROM files
        WHERE parent_folder_id IN (SELECT id FROM folder_tree)
          AND is_folder = 0
          AND deletion_status IS NULL
          AND user_id = ${userId}
        OPTION (MAXRECURSION 20)
        `;

      return Number(rows[0]?.cnt ?? 0);
    } catch (err) {
      const errorInfo = err instanceof Error ? { message: err.message } : { value: String(err) };
      this.logger.warn({ folderId, userId, error: errorInfo }, 'Failed to count descendant files');
      return 0;
    }
  }

  /**
   * Count files belonging to a specific SharePoint/OneDrive site.
   * Joins files → connection_scopes on connection_scope_id to filter by scope_site_id.
   */
  private async countFilesForSite(siteId: string, userId: string): Promise<number> {
    try {
      const rows = await prisma.$queryRaw<Array<{ cnt: number }>>`
        SELECT COUNT(*) AS cnt
        FROM files f
        INNER JOIN connection_scopes cs ON f.connection_scope_id = cs.id
        WHERE cs.scope_site_id = ${siteId}
          AND f.user_id = ${userId}
          AND f.deletion_status IS NULL
          AND f.is_folder = 0
        `;

      return Number(rows[0]?.cnt ?? 0);
    } catch (err) {
      const errorInfo = err instanceof Error ? { message: err.message } : { value: String(err) };
      this.logger.warn({ siteId, userId, error: errorInfo }, 'Failed to count files for site');
      return 0;
    }
  }

  /**
   * Remove folder nodes that are already covered by an ancestor folder node.
   *
   * Algorithm: for each pair (A, B), if B's root folder ID appears in A's allFolderIds,
   * B is a descendant of A — drop B and emit a warning.
   *
   * Mutates `warnings` in place.
   */
  private deduplicateFolders(nodes: FolderNode[], warnings: string[]): FolderNode[] {
    if (nodes.length <= 1) return nodes;

    const kept: FolderNode[] = [];
    const droppedIds = new Set<string>();

    for (const node of nodes) {
      if (droppedIds.has(node.mentionId)) continue;

      // Check if this node is a descendant of any already-kept node
      let isDescendant = false;
      for (const ancestor of kept) {
        if (ancestor.allFolderIds.includes(node.mentionId)) {
          // node is inside ancestor
          warnings.push(
            `Folder "${node.mentionName}" is already included within folder "${ancestor.mentionName}" — deduplicated.`
          );
          droppedIds.add(node.mentionId);
          isDescendant = true;
          break;
        }
      }

      if (!isDescendant) {
        // Also check if any previously kept node is a descendant of this node
        // (handles the case where mentions are ordered child-before-parent)
        const toRemove: number[] = [];
        for (let j = 0; j < kept.length; j++) {
          const keptNode = kept[j];
          if (keptNode !== undefined && node.allFolderIds.includes(keptNode.mentionId)) {
            warnings.push(
              `Folder "${keptNode.mentionName}" is already included within folder "${node.mentionName}" — deduplicated.`
            );
            droppedIds.add(keptNode.mentionId);
            toRemove.push(j);
          }
        }
        // Remove in reverse order to preserve indices
        for (let k = toRemove.length - 1; k >= 0; k--) {
          const idx = toRemove[k];
          if (idx !== undefined) kept.splice(idx, 1);
        }
        kept.push(node);
      }
    }

    return kept;
  }
}

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

let _instance: MentionScopeResolver | undefined;

/**
 * Get the shared MentionScopeResolver singleton.
 * Creates the instance lazily on first call.
 */
export function getMentionScopeResolver(): MentionScopeResolver {
  _instance ??= new MentionScopeResolver();
  return _instance;
}
