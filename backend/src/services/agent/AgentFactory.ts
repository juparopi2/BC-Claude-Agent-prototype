/**
 * Agent Factory
 *
 * Creates specialized agents with custom system prompts and tool restrictions.
 * Uses Agent SDK with different configurations for different purposes.
 *
 * Pattern: Each agent type is created via a factory function that returns
 * an Agent SDK query() call with specialized configuration.
 *
 * @module services/agent/AgentFactory
 */

import { query, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { ApprovalManager } from '../approval/ApprovalManager';
import {
  createReadOnlyPermissionCheck,
  createWritePermissionCheck,
} from './helpers/permissions';

/**
 * Create a Query Agent
 *
 * Specialized for reading data from Business Central.
 * - Only allows read operations (bc_get_*, bc_query_*, bc_list_*)
 * - No write permissions
 * - Optimized for data retrieval and formatting
 *
 * @param prompt - User prompt
 * @param sessionId - Session ID for context
 * @param mcpServers - MCP server configurations
 * @returns Agent SDK query result
 */
export function createQueryAgent(
  prompt: string,
  sessionId: string,
  mcpServers: Record<string, McpServerConfig>
) {
  return query({
    prompt,
    options: {
      systemPrompt: `You are a specialized Business Central Query Agent.

Your responsibilities:
- Understand user queries about Business Central data
- Construct optimal OData filters for queries
- Query BC entities via MCP tools (bc_get_*, bc_query_*, bc_list_*)
- Format results in human-readable format
- Explain data relationships and insights
- NEVER modify data - you are read-only

Available entities:
- Customers: Query customer records, filter by name, email, status
- Vendors: Query vendor records and payment terms
- Items: Query inventory items, prices, and availability
- Sales Orders: Query sales documents and line items
- Purchase Orders: Query purchase documents

Best practices:
- Use appropriate filters to narrow results
- Limit results to avoid overwhelming the user
- Format currency and dates appropriately
- Provide context for the data (e.g., "Found 5 customers matching...")`,

      mcpServers,
      resume: sessionId,
      permissionMode: 'default',
      includePartialMessages: true,

      // Use read-only permission helper
      canUseTool: createReadOnlyPermissionCheck(),
    },
  });
}

/**
 * Create a Write Agent
 *
 * Specialized for creating/updating data in Business Central.
 * - Requires approval for all write operations
 * - Validates data before writes
 * - Provides clear summaries of changes
 *
 * @param prompt - User prompt
 * @param sessionId - Session ID for context
 * @param mcpServers - MCP server configurations
 * @param approvalManager - Approval manager instance
 * @returns Agent SDK query result
 */
export function createWriteAgent(
  prompt: string,
  sessionId: string,
  mcpServers: Record<string, McpServerConfig>,
  approvalManager: ApprovalManager
) {
  return query({
    prompt,
    options: {
      systemPrompt: `You are a specialized Business Central Write Agent.

Your responsibilities:
- Validate data before creating/updating records
- Create and update BC entities via MCP tools
- ALWAYS request user approval before modifications
- Handle errors and provide clear feedback
- Never delete records without explicit confirmation
- Provide clear summaries of what will change

Critical rules:
1. ALWAYS validate required fields before requesting approval
2. ALWAYS request approval for changes (do not proceed without it)
3. Provide clear, human-readable summary of what will change
4. Handle validation errors gracefully with clear messages
5. Confirm successful writes with the user

Validation checklist (before requesting approval):
- Customer: name (required), valid email format, unique email
- Vendor: name (required), valid tax ID format
- Item: number (required), description (required), positive price

Write workflow:
1. Validate the data
2. Request approval from user
3. If approved, execute the write operation
4. Confirm success or handle errors`,

      mcpServers,
      resume: sessionId,
      permissionMode: 'default',
      includePartialMessages: true,

      // Use write permission helper with approval
      canUseTool: createWritePermissionCheck(approvalManager, sessionId),
    },
  });
}

/**
 * Create a Validation Agent
 *
 * Specialized for validating data without making changes.
 * - Read-only mode (plan mode)
 * - No tool execution
 * - Validates against BC business rules
 *
 * @param prompt - User prompt (with data to validate)
 * @param sessionId - Session ID for context
 * @param mcpServers - MCP server configurations
 * @returns Agent SDK query result
 */
export function createValidationAgent(
  prompt: string,
  sessionId: string,
  mcpServers: Record<string, McpServerConfig>
) {
  return query({
    prompt,
    options: {
      systemPrompt: `You are a Business Central Validation Agent.

Your job is to validate data against BC business rules WITHOUT making changes.

Validation rules:

Customer:
- name: Required, 1-100 characters
- email: Required, valid email format, must be unique
- phoneNumber: Optional, valid phone format
- address: Optional

Vendor:
- name: Required, 1-100 characters
- email: Optional, valid email format if provided
- taxId: Optional, valid tax ID format

Item:
- no: Required, alphanumeric, max 20 chars
- description: Required, 1-100 characters
- unitPrice: Required, must be positive number
- type: Required, one of: Inventory, Service

Return validation result in JSON format:
{
  "valid": boolean,
  "errors": string[], // Empty if valid
  "warnings": string[] // Optional warnings
}

Example:
Input: { name: "Acme", email: "invalid-email" }
Output: { "valid": false, "errors": ["Email format is invalid"], "warnings": [] }`,

      mcpServers,
      resume: sessionId,
      permissionMode: 'plan', // Read-only mode, no tool execution
      includePartialMessages: true,
    },
  });
}

/**
 * Create an Analysis Agent
 *
 * Specialized for analyzing BC data and providing insights.
 * - Read-only access
 * - Focuses on trends, patterns, and recommendations
 * - Can aggregate and compare data
 *
 * @param prompt - User prompt (analysis request)
 * @param sessionId - Session ID for context
 * @param mcpServers - MCP server configurations
 * @returns Agent SDK query result
 */
export function createAnalysisAgent(
  prompt: string,
  sessionId: string,
  mcpServers: Record<string, McpServerConfig>
) {
  return query({
    prompt,
    options: {
      systemPrompt: `You are a Business Central Analysis Agent.

Your purpose is to analyze BC data and provide insights, trends, and recommendations.

Analysis capabilities:
- Identify trends in sales, purchases, inventory
- Compare performance across time periods
- Identify top/bottom performers (customers, vendors, items)
- Detect anomalies and outliers
- Calculate key metrics (revenue, margins, turnover)
- Provide actionable recommendations

Analysis workflow:
1. Understand the analysis request
2. Query relevant BC data via MCP tools
3. Aggregate and process the data
4. Identify patterns and insights
5. Present findings in clear, structured format

Output format:
- Summary: High-level overview (2-3 sentences)
- Key Findings: Bullet points of main insights
- Data: Supporting numbers and charts
- Recommendations: Actionable next steps

Always support your insights with concrete data from BC.`,

      mcpServers,
      resume: sessionId,
      permissionMode: 'default',
      includePartialMessages: true,

      // Use read-only permission helper
      canUseTool: createReadOnlyPermissionCheck(),
    },
  });
}

// Re-export helper functions for convenience
export { isWriteOperation, isReadOperation } from './helpers/permissions';

/**
 * Get appropriate agent type for a given prompt
 *
 * Simple heuristic to determine which agent to use based on prompt keywords.
 * Can be overridden by explicit user specification.
 *
 * @param prompt - User prompt
 * @returns Suggested agent type
 */
export function suggestAgentType(prompt: string): 'query' | 'write' | 'validation' | 'analysis' {
  const lowerPrompt = prompt.toLowerCase();

  // Write keywords
  if (
    lowerPrompt.includes('create') ||
    lowerPrompt.includes('update') ||
    lowerPrompt.includes('modify') ||
    lowerPrompt.includes('change') ||
    lowerPrompt.includes('add') ||
    lowerPrompt.includes('edit')
  ) {
    return 'write';
  }

  // Analysis keywords
  if (
    lowerPrompt.includes('analyze') ||
    lowerPrompt.includes('analyse') ||
    lowerPrompt.includes('trend') ||
    lowerPrompt.includes('compare') ||
    lowerPrompt.includes('top') ||
    lowerPrompt.includes('bottom') ||
    lowerPrompt.includes('insight') ||
    lowerPrompt.includes('summary')
  ) {
    return 'analysis';
  }

  // Validation keywords
  if (
    lowerPrompt.includes('validate') ||
    lowerPrompt.includes('check') ||
    lowerPrompt.includes('verify') ||
    lowerPrompt.includes('is valid')
  ) {
    return 'validation';
  }

  // Default to query
  return 'query';
}
