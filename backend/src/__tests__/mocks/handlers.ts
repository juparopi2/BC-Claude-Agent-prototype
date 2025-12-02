import { http, HttpResponse } from 'msw';

// Base URL for Business Central API tests
export const BC_API_BASE_URL = 'https://api.businesscentral.dynamics.com/v2.0/*/Production/api/v2.0';

// MSW request handlers for mocking external APIs
export const handlers = [
  // Mock Anthropic API
  http.post('https://api.anthropic.com/v1/messages', () => {
    return HttpResponse.json({
      id: 'msg_test123',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'This is a mocked response from Claude',
        },
      ],
      model: 'claude-sonnet-4-5-20250929',
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 10,
        output_tokens: 20,
      },
    });
  }),

  // Mock Business Central API - GET /customers (collection) and /customers(id)
  http.get(`${BC_API_BASE_URL}/customers*`, ({ request }) => {
    // Handle /customers(id) - single entity by ID
    if (request.url.includes('(') && !request.url.includes('metadata')) {
      const match = request.url.match(/customers\(([^)]+)\)/);
      const id = match ? match[1] : '';

      // Check if it's a known test ID
      if (id === '123') {
        return HttpResponse.json({
          id: '123',
          displayName: 'Customer 1',
          email: 'c1@test.com',
          '@odata.etag': 'W/"test-etag"',
        });
      }

      // Unknown ID - return 404
      return HttpResponse.json({
        error: {
          code: 'NotFound',
          message: 'Entity not found',
        },
      }, { status: 404 });
    }

    // Handle /$metadata
    if (request.url.includes('metadata')) {
      return HttpResponse.json({
        '@odata.context': 'https://api.businesscentral.dynamics.com/v2.0/$metadata#customers',
        value: [
          { name: 'id', type: 'Edm.Guid' },
          { name: 'displayName', type: 'Edm.String' },
        ],
      });
    }

    // Handle basic /customers collection query
    return HttpResponse.json({
      value: [
        {
          id: 'bc_entity_1',
          displayName: 'Test Entity',
        },
      ],
    });
  }),

  // Mock Business Central API - POST /customers (create)
  http.post(`${BC_API_BASE_URL}/customers`, async ({ request }) => {
    const body = await request.json() as Record<string, any> | null;

    // Check for validation errors (intentional test case)
    if (body && typeof body === 'object' && 'email' in body && body.email === 'invalid-email') {
      return HttpResponse.json({
        error: {
          code: 'ValidationError',
          message: 'Invalid email format',
          innererror: {
            type: 'Microsoft.Dynamics.BC.ValidationException',
            message: 'Email field must be a valid email address',
          },
        },
      }, { status: 400 });
    }

    // Successful creation
    return HttpResponse.json({
      id: '789',
      displayName: body?.displayName || 'New Customer',
      email: body?.email,
      '@odata.etag': 'W/"new-etag"',
    });
  }),

  // Mock Business Central API - PATCH /customers(id) (update)
  http.patch(`${BC_API_BASE_URL}/customers*`, async ({ request }) => {
    const body = await request.json() as Record<string, any> | null;
    const etag = request.headers.get('if-match');

    // Check for conflict (outdated ETag)
    if (etag === 'OUTDATED-ETAG') {
      return HttpResponse.json({
        error: {
          code: 'Conflict',
          message: 'The record has been modified by another user',
        },
      }, { status: 409 });
    }

    // Successful update
    return HttpResponse.json({
      id: '123',
      displayName: 'Customer 1',
      email: body?.email || 'updated@test.com',
      '@odata.etag': 'W/"updated-etag"',
    });
  }),

  // Mock Business Central API - DELETE /customers(id) (delete)
  http.delete(`${BC_API_BASE_URL}/customers*`, () => {
    return new HttpResponse(null, { status: 204 });
  }),

  // Mock Microsoft Graph API - User Profile
  http.get('https://graph.microsoft.com/v1.0/me', () => {
    return HttpResponse.json({
      id: 'user-123',
      displayName: 'Test User',
      givenName: 'Test',
      surname: 'User',
      mail: 'test.user@example.com',
      userPrincipalName: 'test.user@example.com',
      jobTitle: 'Software Engineer',
      officeLocation: 'Building 1',
    });
  }),

  // Mock Microsoft OAuth Token Endpoint
  http.post('https://login.microsoftonline.com/*/oauth2/v2.0/token', () => {
    return HttpResponse.json({
      access_token: 'mock-access-token',
      refresh_token: 'mock-refresh-token',
      id_token: 'mock-id-token',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'openid profile email User.Read',
    });
  }),
];
