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
];
