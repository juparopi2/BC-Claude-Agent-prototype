/**
 * BCClient Unit Tests
 *
 * Tests for Business Central client OAuth authentication,
 * OData query building, CRUD operations, and error handling.
 *
 * Created: 2025-11-19 (Phase 3, Task 3.3)
 *
 * Test Coverage:
 * - OAuth Authentication (6 tests)
 * - OData Query Building (5 tests)
 * - CRUD Operations (8 tests)
 * - Error Handling (6 tests)
 * - Schema & Connection (3 tests)
 *
 * Total: 28 tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../../mocks/server';
import { BC_API_BASE_URL } from '../../../mocks/handlers';
import { BCClient, getBCClient } from '@/services/bc/BCClient';
import type {
  BCApiResponse,
  BCSingleEntityResponse,
  BCApiError,
  BCOAuthTokenResponse,
  BCCustomer,
} from '@/types/bc.types';

// Mock env config - Note: BCClient imports from @/infrastructure/config
vi.mock('@/infrastructure/config', () => ({
  env: {
    BC_API_URL: 'https://api.businesscentral.dynamics.com/v2.0/test-tenant/Production/api/v2.0',
    BC_TENANT_ID: 'test-tenant-id',
    BC_CLIENT_ID: 'test-client-id',
    BC_CLIENT_SECRET: 'test-client-secret',
  },
}));

// Mock console.log/error to reduce noise
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('BCClient', () => {
  let bcClient: BCClient;

  beforeEach(() => {
    vi.clearAllMocks();
    bcClient = new BCClient();
  });

  afterEach(() => {
    // Clear token cache between tests
    bcClient.clearTokenCache();
  });

  // ============================================================================
  // 1. OAuth Authentication (6 tests)
  // ============================================================================

  describe('OAuth Authentication', () => {
    it('should authenticate with client credentials flow', async () => {
      // Arrange: MSW will handle OAuth token request with default handler
      // Default handler in handlers.ts already mocks the OAuth endpoint

      // Act: Make a query (triggers authentication)
      const result = await bcClient.query<BCCustomer>('customers');

      // Assert: Should authenticate and make query successfully
      expect(result.success).toBe(true);
    });

    it('should cache access token until expiry', async () => {
      // Arrange: Track request count
      let authRequestCount = 0;
      server.use(
        http.post('https://login.microsoftonline.com/*/oauth2/v2.0/token', () => {
          authRequestCount++;
          return HttpResponse.json({
            access_token: 'mock-bc-access-token',
            token_type: 'Bearer',
            expires_in: 3600, // 1 hour
          });
        })
      );

      // Act: Make two queries
      await bcClient.query<BCCustomer>('customers');
      await bcClient.query<BCCustomer>('customers');

      // Assert: Should authenticate only once (token cached)
      expect(authRequestCount).toBe(1);
    });

    it('should auto-refresh expired token', async () => {
      // Arrange: First auth returns token that expires immediately
      let authRequestCount = 0;
      server.use(
        http.post('https://login.microsoftonline.com/*/oauth2/v2.0/token', () => {
          authRequestCount++;
          return HttpResponse.json({
            access_token: `mock-bc-access-token-${authRequestCount}`,
            token_type: 'Bearer',
            expires_in: authRequestCount === 1 ? 1 : 3600, // First expires in 1s, second lasts 1h
          });
        })
      );

      // Act: Make first query
      await bcClient.query<BCCustomer>('customers');

      // Wait for token to expire
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Make second query (should trigger refresh)
      const result = await bcClient.query<BCCustomer>('customers');

      // Assert: Should authenticate twice (initial + refresh)
      expect(result.success).toBe(true);
      expect(authRequestCount).toBeGreaterThanOrEqual(2);
    });

    it('should handle invalid credentials error', async () => {
      // Arrange: Mock 401 Unauthorized response
      server.use(
        http.post('https://login.microsoftonline.com/*/oauth2/v2.0/token', () => {
          return HttpResponse.text('Unauthorized: Invalid client credentials', { status: 401 });
        })
      );

      // Act: Make a query (triggers authentication)
      const result = await bcClient.query<BCCustomer>('customers');

      // Assert: Should return error
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.error.code).toBe('AUTH_FAILED');
        expect(result.error.error.message).toContain('401');
      }
    });

    it('should handle network timeout', async () => {
      // Arrange: Mock network error
      server.use(
        http.post('https://login.microsoftonline.com/*/oauth2/v2.0/token', () => {
          return HttpResponse.error();
        })
      );

      // Act: Make a query (triggers authentication)
      const result = await bcClient.query<BCCustomer>('customers');

      // Assert: Should return error
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.error.code).toBe('AUTH_FAILED');
      }
    });

    it('should clear token cache on clearTokenCache()', () => {
      // Act: Clear token cache
      bcClient.clearTokenCache();
      const status = bcClient.getTokenStatus();

      // Assert: Token should be cleared
      expect(status.hasToken).toBe(false);
      expect(status.expiresAt).toBe(null);
    });
  });

  // ============================================================================
  // 2. OData Query Building (5 tests)
  // ============================================================================

  describe('OData Query Building', () => {
    it('should build URL with $filter parameter', async () => {
      // Arrange: Track the URL
      let capturedUrl: string | undefined;
      server.use(
        http.get('https://api.businesscentral.dynamics.com/v2.0/*', ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ value: [] });
        })
      );

      // Act: Query with filter
      await bcClient.query<BCCustomer>('customers', {
        filter: "blocked eq ''",
      });

      // Assert: Check URL includes $filter (URL encoded as %24filter)
      expect(capturedUrl).toContain('%24filter');
      expect(capturedUrl).toContain('blocked');
    });

    it('should build URL with $select and $expand', async () => {
      // Arrange: Track the URL
      let capturedUrl: string | undefined;
      server.use(
        http.get('https://api.businesscentral.dynamics.com/v2.0/*', ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ value: [] });
        })
      );

      // Act: Query with select and expand
      await bcClient.query<BCCustomer>('customers', {
        select: ['id', 'displayName', 'email'],
        expand: ['currency', 'paymentTerms'],
      });

      // Assert: Check URL includes $select and $expand (URL encoded)
      expect(capturedUrl).toContain('%24select');
      expect(capturedUrl).toContain('%24expand');
    });

    it('should build URL with $orderby, $top, $skip', async () => {
      // Arrange: Track the URL
      let capturedUrl: string | undefined;
      server.use(
        http.get('https://api.businesscentral.dynamics.com/v2.0/*', ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ value: [] });
        })
      );

      // Act: Query with ordering and pagination
      await bcClient.query<BCCustomer>('customers', {
        orderBy: 'displayName asc',
        top: 10,
        skip: 20,
      });

      // Assert: Check URL includes $orderby, $top, $skip (URL encoded)
      expect(capturedUrl).toContain('%24orderby');
      expect(capturedUrl).toContain('%24top=10');
      expect(capturedUrl).toContain('%24skip=20');
    });

    it('should build URL with $count=true', async () => {
      // Arrange: Track the URL and return count
      let capturedUrl: string | undefined;
      server.use(
        http.get('https://api.businesscentral.dynamics.com/v2.0/*', ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ value: [], '@odata.count': 42 });
        })
      );

      // Act: Query with count
      const result = await bcClient.query<BCCustomer>('customers', {
        count: true,
      });

      // Assert: Check URL includes $count and response includes count (URL encoded)
      expect(capturedUrl).toContain('%24count=true');
      if (result.success) {
        expect(result.data['@odata.count']).toBe(42);
      }
    });

    it('should handle empty options (no query params)', async () => {
      // Arrange: Track the URL
      let capturedUrl: string | undefined;
      server.use(
        http.get('https://api.businesscentral.dynamics.com/v2.0/*', ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ value: [] });
        })
      );

      // Act: Query without options
      await bcClient.query<BCCustomer>('customers');

      // Assert: Check URL has no query params
      expect(capturedUrl).not.toContain('%24filter');
      expect(capturedUrl).not.toContain('%24select');
      expect(capturedUrl).not.toContain('%24expand');
    });
  });

  // ============================================================================
  // 3. CRUD Operations (8 tests)
  // ============================================================================

  describe('CRUD Operations', () => {
    it('should query entities with OData (GET /customers)', async () => {
      // Arrange: Mock BC API response
      const mockCustomers: BCCustomer[] = [
        { id: '123', displayName: 'Customer 1', email: 'c1@test.com' },
        { id: '456', displayName: 'Customer 2', email: 'c2@test.com' },
      ];

      server.use(
        http.get('https://api.businesscentral.dynamics.com/v2.0/*/customers', () => {
          return HttpResponse.json<BCApiResponse<BCCustomer>>({
            value: mockCustomers,
            '@odata.context': 'https://api.businesscentral.dynamics.com/v2.0/$metadata#customers',
          });
        })
      );

      // Act: Query customers
      const result = await bcClient.query<BCCustomer>('customers');

      // Assert: Should return success with data
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.value).toHaveLength(2);
        expect(result.data.value[0].displayName).toBe('Customer 1');
      }
    });

    it('should get single entity by ID (GET /customers(id))', async () => {
      // Arrange: handlers.ts already has a handler for GET /customers(123)

      // Act: Get customer by ID
      const result = await bcClient.getById<BCCustomer>('customers', '123');

      // Assert: Should return success with single entity
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe('123');
        expect(result.data.displayName).toBe('Customer 1');
        expect(result.data['@odata.etag']).toBeDefined();
      }
    });

    it('should create new entity (POST /customers)', async () => {
      // Arrange: handlers.ts already has a handler for POST /customers
      const newCustomerData: Partial<BCCustomer> = {
        displayName: 'New Customer',
        email: 'new@test.com',
      };

      // Act: Create customer
      const result = await bcClient.create<BCCustomer>('customers', newCustomerData);

      // Assert: Should return success with created entity
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe('789');
        expect(result.data.displayName).toBe('New Customer');
      }
    });

    it('should update entity (PATCH /customers(id))', async () => {
      // Arrange: handlers.ts already has a handler for PATCH /customers(id)

      // Act: Update customer
      const result = await bcClient.update<BCCustomer>('customers', '123', {
        email: 'updated@test.com',
      });

      // Assert: Should return success with updated entity
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe('updated@test.com');
      }
    });

    it('should delete entity (DELETE /customers(id))', async () => {
      // Arrange: handlers.ts already has a handler for DELETE /customers(id)

      // Act: Delete customer
      const result = await bcClient.delete('customers', '123');

      // Assert: Should return success
      expect(result.success).toBe(true);
    });

    it('should accept ETag parameter for update/delete operations', async () => {
      // Arrange: handlers.ts PATCH handler will handle this request

      // Act: Update with ETag (BCClient should include If-Match header internally)
      const result = await bcClient.update<BCCustomer>(
        'customers',
        '123',
        { email: 'updated@test.com' },
        'W/"JzQ0O0VBQTM3Q0VENzc0MTgzNTU4NTswMDsn"'
      );

      // Assert: Should return success (the handler in handlers.ts accepts any valid etag)
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe('updated@test.com');
      }
    });

    it('should handle 404 Not Found gracefully', async () => {
      // Arrange: handlers.ts already handles 404 for unknown IDs (not '123')

      // Act: Get non-existent customer
      const result = await bcClient.getById<BCCustomer>('customers', 'non-existent-id');

      // Assert: Should return error with discriminated union
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.error.code).toBe('NotFound');
        expect(result.error.error.message).toBe('Entity not found');
      }
    });

    it('should handle 409 Conflict on update', async () => {
      // Arrange: handlers.ts already handles 409 Conflict for OUTDATED-ETAG

      // Act: Update with outdated ETag
      const result = await bcClient.update<BCCustomer>(
        'customers',
        '123',
        { email: 'new@test.com' },
        'OUTDATED-ETAG'
      );

      // Assert: Should return error
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.error.code).toBe('Conflict');
      }
    });
  });

  // ============================================================================
  // 4. Error Handling (6 tests)
  // ============================================================================

  describe('Error Handling', () => {
    it('should return { success: false, error } on 401 Unauthorized', async () => {
      // Arrange: Mock 401 response
      const mockError: BCApiError = {
        error: {
          code: 'Unauthorized',
          message: 'Access token is invalid or expired',
        },
      };

      server.use(
        http.get(`${BC_API_BASE_URL}/customers*`, () => {
          return HttpResponse.json(mockError, { status: 401 });
        })
      );

      // Act: Query customers
      const result = await bcClient.query<BCCustomer>('customers');

      // Assert: Should return error with discriminated union
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.error.code).toBe('Unauthorized');
      }
    });

    it('should return { success: false, error } on 403 Forbidden', async () => {
      // Arrange: Mock 403 response
      const mockError: BCApiError = {
        error: {
          code: 'Forbidden',
          message: 'Insufficient permissions',
        },
      };

      server.use(
        http.get(`${BC_API_BASE_URL}/customers*`, () => {
          return HttpResponse.json(mockError, { status: 403 });
        })
      );

      // Act: Query customers
      const result = await bcClient.query<BCCustomer>('customers');

      // Assert: Should return error
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.error.code).toBe('Forbidden');
      }
    });

    it('should return { success: false, error } on 500 Server Error', async () => {
      // Arrange: Mock 500 response
      const mockError: BCApiError = {
        error: {
          code: 'InternalServerError',
          message: 'An internal server error occurred',
        },
      };

      server.use(
        http.get(`${BC_API_BASE_URL}/customers*`, () => {
          return HttpResponse.json(mockError, { status: 500 });
        })
      );

      // Act: Query customers
      const result = await bcClient.query<BCCustomer>('customers');

      // Assert: Should return error
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.error.code).toBe('InternalServerError');
      }
    });

    it('should parse BC API error response JSON', async () => {
      // Arrange: Mock BC error response with innererror
      const mockError: BCApiError = {
        error: {
          code: 'ValidationError',
          message: 'Invalid email format',
          innererror: {
            type: 'Microsoft.Dynamics.BC.ValidationException',
            message: 'Email field must be a valid email address',
          },
        },
      };

      server.use(
        http.post(`${BC_API_BASE_URL}/customers`, () => {
          return HttpResponse.json(mockError, { status: 400 });
        })
      );

      // Act: Create customer with invalid data
      const result = await bcClient.create<BCCustomer>('customers', {
        displayName: 'Test',
        email: 'invalid-email',
      });

      // Assert: Should parse full error structure
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.error.code).toBe('ValidationError');
        expect(result.error.error.message).toBe('Invalid email format');
        expect(result.error.error.innererror).toBeDefined();
        expect(result.error.error.innererror?.type).toBe('Microsoft.Dynamics.BC.ValidationException');
      }
    });

    it('should handle network errors (fetch fails)', async () => {
      // Arrange: Mock network error
      server.use(
        http.get(`${BC_API_BASE_URL}/customers*`, () => {
          return HttpResponse.error();
        })
      );

      // Act: Query customers
      const result = await bcClient.query<BCCustomer>('customers');

      // Assert: Should return error
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.error.code).toBe('FETCH_FAILED');
      }
    });

    it('should handle authentication failure on init', async () => {
      // Arrange: Clear token cache and mock OAuth failure
      bcClient.clearTokenCache();

      server.use(
        http.post('https://login.microsoftonline.com/*/oauth2/v2.0/token', () => {
          return HttpResponse.error();
        })
      );

      // Act: Query customers (triggers authentication)
      const result = await bcClient.query<BCCustomer>('customers');

      // Assert: Should return AUTH_FAILED error
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.error.code).toBe('AUTH_FAILED');
      }
    });
  });

  // ============================================================================
  // 5. Schema & Connection (3 tests)
  // ============================================================================

  describe('Schema & Connection', () => {
    it('should retrieve entity metadata (GET /$metadata#customers)', async () => {
      // Arrange: Mock metadata response
      const mockMetadata = {
        '@odata.context': 'https://api.businesscentral.dynamics.com/v2.0/$metadata#customers',
        value: [
          { name: 'id', type: 'Edm.Guid' },
          { name: 'displayName', type: 'Edm.String' },
          { name: 'email', type: 'Edm.String' },
        ],
      };

      server.use(
        http.get(`${BC_API_BASE_URL}/$metadata*`, () => {
          return HttpResponse.json(mockMetadata);
        })
      );

      // Act: Get entity schema
      const result = await bcClient.getEntitySchema('customers');

      // Assert: Should return schema
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(mockMetadata);
      }
    });

    it('should validate credentials via validateCredentials()', async () => {
      // Arrange: MSW handles OAuth with default handler
      // Clear token cache to force authentication
      bcClient.clearTokenCache();

      // Act: Validate credentials
      const isValid = await bcClient.validateCredentials();

      // Assert: Should return true
      expect(isValid).toBe(true);
    });

    it('should test connection via testConnection()', async () => {
      // Arrange: Track the URL to verify $top=1
      let capturedUrl: string | undefined;
      server.use(
        http.get(`${BC_API_BASE_URL}/customers*`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ value: [] });
        })
      );

      // Act: Test connection
      const result = await bcClient.testConnection();

      // Assert: Should return success and query customers with $top=1
      expect(result.success).toBe(true);
      expect(capturedUrl).toContain('%24top=1');
    });
  });

  // ============================================================================
  // 6. Singleton Pattern (Bonus Test)
  // ============================================================================

  describe('Singleton Pattern', () => {
    it('should return same instance on getBCClient()', () => {
      // Act: Get two instances
      const instance1 = getBCClient();
      const instance2 = getBCClient();

      // Assert: Should be same instance
      expect(instance1).toBe(instance2);
    });
  });
});
