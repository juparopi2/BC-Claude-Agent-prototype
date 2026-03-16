/**
 * SharePoint Site Node Types
 *
 * Types for grouping SharePoint library scopes by site in the folder tree.
 * Supports both library-level scopes and folder-level scopes within a library.
 *
 * @module domains/files/types/siteNode
 */

/**
 * Reference to a folder-level scope within a library.
 * Used when only specific folders are synced (not the whole library).
 */
export interface FolderScopeRef {
  scopeId: string;
  displayName: string;
  fileCount: number;
}

/**
 * Represents a SharePoint document library in the folder tree.
 * Supports two modes:
 * - **Library scope**: `scopeId` is set — entire library is synced
 * - **Folder scopes**: `folderScopes` is set — only specific folders within this library are synced
 */
export interface SharePointLibraryNode {
  displayName: string;
  driveId: string;
  fileCount: number;
  /** Set when the entire library is a scope (library-type) */
  scopeId?: string;
  /** Set when only specific folders are synced within this library */
  folderScopes?: FolderScopeRef[];
}

/**
 * Represents a SharePoint site in the folder tree, grouping its libraries.
 */
export interface SharePointSiteNode {
  siteId: string;
  displayName: string;
  libraries: SharePointLibraryNode[];
  totalFileCount: number;
}
