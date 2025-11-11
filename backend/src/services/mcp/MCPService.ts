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
   * Performs a simple health check to verify the MCP server is reachable.
   * Uses GET request compatible with SSE endpoints instead of JSON-RPC POST.
   *
   * Note: This is a lightweight health check. The actual MCP handshake happens
   * when the Agent SDK connects to the server for the first time.
   *
   * @returns Health status of MCP connection
   */
  async validateMCPConnection(): Promise<MCPHealthStatus> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // Increased to 10s for cold starts

      // Simple GET request to check endpoint availability
      // SSE endpoints typically accept GET with text/event-stream
      const response = await fetch(this.mcpServerUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream, application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Accept any 2xx status code as healthy
      // SSE endpoints may return 200 or 204
      if (response.ok) {
        return {
          connected: true,
          lastConnected: new Date(),
        };
      }

      // Some SSE endpoints return 405 for GET (expecting POST with specific headers)
      // We still consider this "reachable" - the endpoint exists
      if (response.status === 405) {
        return {
          connected: true,
          lastConnected: new Date(),
        };
      }

      return {
        connected: false,
        error: `MCP server returned status ${response.status}`,
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
