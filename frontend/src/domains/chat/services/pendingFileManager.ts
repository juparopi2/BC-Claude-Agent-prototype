/**
 * Pending File Manager
 *
 * In-memory manager for pending File objects.
 *
 * File objects cannot be serialized to Zustand persist or URL params.
 * This manager holds actual File references while the store holds metadata.
 *
 * The store (pendingChatStore) contains PendingFileInfo with tempId, name, size, type.
 * This manager maps tempId -> actual File object.
 *
 * On page refresh, File objects are lost (they cannot be persisted).
 * The store's metadata remains, but without the actual file data.
 *
 * @module domains/chat/services/pendingFileManager
 */

/**
 * Manages File objects for pending chat uploads.
 *
 * @example
 * ```typescript
 * // Add a file
 * const tempId = crypto.randomUUID();
 * pendingFileManager.add(tempId, file);
 *
 * // Get a file
 * const file = pendingFileManager.get(tempId);
 *
 * // Get all files for upload
 * const files = pendingFileManager.getAllAsArray();
 * for (const { tempId, file } of files) {
 *   await uploadFile(file);
 * }
 *
 * // Clear after upload
 * pendingFileManager.clear();
 * ```
 */
class PendingFileManager {
  private files: Map<string, File> = new Map();

  /**
   * Add a file with a temporary ID
   * @param tempId - Unique temporary identifier
   * @param file - File object to store
   */
  add(tempId: string, file: File): void {
    this.files.set(tempId, file);
  }

  /**
   * Get a file by its temporary ID
   * @param tempId - Temporary identifier
   * @returns File object or undefined if not found
   */
  get(tempId: string): File | undefined {
    return this.files.get(tempId);
  }

  /**
   * Remove a file by its temporary ID
   * @param tempId - Temporary identifier
   * @returns true if file was removed, false if not found
   */
  remove(tempId: string): boolean {
    return this.files.delete(tempId);
  }

  /**
   * Get all files as a Map
   * @returns Copy of the internal Map
   */
  getAll(): Map<string, File> {
    return new Map(this.files);
  }

  /**
   * Get all files as an array with their temp IDs
   * @returns Array of { tempId, file } objects
   */
  getAllAsArray(): Array<{ tempId: string; file: File }> {
    return Array.from(this.files.entries()).map(([tempId, file]) => ({
      tempId,
      file,
    }));
  }

  /**
   * Check if a file exists
   * @param tempId - Temporary identifier
   * @returns true if file exists
   */
  has(tempId: string): boolean {
    return this.files.has(tempId);
  }

  /**
   * Clear all stored files
   */
  clear(): void {
    this.files.clear();
  }

  /**
   * Get the number of stored files
   */
  get size(): number {
    return this.files.size;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Singleton instance for pending file management.
 *
 * This is intentionally a singleton because:
 * 1. File objects must persist across component re-renders
 * 2. Multiple components may need to access the same files
 * 3. The /new page adds files, the /chat page uploads them
 */
export const pendingFileManager = new PendingFileManager();
