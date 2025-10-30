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
   * Validate MCP Connection
   *
   * Performs a basic health check to verify the MCP server is reachable.
   * Note: This does NOT test tool calling - use testMCPConnection.ts for that.
   *
   * @returns Health status of MCP connection
   */
  async validateMCPConnection(): Promise<MCPHealthStatus> {
    try {
      // Basic HTTP check to see if server responds
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(this.mcpServerUrl, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok || response.status === 404) {
        // 404 is OK - means server is up but endpoint might be different
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
