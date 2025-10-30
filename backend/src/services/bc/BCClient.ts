/**
 * Business Central Client
 *
 * Direct client for Business Central API using OAuth 2.0 authentication.
 * This client is used for:
 * - Direct BC queries (validation, health checks)
 * - Schema introspection
 * - Debugging (compare with MCP results)
 *
 * For normal operations, prefer using MCP tools via Agent SDK.
 */

import { env } from '@/config';
import type {
  BCQueryOptions,
  BCApiResponse,
  BCSingleEntityResponse,
  BCApiError,
  BCOAuthTokenResponse,
  BCEntityType,
} from '@/types';

/**
 * BC Client Class
 *
 * Handles OAuth authentication and direct API calls to Business Central.
 */
export class BCClient {
  private baseUrl: string;
  private tenantId: string;
  private clientId: string;
  private clientSecret: string;

  // Token cache
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  // OAuth endpoints
  private readonly tokenEndpoint: string;
  private readonly scope = 'https://api.businesscentral.dynamics.com/.default';

  constructor() {
    this.baseUrl = env.BC_API_URL;
    this.tenantId = env.BC_TENANT_ID!;
    this.clientId = env.BC_CLIENT_ID!;
    this.clientSecret = env.BC_CLIENT_SECRET!;

    this.tokenEndpoint = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
  }

  /**
   * Authenticate with Business Central using OAuth 2.0 Client Credentials Flow
   *
   * @throws Error if authentication fails
   */
  private async authenticate(): Promise<void> {
    try {
      const response = await fetch(this.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          scope: this.scope,
          grant_type: 'client_credentials',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `OAuth authentication failed: ${response.status} - ${errorText}`
        );
      }

      const data = (await response.json()) as BCOAuthTokenResponse;

      this.accessToken = data.access_token;
      // Set expiry 5 minutes before actual expiry for safety
      const expirySeconds = data.expires_in - 300;
      this.tokenExpiry = new Date(Date.now() + expirySeconds * 1000);

      console.log(
        `[BCClient] Successfully authenticated. Token expires at ${this.tokenExpiry.toISOString()}`
      );
    } catch (error) {
      console.error('[BCClient] Authentication failed:', error);
      throw error;
    }
  }

  /**
   * Ensure we have a valid access token
   * Automatically refreshes if expired
   */
  private async ensureAuthenticated(): Promise<void> {
    if (!this.accessToken || !this.tokenExpiry) {
      await this.authenticate();
      return;
    }

    // Check if token is expired or will expire soon
    const now = new Date();
    if (now >= this.tokenExpiry) {
      console.log('[BCClient] Token expired, refreshing...');
      await this.authenticate();
    }
  }

  /**
   * Build OData URL with query parameters
   *
   * @param entity - Entity type (e.g., 'customers', 'items')
   * @param options - OData query options
   * @returns Complete URL with query parameters
   */
  private buildODataUrl(entity: string, options?: BCQueryOptions): string {
    const url = new URL(`${this.baseUrl}/${entity}`);

    if (!options) {
      return url.toString();
    }

    if (options.filter) {
      url.searchParams.set('$filter', options.filter);
    }

    if (options.select && options.select.length > 0) {
      url.searchParams.set('$select', options.select.join(','));
    }

    if (options.expand && options.expand.length > 0) {
      url.searchParams.set('$expand', options.expand.join(','));
    }

    if (options.orderBy) {
      url.searchParams.set('$orderby', options.orderBy);
    }

    if (options.top !== undefined) {
      url.searchParams.set('$top', options.top.toString());
    }

    if (options.skip !== undefined) {
      url.searchParams.set('$skip', options.skip.toString());
    }

    if (options.count) {
      url.searchParams.set('$count', 'true');
    }

    return url.toString();
  }

  /**
   * Parse BC API error response
   *
   * @param response - Fetch response object
   * @returns Formatted error message
   */
  private async parseError(response: Response): Promise<string> {
    try {
      const errorData = (await response.json()) as BCApiError;
      const message = errorData.error.message;
      const code = errorData.error.code;
      return `BC API Error [${code}]: ${message}`;
    } catch {
      // If parsing fails, return generic error
      return `BC API Error: ${response.status} ${response.statusText}`;
    }
  }

  /**
   * Query BC Entities with OData
   *
   * @param entity - Entity type
   * @param options - Query options (filter, select, etc.)
   * @returns API response with array of entities
   *
   * @example
   * ```typescript
   * const bcClient = new BCClient();
   *
   * // Get all customers
   * const customers = await bcClient.query('customers');
   *
   * // Get customers with filter
   * const activeCustomers = await bcClient.query('customers', {
   *   filter: "blocked eq ''",
   *   select: ['id', 'displayName', 'email'],
   *   top: 10,
   * });
   * ```
   */
  async query<T = unknown>(
    entity: BCEntityType,
    options?: BCQueryOptions
  ): Promise<BCApiResponse<T>> {
    await this.ensureAuthenticated();

    const url = this.buildODataUrl(entity, options);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errorMessage = await this.parseError(response);
        throw new Error(errorMessage);
      }

      return (await response.json()) as BCApiResponse<T>;
    } catch (error) {
      console.error(`[BCClient] Query failed for ${entity}:`, error);
      throw error;
    }
  }

  /**
   * Get a single entity by ID
   *
   * @param entity - Entity type
   * @param id - Entity ID (GUID)
   * @returns Single entity
   *
   * @example
   * ```typescript
   * const customer = await bcClient.getById('customers', 'some-guid');
   * ```
   */
  async getById<T = unknown>(
    entity: BCEntityType,
    id: string
  ): Promise<BCSingleEntityResponse<T>> {
    await this.ensureAuthenticated();

    const url = `${this.baseUrl}/${entity}(${id})`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errorMessage = await this.parseError(response);
        throw new Error(errorMessage);
      }

      return (await response.json()) as BCSingleEntityResponse<T>;
    } catch (error) {
      console.error(`[BCClient] GetById failed for ${entity}/${id}:`, error);
      throw error;
    }
  }

  /**
   * Create a new entity
   *
   * @param entity - Entity type
   * @param data - Entity data
   * @returns Created entity
   *
   * @example
   * ```typescript
   * const newCustomer = await bcClient.create('customers', {
   *   displayName: 'Acme Corp',
   *   email: 'contact@acme.com',
   * });
   * ```
   */
  async create<T = unknown>(
    entity: BCEntityType,
    data: Partial<T>
  ): Promise<BCSingleEntityResponse<T>> {
    await this.ensureAuthenticated();

    const url = `${this.baseUrl}/${entity}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorMessage = await this.parseError(response);
        throw new Error(errorMessage);
      }

      return (await response.json()) as BCSingleEntityResponse<T>;
    } catch (error) {
      console.error(`[BCClient] Create failed for ${entity}:`, error);
      throw error;
    }
  }

  /**
   * Update an existing entity
   *
   * @param entity - Entity type
   * @param id - Entity ID
   * @param data - Updated data
   * @param etag - Optional ETag for concurrency control
   * @returns Updated entity
   *
   * @example
   * ```typescript
   * const updated = await bcClient.update('customers', 'some-guid', {
   *   email: 'newemail@acme.com',
   * });
   * ```
   */
  async update<T = unknown>(
    entity: BCEntityType,
    id: string,
    data: Partial<T>,
    etag?: string
  ): Promise<BCSingleEntityResponse<T>> {
    await this.ensureAuthenticated();

    const url = `${this.baseUrl}/${entity}(${id})`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (etag) {
      headers['If-Match'] = etag;
    }

    try {
      const response = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorMessage = await this.parseError(response);
        throw new Error(errorMessage);
      }

      return (await response.json()) as BCSingleEntityResponse<T>;
    } catch (error) {
      console.error(`[BCClient] Update failed for ${entity}/${id}:`, error);
      throw error;
    }
  }

  /**
   * Delete an entity
   *
   * @param entity - Entity type
   * @param id - Entity ID
   * @param etag - Optional ETag for concurrency control
   *
   * @example
   * ```typescript
   * await bcClient.delete('customers', 'some-guid');
   * ```
   */
  async delete(
    entity: BCEntityType,
    id: string,
    etag?: string
  ): Promise<void> {
    await this.ensureAuthenticated();

    const url = `${this.baseUrl}/${entity}(${id})`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
    };

    if (etag) {
      headers['If-Match'] = etag;
    }

    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers,
      });

      if (!response.ok) {
        const errorMessage = await this.parseError(response);
        throw new Error(errorMessage);
      }
    } catch (error) {
      console.error(`[BCClient] Delete failed for ${entity}/${id}:`, error);
      throw error;
    }
  }

  /**
   * Get entity schema/metadata
   *
   * @param entity - Entity type
   * @returns Entity metadata
   *
   * @example
   * ```typescript
   * const schema = await bcClient.getEntitySchema('customers');
   * console.log('Available fields:', schema);
   * ```
   */
  async getEntitySchema(entity: BCEntityType): Promise<unknown> {
    await this.ensureAuthenticated();

    const url = `${this.baseUrl}/$metadata#${entity}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errorMessage = await this.parseError(response);
        throw new Error(errorMessage);
      }

      return await response.json();
    } catch (error) {
      console.error(
        `[BCClient] Get schema failed for ${entity}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Validate BC credentials and connectivity
   *
   * @returns True if authentication succeeds
   *
   * @example
   * ```typescript
   * const isValid = await bcClient.validateCredentials();
   * if (isValid) {
   *   console.log('BC credentials are valid');
   * }
   * ```
   */
  async validateCredentials(): Promise<boolean> {
    try {
      await this.authenticate();
      return true;
    } catch (error) {
      console.error('[BCClient] Credential validation failed:', error);
      return false;
    }
  }

  /**
   * Test connection to BC API
   *
   * Attempts to query a simple entity to verify end-to-end connectivity
   *
   * @returns True if connection test succeeds
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.ensureAuthenticated();

      // Try to query customers with a limit of 1
      const url = this.buildODataUrl('customers', { top: 1 });

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });

      return response.ok;
    } catch (error) {
      console.error('[BCClient] Connection test failed:', error);
      return false;
    }
  }

  /**
   * Clear cached token (force re-authentication on next call)
   */
  clearTokenCache(): void {
    this.accessToken = null;
    this.tokenExpiry = null;
    console.log('[BCClient] Token cache cleared');
  }

  /**
   * Get current token status
   *
   * @returns Token info or null if not authenticated
   */
  getTokenStatus(): { hasToken: boolean; expiresAt: Date | null } {
    return {
      hasToken: this.accessToken !== null,
      expiresAt: this.tokenExpiry,
    };
  }
}

// Singleton instance
let bcClientInstance: BCClient | null = null;

/**
 * Get BC Client Singleton Instance
 *
 * @returns The shared BCClient instance
 */
export function getBCClient(): BCClient {
  if (!bcClientInstance) {
    bcClientInstance = new BCClient();
  }
  return bcClientInstance;
}
