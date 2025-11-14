/**
 * FileSystemBCDataStore - Real implementation of IBCDataStore
 *
 * Reads Business Central data from the file system (vendored MCP server data).
 * This is the production implementation that loads data from:
 * - mcp-server/data/v1.0/bc_index.json
 * - mcp-server/data/v1.0/entities/*.json
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IBCDataStore, BCIndex, BCEntity } from './IBCDataStore';

/**
 * File System BC Data Store
 *
 * Reads BC data from vendored MCP server files.
 */
export class FileSystemBCDataStore implements IBCDataStore {
  private dataPath: string;
  private cachedIndex: BCIndex | null = null;

  /**
   * Creates a new File System BC Data Store
   *
   * @param dataPath - Path to the MCP server data directory (e.g., mcp-server/data/v1.0)
   */
  constructor(dataPath?: string) {
    // Default to the vendored MCP server data
    const mcpServerDir = path.join(process.cwd(), 'mcp-server');
    this.dataPath = dataPath || path.join(mcpServerDir, 'data', 'v1.0');
  }

  /**
   * Gets the complete BC index
   *
   * Loads from bc_index.json and caches the result.
   *
   * @returns Promise resolving to the BC index
   * @throws Error if the index cannot be loaded
   */
  async getIndex(): Promise<BCIndex> {
    if (this.cachedIndex) {
      return this.cachedIndex;
    }

    const indexPath = path.join(this.dataPath, 'bc_index.json');

    if (!fs.existsSync(indexPath)) {
      throw new Error(`BC index not found at ${indexPath}`);
    }

    try {
      const content = fs.readFileSync(indexPath, 'utf8');
      this.cachedIndex = JSON.parse(content) as BCIndex;
      return this.cachedIndex;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to load BC index: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Gets a specific entity by name
   *
   * Loads from entities/{entityName}.json
   *
   * @param entityName - The name of the entity to retrieve
   * @returns Promise resolving to the entity, or null if not found
   * @throws Error if there's an error loading the entity
   */
  async getEntity(entityName: string): Promise<BCEntity | null> {
    const entityPath = path.join(this.dataPath, 'entities', `${entityName}.json`);

    if (!fs.existsSync(entityPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(entityPath, 'utf8');
      return JSON.parse(content) as BCEntity;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to load entity ${entityName}: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Gets all entities
   *
   * Returns entities from the cached index.
   *
   * @returns Promise resolving to array of all entities
   * @throws Error if there's an error loading entities
   */
  async getAllEntities(): Promise<BCEntity[]> {
    const index = await this.getIndex();
    return index.entities;
  }

  /**
   * Searches for entities by keyword
   *
   * Searches in entity name, display name, and description.
   *
   * @param keyword - The search keyword (case-insensitive)
   * @returns Promise resolving to matching entities
   */
  async searchEntities(keyword: string): Promise<BCEntity[]> {
    const allEntities = await this.getAllEntities();
    const lowerKeyword = keyword.toLowerCase();

    return allEntities.filter(entity => {
      return (
        entity.entity.toLowerCase().includes(lowerKeyword) ||
        entity.displayName.toLowerCase().includes(lowerKeyword) ||
        entity.description.toLowerCase().includes(lowerKeyword)
      );
    });
  }

  /**
   * Clears the cached index
   *
   * Useful for testing or when data files are updated.
   */
  clearCache(): void {
    this.cachedIndex = null;
  }
}
