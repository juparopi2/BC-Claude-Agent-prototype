/**
 * Direct Test: MCP Tool Implementations
 *
 * Tests tool implementations directly without WebSocket
 *
 * Usage:
 *   npx ts-node scripts/test-tool-direct.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// Simulated DirectAgentService tool implementations
class ToolTester {
  private mcpDataPath: string;

  constructor() {
    // Path to MCP data (within backend folder)
    this.mcpDataPath = path.join(__dirname, '..', 'mcp-server', 'data', 'v1.0');

    if (!fs.existsSync(this.mcpDataPath)) {
      throw new Error(`MCP data path not found: ${this.mcpDataPath}`);
    }
  }

  async testSearchEntityOperations(): Promise<void> {
    console.log('\n🧪 Testing: search_entity_operations');
    console.log('='.repeat(80));

    try {
      const args = {
        keyword: 'customer',
        filter_by_risk: 'MEDIUM',
      };

      console.log(`   Args: ${JSON.stringify(args)}`);

      const result = await this.toolSearchEntityOperations(args);
      const parsed = JSON.parse(result);

      console.log(`   ✅ Result: ${parsed.total_matches} matches found`);
      console.log(`   ✅ Keyword: "${parsed.keyword}"`);
      console.log(`   ✅ Filters applied: risk=${parsed.filters.risk_level}`);

      if (parsed.total_matches > 0) {
        console.log(`   ✅ Sample entity: ${parsed.results[0].entity}`);
      }

      console.log('   ✅ TEST PASSED\n');
    } catch (error) {
      console.error(`   ❌ TEST FAILED: ${(error as Error).message}\n`);
      throw error;
    }
  }

  async testGetEntityRelationships(): Promise<void> {
    console.log('🧪 Testing: get_entity_relationships');
    console.log('='.repeat(80));

    try {
      const args = {
        entity_name: 'customer',
      };

      console.log(`   Args: ${JSON.stringify(args)}`);

      const result = await this.toolGetEntityRelationships(args);
      const parsed = JSON.parse(result);

      console.log(`   ✅ Entity: ${parsed.entity}`);
      console.log(`   ✅ Display Name: ${parsed.displayName}`);
      console.log(`   ✅ Relationships: ${parsed.relationship_summary.total_relationships}`);
      console.log(`   ✅ Workflows: ${parsed.relationship_summary.total_workflows}`);

      console.log('   ✅ TEST PASSED\n');
    } catch (error) {
      console.error(`   ❌ TEST FAILED: ${(error as Error).message}\n`);
      throw error;
    }
  }

  async testGetEndpointDocumentation(): Promise<void> {
    console.log('🧪 Testing: get_endpoint_documentation');
    console.log('='.repeat(80));

    try {
      const args = {
        operation_id: 'listCustomers',
      };

      console.log(`   Args: ${JSON.stringify(args)}`);

      const result = await this.toolGetEndpointDocumentation(args);
      const parsed = JSON.parse(result);

      console.log(`   ✅ Operation ID: ${parsed.operation_id}`);
      console.log(`   ✅ Entity: ${parsed.entity}`);
      console.log(`   ✅ Method: ${parsed.method}`);
      console.log(`   ✅ Path: ${parsed.path}`);
      console.log(`   ✅ Risk Level: ${parsed.risk_level}`);

      console.log('   ✅ TEST PASSED\n');
    } catch (error) {
      console.error(`   ❌ TEST FAILED: ${(error as Error).message}\n`);
      throw error;
    }
  }

  // Tool implementations (copied from DirectAgentService)
  private async toolSearchEntityOperations(args: Record<string, unknown>): Promise<string> {
    const indexPath = path.join(this.mcpDataPath, 'bc_index.json');
    const content = fs.readFileSync(indexPath, 'utf8');
    const index = JSON.parse(content);

    const keyword = (args.keyword as string || '').toLowerCase();
    const filterByRisk = args.filter_by_risk as string | undefined;
    const filterByOperationType = args.filter_by_operation_type as string | undefined;

    const results: Record<string, unknown>[] = [];

    for (const entitySummary of index.entities) {
      const matches =
        entitySummary.name.toLowerCase().includes(keyword) ||
        entitySummary.displayName.toLowerCase().includes(keyword) ||
        (entitySummary.description && entitySummary.description.toLowerCase().includes(keyword));

      if (!matches) continue;

      const entityPath = path.join(this.mcpDataPath, 'entities', `${entitySummary.name}.json`);
      const entityContent = fs.readFileSync(entityPath, 'utf8');
      const entity = JSON.parse(entityContent);

      let matchingOps = entity.endpoints || [];

      if (filterByRisk) {
        matchingOps = matchingOps.filter((ep: Record<string, unknown>) => ep.riskLevel === filterByRisk);
      }
      if (filterByOperationType) {
        matchingOps = matchingOps.filter((ep: Record<string, unknown>) => ep.operationType === filterByOperationType);
      }

      if (matchingOps.length > 0) {
        results.push({
          entity: entity.entity,
          displayName: entity.displayName,
          description: entity.description,
          matching_operations: matchingOps.map((ep: Record<string, unknown>) => ({
            operation_id: ep.id,
            method: ep.method,
            summary: ep.summary,
            operation_type: ep.operationType,
            risk_level: ep.riskLevel,
          })),
        });
      }
    }

    const result = {
      total_matches: results.length,
      keyword: keyword,
      filters: {
        risk_level: filterByRisk || 'none',
        operation_type: filterByOperationType || 'none',
      },
      results: results,
    };

    return JSON.stringify(result, null, 2);
  }

  private async toolGetEntityRelationships(args: Record<string, unknown>): Promise<string> {
    const entityName = args.entity_name as string;
    const entityPath = path.join(this.mcpDataPath, 'entities', `${entityName}.json`);

    if (!fs.existsSync(entityPath)) {
      throw new Error(`Entity ${entityName} not found`);
    }

    const content = fs.readFileSync(entityPath, 'utf8');
    const entity = JSON.parse(content);

    const result = {
      entity: entity.entity,
      displayName: entity.displayName,
      description: entity.description,
      relationships: entity.relationships || [],
      common_workflows: entity.commonWorkflows || [],
      relationship_summary: {
        total_relationships: (entity.relationships || []).length,
        total_workflows: (entity.commonWorkflows || []).length,
        related_entities: (entity.relationships || []).map((r: Record<string, unknown>) => r.entity),
      },
    };

    return JSON.stringify(result, null, 2);
  }

  private async toolGetEndpointDocumentation(args: Record<string, unknown>): Promise<string> {
    const operationId = args.operation_id as string;

    if (!operationId) {
      throw new Error('operation_id is required');
    }

    const indexPath = path.join(this.mcpDataPath, 'bc_index.json');
    const indexContent = fs.readFileSync(indexPath, 'utf8');
    const index = JSON.parse(indexContent);

    const entityName = index.operationIndex[operationId];

    if (!entityName) {
      throw new Error(`Operation ID "${operationId}" not found`);
    }

    const entityPath = path.join(this.mcpDataPath, 'entities', `${entityName}.json`);
    const entityContent = fs.readFileSync(entityPath, 'utf8');
    const entity = JSON.parse(entityContent);

    const endpoint = entity.endpoints.find((ep: Record<string, unknown>) => ep.id === operationId);

    if (!endpoint) {
      throw new Error(`Operation "${operationId}" not found in entity "${entityName}"`);
    }

    const result = {
      operation_id: endpoint.id,
      entity: entityName,
      entity_display_name: entity.displayName,
      method: endpoint.method,
      path: endpoint.path,
      summary: endpoint.summary,
      operation_type: endpoint.operationType,
      risk_level: endpoint.riskLevel,
      requires_auth: endpoint.requiresAuth,
      requires_approval: endpoint.requiresHumanApproval,
      destructive: endpoint.destructive,
      warning_message: endpoint.warningMessage,
      path_parameters: endpoint.pathParams || [],
      query_parameters: endpoint.queryParams || [],
      headers: endpoint.headers || [],
      required_fields: endpoint.requiredFields || [],
      optional_fields: endpoint.optionalFields || [],
      selectable_fields: endpoint.selectableFields || [],
      expandable_relations: endpoint.expandableRelations || [],
      success_status: endpoint.successStatus,
      error_codes: endpoint.errorCodes || [],
      request_body_schema: endpoint.requestBodySchema,
      response_schema: endpoint.responseSchema,
    };

    return JSON.stringify(result, null, 2);
  }
}

async function runTests(): Promise<void> {
  console.log('🧪 Testing MCP Tool Implementations Directly\n');

  const tester = new ToolTester();
  let passedCount = 0;
  let totalCount = 0;

  const tests = [
    { name: 'search_entity_operations', fn: () => tester.testSearchEntityOperations() },
    { name: 'get_entity_relationships', fn: () => tester.testGetEntityRelationships() },
    { name: 'get_endpoint_documentation', fn: () => tester.testGetEndpointDocumentation() },
  ];

  for (const test of tests) {
    totalCount++;
    try {
      await test.fn();
      passedCount++;
    } catch (error) {
      console.error(`   Error: ${(error as Error).message}\n`);
    }
  }

  console.log('='.repeat(80));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(80));
  console.log(`\nTotal: ${passedCount}/${totalCount} tests passed\n`);

  if (passedCount === totalCount) {
    console.log('✅ All MCP tool implementations are working correctly!');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed.');
    process.exit(1);
  }
}

runTests();
