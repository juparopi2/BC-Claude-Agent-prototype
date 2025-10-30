/**
 * MCP (Model Context Protocol) Type Definitions
 *
 * Types for MCP server configuration, tool definitions, and responses.
 * Used with Claude Agent SDK's built-in MCP integration.
 */

/**
 * MCP Server Configuration for Agent SDK
 * Defines how the Agent SDK connects to an MCP server
 */
export interface MCPServerConfig {
  /** Transport type - 'sse' for Server-Sent Events (HTTP), 'stdio' for standard I/O */
  type: 'sse' | 'stdio';
  /** URL of the MCP server (for SSE transport) */
  url: string;
  /** Human-readable name for the MCP server */
  name: string;
  /** Optional authentication headers */
  headers?: Record<string, string>;
}

/**
 * MCP Tool Definition
 * Represents a tool available from the MCP server
 */
export interface MCPTool {
  /** Unique tool name (e.g., 'bc_query_entity') */
  name: string;
  /** Human-readable description of what the tool does */
  description: string;
  /** JSON Schema defining the tool's input parameters */
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * MCP Tool Call
 * Represents a request to execute an MCP tool
 */
export interface MCPToolCall {
  /** Name of the tool to call */
  name: string;
  /** Arguments to pass to the tool */
  arguments: Record<string, unknown>;
}

/**
 * MCP Tool Result
 * Represents the response from an MCP tool execution
 */
export interface MCPToolResult {
  /** Whether the tool execution succeeded */
  success: boolean;
  /** Result data if successful */
  data?: unknown;
  /** Error message if failed */
  error?: string;
  /** Additional metadata */
  metadata?: {
    duration_ms?: number;
    tokens_used?: number;
  };
}

/**
 * MCP Resource
 * Represents a resource available from the MCP server
 */
export interface MCPResource {
  /** Resource URI (e.g., 'bc://schemas/Customer') */
  uri: string;
  /** Resource name */
  name: string;
  /** Resource description */
  description: string;
  /** MIME type of the resource */
  mimeType: string;
}

/**
 * MCP Prompt
 * Represents a prompt template available from the MCP server
 */
export interface MCPPrompt {
  /** Unique prompt name */
  name: string;
  /** Prompt description */
  description: string;
  /** Prompt arguments */
  arguments?: {
    name: string;
    description: string;
    required: boolean;
  }[];
}

/**
 * MCP Health Status
 * Health check result for MCP server connection
 */
export interface MCPHealthStatus {
  /** Is MCP server reachable */
  connected: boolean;
  /** Number of tools available */
  toolCount?: number;
  /** Error message if not connected */
  error?: string;
  /** Last successful connection timestamp */
  lastConnected?: Date;
}
