/**
 * IBCDataStore - Abstraction over Business Central data access
 *
 * This interface follows the "Don't Mock What You Don't Own" principle.
 * Instead of mocking the fs module in tests, we:
 * 1. Define an interface for data access operations
 * 2. Create a FileSystemBCDataStore that implements this interface
 * 3. Create an InMemoryBCDataStore for testing
 *
 * Benefits:
 * - Tests don't depend on file system
 * - Tests are faster (no I/O)
 * - Easy to test edge cases (missing files, corrupted data)
 * - Clear separation between business logic and data access
 */

/**
 * BC Entity definition from the index
 */
export interface BCEntity {
  entity: string;
  displayName: string;
  description: string;
  operations: string[];
  endpoints: BCEndpoint[];
  relationships?: BCRelationship[];
  commonWorkflows?: unknown[];
}

/**
 * BC Endpoint definition
 */
export interface BCEndpoint {
  id: string;
  method: string;
  path?: string;
  summary: string;
  operationType: string;
  riskLevel: string;
  requiresHumanApproval?: boolean;
  requiredFields?: string[];
  optionalFields?: string[];
}

/**
 * BC Relationship definition
 */
export interface BCRelationship {
  entity: string;
  type?: string;
}

/**
 * BC Index structure
 */
export interface BCIndex {
  entities: BCEntity[];
  operationIndex: Record<string, string>;
}

/**
 * BC Data Store Interface
 *
 * Defines the contract for accessing Business Central data.
 * Implementations:
 * - FileSystemBCDataStore: Real implementation reading from files
 * - InMemoryBCDataStore: Test double for unit tests
 */
export interface IBCDataStore {
  /**
   * Gets the complete BC index
   *
   * @returns Promise resolving to the BC index
   * @throws Error if the index cannot be loaded
   */
  getIndex(): Promise<BCIndex>;

  /**
   * Gets a specific entity by name
   *
   * @param entityName - The name of the entity to retrieve
   * @returns Promise resolving to the entity, or null if not found
   * @throws Error if there's an error loading the entity
   */
  getEntity(entityName: string): Promise<BCEntity | null>;

  /**
   * Gets all entities
   *
   * @returns Promise resolving to array of all entities
   * @throws Error if there's an error loading entities
   */
  getAllEntities(): Promise<BCEntity[]>;

  /**
   * Searches for entities by keyword
   *
   * @param keyword - The search keyword
   * @returns Promise resolving to matching entities
   */
  searchEntities(keyword: string): Promise<BCEntity[]>;
}
