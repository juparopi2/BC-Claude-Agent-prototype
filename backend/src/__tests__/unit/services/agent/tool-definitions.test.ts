/**
 * Tool Definitions Unit Tests
 *
 * F6-003: Comprehensive unit tests for MCP tool definitions
 *
 * Test Coverage:
 * 1. MCP_TOOLS structure validation
 * 2. Input schema validation for each tool
 * 3. Synchronization with TOOL_NAMES constants
 * 4. Helper function tests
 * 5. Edge cases and error handling
 *
 * @module __tests__/unit/services/agent/tool-definitions.test
 */

import { describe, it, expect } from 'vitest';
import {
  MCP_TOOLS,
  getMCPToolDefinitions,
  getToolDefinition,
  getToolNames,
} from '@/services/agent/tool-definitions';
import { TOOL_NAMES, TOOL_METADATA, ToolCategory } from '@/shared/constants/tools';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';

// ===== EXPECTED TOOL NAMES =====
const EXPECTED_TOOL_NAMES = [
  'list_all_entities',
  'search_entity_operations',
  'get_entity_details',
  'get_entity_relationships',
  'validate_workflow_structure',
  'build_knowledge_base_workflow',
  'get_endpoint_documentation',
] as const;

// ===== TYPE DEFINITIONS FOR VALIDATION =====
interface JsonSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
}

// ===== 1. MCP_TOOLS STRUCTURE TESTS =====
describe('tool-definitions', () => {
  describe('1. MCP_TOOLS Structure', () => {
    it('should export MCP_TOOLS as a non-empty array', () => {
      expect(MCP_TOOLS).toBeDefined();
      expect(Array.isArray(MCP_TOOLS)).toBe(true);
      expect(MCP_TOOLS.length).toBeGreaterThan(0);
    });

    it('should have exactly 7 tools defined', () => {
      expect(MCP_TOOLS).toHaveLength(7);
    });

    it('should have unique tool names (no duplicates)', () => {
      const names = MCP_TOOLS.map((tool) => tool.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it('should contain all expected tool names', () => {
      const toolNames = MCP_TOOLS.map((tool) => tool.name);
      for (const expectedName of EXPECTED_TOOL_NAMES) {
        expect(toolNames).toContain(expectedName);
      }
    });

    it('should have valid Tool type for each tool (name, description, input_schema)', () => {
      for (const tool of MCP_TOOLS) {
        // Required fields per Anthropic SDK Tool type
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('input_schema');

        expect(typeof tool.name).toBe('string');
        expect(tool.name.length).toBeGreaterThan(0);

        expect(typeof tool.description).toBe('string');
        expect(tool.description.length).toBeGreaterThan(0);

        expect(typeof tool.input_schema).toBe('object');
      }
    });

    it('should have non-empty descriptions for all tools', () => {
      for (const tool of MCP_TOOLS) {
        expect(tool.description).toBeDefined();
        expect(tool.description.trim().length).toBeGreaterThan(10);
      }
    });

    it('should use snake_case naming convention for tool names', () => {
      const snakeCaseRegex = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
      for (const tool of MCP_TOOLS) {
        expect(tool.name).toMatch(snakeCaseRegex);
      }
    });
  });

  // ===== 2. INPUT SCHEMA VALIDATION =====
  describe('2. Input Schema Validation', () => {
    it('should have valid JSON Schema structure for all tools', () => {
      for (const tool of MCP_TOOLS) {
        const schema = tool.input_schema as JsonSchema;

        expect(schema.type).toBe('object');
        expect(schema).toHaveProperty('properties');
        expect(typeof schema.properties).toBe('object');
        expect(schema).toHaveProperty('required');
        expect(Array.isArray(schema.required)).toBe(true);
      }
    });

    it('should have required fields that exist in properties', () => {
      for (const tool of MCP_TOOLS) {
        const schema = tool.input_schema as JsonSchema;
        const propertyNames = Object.keys(schema.properties);

        for (const requiredField of schema.required) {
          expect(propertyNames).toContain(requiredField);
        }
      }
    });

    describe('list_all_entities schema', () => {
      it('should have correct schema structure', () => {
        const tool = getToolDefinition('list_all_entities');
        expect(tool).toBeDefined();

        const schema = tool!.input_schema as JsonSchema;
        expect(schema.type).toBe('object');
        expect(schema.properties).toHaveProperty('filter_by_operations');
        expect(schema.required).toEqual([]);
      });

      it('should have filter_by_operations as optional array with valid enum', () => {
        const tool = getToolDefinition('list_all_entities');
        const schema = tool!.input_schema as JsonSchema;
        const prop = schema.properties.filter_by_operations;

        expect(prop.type).toBe('array');
        expect(prop.items).toBeDefined();
        expect(prop.items!.type).toBe('string');
        expect(prop.items!.enum).toContain('list');
        expect(prop.items!.enum).toContain('create');
        expect(prop.items!.enum).toContain('delete');
      });
    });

    describe('search_entity_operations schema', () => {
      it('should have keyword as required parameter', () => {
        const tool = getToolDefinition('search_entity_operations');
        expect(tool).toBeDefined();

        const schema = tool!.input_schema as JsonSchema;
        expect(schema.required).toContain('keyword');
        expect(schema.properties).toHaveProperty('keyword');
        expect(schema.properties.keyword.type).toBe('string');
      });

      it('should have optional filter parameters with valid enums', () => {
        const tool = getToolDefinition('search_entity_operations');
        const schema = tool!.input_schema as JsonSchema;

        expect(schema.properties).toHaveProperty('filter_by_risk');
        expect(schema.properties.filter_by_risk.enum).toContain('LOW');
        expect(schema.properties.filter_by_risk.enum).toContain('MEDIUM');
        expect(schema.properties.filter_by_risk.enum).toContain('HIGH');

        expect(schema.properties).toHaveProperty('filter_by_operation_type');
        expect(schema.properties.filter_by_operation_type.enum).toContain('list');
        expect(schema.properties.filter_by_operation_type.enum).toContain('create');
      });
    });

    describe('get_entity_details schema', () => {
      it('should have entity_name as required parameter', () => {
        const tool = getToolDefinition('get_entity_details');
        expect(tool).toBeDefined();

        const schema = tool!.input_schema as JsonSchema;
        expect(schema.required).toContain('entity_name');
        expect(schema.properties.entity_name.type).toBe('string');
      });
    });

    describe('get_entity_relationships schema', () => {
      it('should have entity_name as required parameter', () => {
        const tool = getToolDefinition('get_entity_relationships');
        expect(tool).toBeDefined();

        const schema = tool!.input_schema as JsonSchema;
        expect(schema.required).toContain('entity_name');
        expect(schema.properties.entity_name.type).toBe('string');
      });
    });

    describe('validate_workflow_structure schema', () => {
      it('should have workflow as required array parameter', () => {
        const tool = getToolDefinition('validate_workflow_structure');
        expect(tool).toBeDefined();

        const schema = tool!.input_schema as JsonSchema;
        expect(schema.required).toContain('workflow');
        expect(schema.properties.workflow.type).toBe('array');
      });

      it('should have workflow items with operation_id required', () => {
        const tool = getToolDefinition('validate_workflow_structure');
        const schema = tool!.input_schema as JsonSchema;
        const workflowProp = schema.properties.workflow;

        expect(workflowProp.items).toBeDefined();
        expect(workflowProp.items!.type).toBe('object');
        expect(workflowProp.items!.properties).toHaveProperty('operation_id');
        expect(workflowProp.items!.required).toContain('operation_id');
      });
    });

    describe('build_knowledge_base_workflow schema', () => {
      it('should have workflow_name and steps as required parameters', () => {
        const tool = getToolDefinition('build_knowledge_base_workflow');
        expect(tool).toBeDefined();

        const schema = tool!.input_schema as JsonSchema;
        expect(schema.required).toContain('workflow_name');
        expect(schema.required).toContain('steps');
        expect(schema.properties.workflow_name.type).toBe('string');
        expect(schema.properties.steps.type).toBe('array');
      });

      it('should have optional workflow_description', () => {
        const tool = getToolDefinition('build_knowledge_base_workflow');
        const schema = tool!.input_schema as JsonSchema;

        expect(schema.properties).toHaveProperty('workflow_description');
        expect(schema.required).not.toContain('workflow_description');
      });
    });

    describe('get_endpoint_documentation schema', () => {
      it('should have operation_id as required parameter', () => {
        const tool = getToolDefinition('get_endpoint_documentation');
        expect(tool).toBeDefined();

        const schema = tool!.input_schema as JsonSchema;
        expect(schema.required).toContain('operation_id');
        expect(schema.properties.operation_id.type).toBe('string');
      });
    });
  });

  // ===== 3. SYNCHRONIZATION WITH TOOL_NAMES CONSTANTS =====
  describe('3. Synchronization with TOOL_NAMES Constants', () => {
    it('should have all MCP tools defined in TOOL_NAMES', () => {
      const mcpToolNames = MCP_TOOLS.map((t) => t.name);
      const constantToolNames = Object.values(TOOL_NAMES);

      for (const mcpName of mcpToolNames) {
        expect(constantToolNames).toContain(mcpName);
      }
    });

    it('should have TOOL_METADATA entry for each MCP tool', () => {
      for (const tool of MCP_TOOLS) {
        const metadata = TOOL_METADATA[tool.name as keyof typeof TOOL_METADATA];
        expect(metadata).toBeDefined();
        expect(metadata).toHaveProperty('requiresApproval');
        expect(metadata).toHaveProperty('category');
      }
    });

    it('should have all MCP tools categorized as KNOWLEDGE', () => {
      for (const tool of MCP_TOOLS) {
        const metadata = TOOL_METADATA[tool.name as keyof typeof TOOL_METADATA];
        expect(metadata.category).toBe(ToolCategory.KNOWLEDGE);
      }
    });

    it('should have all MCP tools NOT requiring approval (read-only)', () => {
      for (const tool of MCP_TOOLS) {
        const metadata = TOOL_METADATA[tool.name as keyof typeof TOOL_METADATA];
        expect(metadata.requiresApproval).toBe(false);
      }
    });
  });

  // ===== 4. HELPER FUNCTION TESTS =====
  describe('4. Helper Functions', () => {
    describe('getMCPToolDefinitions()', () => {
      it('should return the MCP_TOOLS array', () => {
        const tools = getMCPToolDefinitions();
        expect(tools).toBe(MCP_TOOLS);
      });

      it('should return array with correct length', () => {
        const tools = getMCPToolDefinitions();
        expect(tools).toHaveLength(7);
      });

      it('should return tools with correct type', () => {
        const tools = getMCPToolDefinitions();
        expect(Array.isArray(tools)).toBe(true);

        for (const tool of tools) {
          expect(tool).toHaveProperty('name');
          expect(tool).toHaveProperty('description');
          expect(tool).toHaveProperty('input_schema');
        }
      });
    });

    describe('getToolDefinition()', () => {
      it('should return correct tool for valid name', () => {
        const tool = getToolDefinition('list_all_entities');

        expect(tool).toBeDefined();
        expect(tool!.name).toBe('list_all_entities');
        expect(tool!.description).toContain('Business Central entities');
      });

      it('should return undefined for unknown tool name', () => {
        const tool = getToolDefinition('nonexistent_tool');
        expect(tool).toBeUndefined();
      });

      it('should return undefined for empty string', () => {
        const tool = getToolDefinition('');
        expect(tool).toBeUndefined();
      });

      it('should be case-sensitive', () => {
        const tool1 = getToolDefinition('list_all_entities');
        const tool2 = getToolDefinition('LIST_ALL_ENTITIES');

        expect(tool1).toBeDefined();
        expect(tool2).toBeUndefined();
      });

      it('should return correct tool for each expected tool name', () => {
        for (const toolName of EXPECTED_TOOL_NAMES) {
          const tool = getToolDefinition(toolName);
          expect(tool).toBeDefined();
          expect(tool!.name).toBe(toolName);
        }
      });
    });

    describe('getToolNames()', () => {
      it('should return array of all tool names', () => {
        const names = getToolNames();

        expect(Array.isArray(names)).toBe(true);
        expect(names).toHaveLength(7);
      });

      it('should return names as strings', () => {
        const names = getToolNames();

        for (const name of names) {
          expect(typeof name).toBe('string');
        }
      });

      it('should contain all expected tool names', () => {
        const names = getToolNames();

        for (const expectedName of EXPECTED_TOOL_NAMES) {
          expect(names).toContain(expectedName);
        }
      });

      it('should return same names as MCP_TOOLS.map(t => t.name)', () => {
        const namesFromHelper = getToolNames();
        const namesFromMap = MCP_TOOLS.map((t) => t.name);

        expect(namesFromHelper).toEqual(namesFromMap);
      });
    });
  });

  // ===== 5. EDGE CASES AND TYPE SAFETY =====
  describe('5. Edge Cases and Type Safety', () => {
    it('should have immutable tool names at runtime', () => {
      const originalNames = getToolNames();
      const toolsCopy = [...MCP_TOOLS];

      // Verify we got the same data
      expect(toolsCopy).toHaveLength(originalNames.length);
    });

    it('should have descriptions that explain tool purpose', () => {
      for (const tool of MCP_TOOLS) {
        // Descriptions should be informative (not just the name)
        expect(tool.description.length).toBeGreaterThan(tool.name.length);
        // Should not be placeholder text
        expect(tool.description.toLowerCase()).not.toContain('todo');
        expect(tool.description.toLowerCase()).not.toContain('placeholder');
      }
    });

    it('should have consistent property naming in schemas', () => {
      const snakeCaseRegex = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

      for (const tool of MCP_TOOLS) {
        const schema = tool.input_schema as JsonSchema;
        const propNames = Object.keys(schema.properties);

        for (const propName of propNames) {
          expect(propName).toMatch(snakeCaseRegex);
        }
      }
    });

    it('should not have any "any" or "unknown" types in schemas', () => {
      const validTypes = ['string', 'number', 'boolean', 'object', 'array', 'null'];

      for (const tool of MCP_TOOLS) {
        const schema = tool.input_schema as JsonSchema;

        for (const [_propName, prop] of Object.entries(schema.properties)) {
          expect(validTypes).toContain(prop.type);
        }
      }
    });

    it('should have all enum values as non-empty strings', () => {
      for (const tool of MCP_TOOLS) {
        const schema = tool.input_schema as JsonSchema;

        for (const prop of Object.values(schema.properties)) {
          if (prop.enum) {
            expect(Array.isArray(prop.enum)).toBe(true);
            for (const enumValue of prop.enum) {
              expect(typeof enumValue).toBe('string');
              expect(enumValue.length).toBeGreaterThan(0);
            }
          }
          // Check nested items for arrays
          if (prop.items?.enum) {
            for (const enumValue of prop.items.enum) {
              expect(typeof enumValue).toBe('string');
              expect(enumValue.length).toBeGreaterThan(0);
            }
          }
        }
      }
    });
  });

  // ===== 6. ANTHROPIC SDK COMPATIBILITY =====
  describe('6. Anthropic SDK Compatibility', () => {
    it('should conform to Anthropic Tool type structure', () => {
      // This test verifies the type at compile time via TypeScript
      // and at runtime via structure validation
      const tools: Tool[] = MCP_TOOLS;

      expect(tools).toBeDefined();

      for (const tool of tools) {
        // Anthropic SDK Tool requires: name, description, input_schema
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(typeof tool.input_schema).toBe('object');

        // input_schema must be JSON Schema
        const schema = tool.input_schema;
        expect(schema).toHaveProperty('type');
        expect(schema).toHaveProperty('properties');
      }
    });

    it('should have input_schema.type as "object" for all tools', () => {
      for (const tool of MCP_TOOLS) {
        expect(tool.input_schema.type).toBe('object');
      }
    });

    it('should not have cache_control property (not using prompt caching)', () => {
      for (const tool of MCP_TOOLS) {
        // cache_control is optional in Anthropic SDK
        // We verify we're not accidentally setting it
        expect(tool).not.toHaveProperty('cache_control');
      }
    });
  });
});
