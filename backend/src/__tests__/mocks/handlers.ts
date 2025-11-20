import { http, HttpResponse } from 'msw';

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

  // Mock Business Central API
  http.get('https://api.businesscentral.dynamics.com/v2.0/*', () => {
    return HttpResponse.json({
      value: [
        {
          id: 'bc_entity_1',
          name: 'Test Entity',
        },
      ],
    });
  }),

  // Mock MCP Server
  http.post('http://localhost:3003/mcp', () => {
    return HttpResponse.json({
      result: {
        content: [
          {
            type: 'text',
            text: 'MCP tool result',
          },
        ],
      },
    });
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
