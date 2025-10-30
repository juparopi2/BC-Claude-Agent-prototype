/**
 * MCP Service
 *
 * Provides configuration and utilities for connecting to the MCP server
 * via Claude Agent SDK. Does NOT create manual MCP connections - the SDK
 * handles all MCP interactions automatically.
 */

import { env } from '@/config';
import type { MCPServerConfig, MCPHealthStatus } from '@/types';

/**
 * MCP Service Class
 *
 * Provides:
 * - MCP server configuration for Agent SDK
 * - Health check utilities
 * - Connection validation
 */
export class MCPService {
  private mcpServerUrl: string;
  private serverName: string = 'bc-mcp';

  constructor() {
    this.mcpServerUrl = env.MCP_SERVER_URL;
  }

  /**
   * Get MCP Server Configuration for Agent SDK
   *
   * This configuration is passed to the Agent SDK's query() function
   * to enable automatic MCP tool discovery and calling.
   *
   * @example
   * ```typescript
   * const mcpService = new MCPService();
   * const config = mcpService.getMCPServerConfig();
   *
   * const result = query(prompt, {
   *   mcpServers: [config],
   * });
   * ```
   */
  getMCPServerConfig(): MCPServerConfig {
    return {
      type: 'sse', // Server-Sent Events transport
      url: this.mcpServerUrl,
      name: this.serverName,
    };
  }

  /**
   * Get MCP Servers Configuration for Agent SDK (Record format)
   *
   * Returns MCP configuration in the format expected by @anthropic-ai/claude-agent-sdk
   * Uses a record mapping server names to configurations.
   *
   * @example
   * ```typescript
   * import { query } from '@anthropic-ai/claude-agent-sdk';
   *
   * const mcpService = getMCPService();
   * const result = await query({
   *   prompt: 'List customers',
   *   options: {
   *     mcpServers: mcpService.getMCPServersConfig(),
   *     apiKey: process.env.ANTHROPIC_API_KEY,
   *   }
   * });
   * ```
   */
  getMCPServersConfig(): Record<
    string,
    {
      type: 'sse';
      url: string;
      headers?: Record<string, string>;
    }
  > {
    return {
      [this.serverName]: {
        type: 'sse',
        url: this.mcpServerUrl,
        headers: {
          'Accept': 'application/json, text/event-stream',
        },
      },
    };
  }

  /**
   * Validate MCP Connection
   *
   * Performs a proper MCP handshake to verify the server is reachable and responding correctly.
   * Sends an MCP initialize message as per the JSON-RPC 2.0 protocol.
   *
   * @returns Health status of MCP connection
   */
  async validateMCPConnection(): Promise<MCPHealthStatus> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      // Send MCP initialize message (JSON-RPC 2.0)
      const response = await fetch(this.mcpServerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
              name: 'bc-claude-agent',
              version: '1.0.0',
            },
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          connected: false,
          error: `MCP server returned status ${response.status}`,
        };
      }

      // Parse JSON-RPC response
      const data = (await response.json()) as {
        result?: {
          protocolVersion?: string;
          serverInfo?: {
            name?: string;
            version?: string;
          };
          capabilities?: unknown;
        };
        error?: {
          code: number;
          message: string;
        };
      };

      if (data.error) {
        return {
          connected: false,
          error: `MCP error: ${data.error.message}`,
        };
      }

      if (data.result && data.result.serverInfo) {
        return {
          connected: true,
          lastConnected: new Date(),
        };
      }

      return {
        connected: false,
        error: 'Invalid MCP response format',
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      return {
        connected: false,
        error: `Failed to connect to MCP server: ${errorMessage}`,
      };
    }
  }

  /**
   * Get MCP Server URL
   *
   * @returns The configured MCP server URL
   */
  getMCPServerUrl(): string {
    return this.mcpServerUrl;
  }

  /**
   * Get MCP Server Name
   *
   * @returns The human-readable name for the MCP server
   */
  getMCPServerName(): string {
    return this.serverName;
  }

  /**
   * Check if MCP is configured
   *
   * @returns True if MCP_SERVER_URL is set
   */
  isConfigured(): boolean {
    return Boolean(this.mcpServerUrl && this.mcpServerUrl.length > 0);
  }
}

// Singleton instance
let mcpServiceInstance: MCPService | null = null;

/**
 * Get MCP Service Singleton Instance
 *
 * @returns The shared MCPService instance
 */
export function getMCPService(): MCPService {
  if (!mcpServiceInstance) {
    mcpServiceInstance = new MCPService();
  }
  return mcpServiceInstance;
}
