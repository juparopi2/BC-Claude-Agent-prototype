/**
 * InMemoryBCDataStore - Test Double for IBCDataStore
 *
 * This is a "fake" implementation (not a mock) that stores BC data in memory.
 * Unlike the FileSystemBCDataStore which reads from files, this one stores data
 * in memory for fast, predictable testing.
 *
 * Benefits over mocking fs module:
 * - Tests don't depend on file system
 * - Much faster (no I/O)
 * - Easy to test edge cases (missing entities, corrupted data)
 * - No cleanup needed (data lives only in memory)
 * - Tests survive file system structure changes
 *
 * Usage:
 * ```typescript
 * const dataStore = new InMemoryBCDataStore();
 * dataStore.addEntity({
 *   entity: 'customer',
 *   displayName: 'Customer',
 *   description: 'Customer entity',
 *   operations: ['list', 'get'],
 *   endpoints: [],
 * });
 * const service = new DirectAgentService(undefined, undefined, undefined, dataStore);
 * ```
 */

import type { IBCDataStore, BCIndex, BCEntity } from './IBCDataStore';

/**
 * In-Memory BC Data Store
 *
 * Test double that implements IBCDataStore with in-memory storage.
 */
export class InMemoryBCDataStore implements IBCDataStore {
  private entities: Map<string, BCEntity> = new Map();
  private operationIndex: Map<string, string> = new Map();

  /**
   * Creates a new In-Memory BC Data Store
   *
   * @param initialEntities - Optional array of entities to initialize with
   */
  constructor(initialEntities?: BCEntity[]) {
    if (initialEntities) {
      for (const entity of initialEntities) {
        this.addEntity(entity);
      }
    }
  }

  /**
   * Adds an entity to the store
   *
   * Also updates the operation index with all endpoints.
   *
   * @param entity - The entity to add
   */
  addEntity(entity: BCEntity): void {
    this.entities.set(entity.entity, entity);

    // Update operation index
    for (const endpoint of entity.endpoints) {
      this.operationIndex.set(endpoint.id, entity.entity);
    }
  }

  /**
   * Removes an entity from the store
   *
   * @param entityName - The name of the entity to remove
   */
  removeEntity(entityName: string): void {
    const entity = this.entities.get(entityName);
    if (entity) {
      // Remove from operation index
      for (const endpoint of entity.endpoints) {
        this.operationIndex.delete(endpoint.id);
      }
      // Remove entity
      this.entities.delete(entityName);
    }
  }

  /**
   * Clears all entities
   */
  clear(): void {
    this.entities.clear();
    this.operationIndex.clear();
  }

  /**
   * Gets the complete BC index
   *
   * @returns Promise resolving to the BC index
   */
  async getIndex(): Promise<BCIndex> {
    return {
      entities: Array.from(this.entities.values()),
      operationIndex: Object.fromEntries(this.operationIndex),
    };
  }

  /**
   * Gets a specific entity by name
   *
   * @param entityName - The name of the entity to retrieve
   * @returns Promise resolving to the entity, or null if not found
   */
  async getEntity(entityName: string): Promise<BCEntity | null> {
    return this.entities.get(entityName) || null;
  }

  /**
   * Gets all entities
   *
   * @returns Promise resolving to array of all entities
   */
  async getAllEntities(): Promise<BCEntity[]> {
    return Array.from(this.entities.values());
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
    const lowerKeyword = keyword.toLowerCase();

    return Array.from(this.entities.values()).filter(entity => {
      return (
        entity.entity.toLowerCase().includes(lowerKeyword) ||
        entity.displayName.toLowerCase().includes(lowerKeyword) ||
        entity.description.toLowerCase().includes(lowerKeyword)
      );
    });
  }

  /**
   * Gets an entity by operation ID
   *
   * Convenience method for tests.
   *
   * @param operationId - The operation ID
   * @returns Promise resolving to the entity, or null if not found
   */
  async getEntityByOperationId(operationId: string): Promise<BCEntity | null> {
    const entityName = this.operationIndex.get(operationId);
    if (!entityName) return null;
    return this.getEntity(entityName);
  }

  /**
   * Creates a minimal entity for testing
   *
   * Helper method to quickly create test entities.
   *
   * @param entityName - The entity name
   * @param options - Optional properties to override
   * @returns The created entity
   */
  static createMinimalEntity(
    entityName: string,
    options?: Partial<BCEntity>
  ): BCEntity {
    return {
      entity: entityName,
      displayName: options?.displayName || entityName,
      description: options?.description || `Test entity for ${entityName}`,
      operations: options?.operations || ['list', 'get'],
      endpoints: options?.endpoints || [],
      relationships: options?.relationships || [],
      commonWorkflows: options?.commonWorkflows || [],
    };
  }
}
