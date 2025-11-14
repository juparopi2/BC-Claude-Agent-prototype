/**
 * BCEntityFixture - Builder pattern for BC Entity test data
 *
 * This fixture makes it easy to create BC entities and endpoints for tests.
 * Uses the Builder pattern to allow fluent, readable test setup.
 *
 * Benefits:
 * - Reduces test boilerplate
 * - Provides realistic default data
 * - Easy to customize for specific test scenarios
 * - Self-documenting
 *
 * Usage:
 * ```typescript
 * const customer = BCEntityFixture.entity('customer')
 *   .withDisplayName('Customer')
 *   .withOperation('list', 'get', 'create')
 *   .withEndpoint(
 *     BCEntityFixture.endpoint('customer_list')
 *       .withMethod('GET')
 *       .withOperationType('list')
 *       .withRiskLevel('low')
 *   )
 *   .build();
 * ```
 */

import type { BCEntity, BCEndpoint, BCRelationship } from '@/services/agent/IBCDataStore';

/**
 * Builder for creating BC endpoint test data
 */
export class BCEndpointBuilder {
  private endpoint: Partial<BCEndpoint> = {
    riskLevel: 'medium',
    operationType: 'get',
    method: 'GET',
  };

  constructor(id: string) {
    this.endpoint.id = id;
    this.endpoint.summary = `Operation ${id}`;
  }

  withMethod(method: string): this {
    this.endpoint.method = method;
    return this;
  }

  withPath(path: string): this {
    this.endpoint.path = path;
    return this;
  }

  withSummary(summary: string): this {
    this.endpoint.summary = summary;
    return this;
  }

  withOperationType(operationType: string): this {
    this.endpoint.operationType = operationType;
    return this;
  }

  withRiskLevel(riskLevel: string): this {
    this.endpoint.riskLevel = riskLevel;
    return this;
  }

  requiresApproval(requires = true): this {
    this.endpoint.requiresHumanApproval = requires;
    return this;
  }

  withRequiredFields(...fields: string[]): this {
    this.endpoint.requiredFields = fields;
    return this;
  }

  withOptionalFields(...fields: string[]): this {
    this.endpoint.optionalFields = fields;
    return this;
  }

  build(): BCEndpoint {
    return this.endpoint as BCEndpoint;
  }
}

/**
 * Builder for creating BC entity test data
 */
export class BCEntityBuilder {
  private entity: Partial<BCEntity> = {
    operations: [],
    endpoints: [],
    relationships: [],
    commonWorkflows: [],
  };

  constructor(entityName: string) {
    this.entity.entity = entityName;
    this.entity.displayName = entityName.charAt(0).toUpperCase() + entityName.slice(1);
    this.entity.description = `Test entity for ${entityName}`;
  }

  withDisplayName(displayName: string): this {
    this.entity.displayName = displayName;
    return this;
  }

  withDescription(description: string): this {
    this.entity.description = description;
    return this;
  }

  withOperations(...operations: string[]): this {
    this.entity.operations = operations;
    return this;
  }

  withEndpoint(endpoint: BCEndpoint | BCEndpointBuilder): this {
    const built = endpoint instanceof BCEndpointBuilder ? endpoint.build() : endpoint;
    this.entity.endpoints = [...(this.entity.endpoints || []), built];
    return this;
  }

  withEndpoints(...endpoints: Array<BCEndpoint | BCEndpointBuilder>): this {
    for (const endpoint of endpoints) {
      this.withEndpoint(endpoint);
    }
    return this;
  }

  withRelationship(entity: string, type?: string): this {
    const relationship: BCRelationship = { entity, type };
    this.entity.relationships = [...(this.entity.relationships || []), relationship];
    return this;
  }

  withWorkflow(workflow: unknown): this {
    this.entity.commonWorkflows = [...(this.entity.commonWorkflows || []), workflow];
    return this;
  }

  build(): BCEntity {
    return this.entity as BCEntity;
  }
}

/**
 * Main fixture class with static factory methods
 */
export class BCEntityFixture {
  /**
   * Creates a new entity builder
   */
  static entity(name: string): BCEntityBuilder {
    return new BCEntityBuilder(name);
  }

  /**
   * Creates a new endpoint builder
   */
  static endpoint(id: string): BCEndpointBuilder {
    return new BCEndpointBuilder(id);
  }

  /**
   * Common presets for typical test entities
   */
  static readonly Presets = {
    /**
     * Customer entity with list and get operations
     */
    customer: () =>
      BCEntityFixture.entity('customer')
        .withDisplayName('Customer')
        .withDescription('Customer entity for managing customer data')
        .withOperations('list', 'get', 'create', 'update')
        .withEndpoint(
          BCEntityFixture.endpoint('customer_list')
            .withMethod('GET')
            .withOperationType('list')
            .withPath('/customers')
            .withRiskLevel('low')
            .withSummary('List all customers')
        )
        .withEndpoint(
          BCEntityFixture.endpoint('customer_get')
            .withMethod('GET')
            .withOperationType('get')
            .withPath('/customers/{id}')
            .withRiskLevel('low')
            .withSummary('Get a single customer')
            .withRequiredFields('id')
        )
        .withEndpoint(
          BCEntityFixture.endpoint('customer_create')
            .withMethod('POST')
            .withOperationType('create')
            .withPath('/customers')
            .withRiskLevel('high')
            .requiresApproval()
            .withSummary('Create a new customer')
            .withRequiredFields('name', 'email')
            .withOptionalFields('phone', 'address')
        )
        .build(),

    /**
     * Sales Order entity with multiple operations
     */
    salesOrder: () =>
      BCEntityFixture.entity('salesOrder')
        .withDisplayName('Sales Order')
        .withDescription('Sales order entity for managing orders')
        .withOperations('list', 'get', 'create', 'update', 'delete')
        .withEndpoint(
          BCEntityFixture.endpoint('salesOrder_list')
            .withMethod('GET')
            .withOperationType('list')
            .withRiskLevel('low')
            .withSummary('List all sales orders')
        )
        .withEndpoint(
          BCEntityFixture.endpoint('salesOrder_create')
            .withMethod('POST')
            .withOperationType('create')
            .withRiskLevel('high')
            .requiresApproval()
            .withSummary('Create a new sales order')
            .withRequiredFields('customerId', 'items')
        )
        .withRelationship('customer', 'foreign_key')
        .withRelationship('item', 'many_to_many')
        .build(),

    /**
     * Read-only entity (reports, views)
     */
    readOnly: (name: string) =>
      BCEntityFixture.entity(name)
        .withOperations('list', 'get')
        .withEndpoint(
          BCEntityFixture.endpoint(`${name}_list`)
            .withOperationType('list')
            .withRiskLevel('low')
        )
        .withEndpoint(
          BCEntityFixture.endpoint(`${name}_get`)
            .withOperationType('get')
            .withRiskLevel('low')
        )
        .build(),

    /**
     * High-risk write entity
     */
    highRisk: (name: string) =>
      BCEntityFixture.entity(name)
        .withOperations('create', 'update', 'delete')
        .withEndpoint(
          BCEntityFixture.endpoint(`${name}_create`)
            .withOperationType('create')
            .withRiskLevel('critical')
            .requiresApproval()
        )
        .withEndpoint(
          BCEntityFixture.endpoint(`${name}_update`)
            .withOperationType('update')
            .withRiskLevel('high')
            .requiresApproval()
        )
        .withEndpoint(
          BCEntityFixture.endpoint(`${name}_delete`)
            .withOperationType('delete')
            .withRiskLevel('critical')
            .requiresApproval()
        )
        .build(),
  };
}
