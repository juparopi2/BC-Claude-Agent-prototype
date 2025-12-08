/**
 * MockResponseLibrary - Predefined response templates
 *
 * Centralized library of mock responses for testing.
 * Makes it easy to extend MockAnthropicClient with new patterns.
 */

// ============================================================================
// Type Definitions
// ============================================================================

export interface MockResponseTemplate {
  /** Unique identifier for this response */
  id: string;

  /** Human-readable description */
  description: string;

  /** Response text (can include thinking) */
  text: string;

  /** Optional thinking block content */
  thinking?: string;

  /** Optional tool use configuration */
  toolUse?: {
    toolName: string;
    toolInput: Record<string, unknown>;
  };

  /** Stop reason */
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';

  /** Estimated token usage */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

// ============================================================================
// Predefined Response Templates
// ============================================================================

export const MockResponses = {
  // --------------------------------------------------------------------------
  // GREETINGS
  // --------------------------------------------------------------------------
  greetings: {
    simple: {
      id: 'greeting-simple',
      description: 'Simple hello response',
      text: 'Hello! I\'m your Business Central assistant. How can I help you today?',
      stopReason: 'end_turn',
      usage: { inputTokens: 50, outputTokens: 40 }
    } as MockResponseTemplate,

    detailed: {
      id: 'greeting-detailed',
      description: 'Detailed capabilities overview',
      thinking: 'The user is greeting me. I should introduce myself and provide a brief overview of my capabilities to help them understand what I can do.',
      text: 'Hello! I\'m your Business Central assistant. I can help you with:\n\n' +
            '- Creating and managing customers, vendors, and contacts\n' +
            '- Creating sales orders, invoices, and quotes\n' +
            '- Searching and retrieving business data\n' +
            '- Answering questions about Business Central operations\n\n' +
            'What would you like to do today?',
      stopReason: 'end_turn',
      usage: { inputTokens: 60, outputTokens: 120 }
    } as MockResponseTemplate,

    enthusiastic: {
      id: 'greeting-enthusiastic',
      description: 'Enthusiastic welcome message',
      text: 'Welcome! I\'m excited to help you work with Microsoft Dynamics 365 Business Central. ' +
            'Whether you need to create records, search for information, or understand your business data, ' +
            'I\'m here to make it easy. What can I help you with?',
      stopReason: 'end_turn',
      usage: { inputTokens: 55, outputTokens: 85 }
    } as MockResponseTemplate
  },

  // --------------------------------------------------------------------------
  // BUSINESS CENTRAL INFO
  // --------------------------------------------------------------------------
  businessCentral: {
    overview: {
      id: 'bc-overview',
      description: 'General Business Central overview',
      thinking: 'The user is asking about Business Central. I should provide a comprehensive overview of the platform and its key features.',
      text: 'Microsoft Dynamics 365 Business Central is a comprehensive business management solution designed for small to medium-sized businesses. ' +
            'It provides integrated modules for:\n\n' +
            '**Financial Management**: General ledger, accounts payable/receivable, banking, budgeting\n' +
            '**Sales & Marketing**: Customer management, sales orders, quotes, invoicing\n' +
            '**Purchase & Payables**: Vendor management, purchase orders, procurement\n' +
            '**Inventory Management**: Item tracking, warehouse operations, stock control\n' +
            '**Project Management**: Job costing, resource allocation, time tracking\n\n' +
            'Through this assistant, I can help you interact with these modules using natural language.',
      stopReason: 'end_turn',
      usage: { inputTokens: 80, outputTokens: 180 }
    } as MockResponseTemplate,

    capabilities: {
      id: 'bc-capabilities',
      description: 'Detailed capabilities explanation',
      text: 'I can help you with the following Business Central operations:\n\n' +
            '**Create Operations**:\n' +
            '- Customers, vendors, and contacts\n' +
            '- Sales orders, invoices, and credit memos\n' +
            '- Purchase orders and documents\n' +
            '- Items and inventory adjustments\n\n' +
            '**Search & Retrieve**:\n' +
            '- Find customers by name, email, or phone\n' +
            '- Search invoices by date, amount, or status\n' +
            '- Look up items and inventory levels\n' +
            '- Retrieve vendor and purchase data\n\n' +
            '**Update Operations**:\n' +
            '- Modify customer information\n' +
            '- Update pricing and discounts\n' +
            '- Change order statuses\n\n' +
            'All write operations require your approval before execution.',
      stopReason: 'end_turn',
      usage: { inputTokens: 75, outputTokens: 220 }
    } as MockResponseTemplate,

    apiInfo: {
      id: 'bc-api-info',
      description: 'Business Central API information',
      thinking: 'The user is asking about the technical details of how I interact with Business Central. I should explain the API integration.',
      text: 'I interact with Business Central through the OData v4 RESTful API. This provides:\n\n' +
            '- **Standard Operations**: GET, POST, PATCH, DELETE for all entities\n' +
            '- **Query Capabilities**: $filter, $select, $expand, $orderby, $top, $skip\n' +
            '- **Batch Operations**: Process multiple requests in a single call\n' +
            '- **Authentication**: OAuth 2.0 with per-user tokens\n' +
            '- **Entity Coverage**: 115+ Business Central entities available\n\n' +
            'All operations are performed securely using your authenticated Business Central credentials.',
      stopReason: 'end_turn',
      usage: { inputTokens: 90, outputTokens: 160 }
    } as MockResponseTemplate
  },

  // --------------------------------------------------------------------------
  // TOOL USE
  // --------------------------------------------------------------------------
  toolUse: {
    createCustomer: {
      id: 'tool-create-customer',
      description: 'Create customer with approval',
      thinking: 'The user wants to create a new customer. I should use the create_customer tool with the provided information. This is a write operation that will require approval.',
      text: 'I\'ll help you create a new customer in Business Central. Let me prepare the request for your approval.',
      toolUse: {
        toolName: 'create_customer',
        toolInput: {
          displayName: 'Contoso Ltd.',
          email: 'contact@contoso.com',
          phoneNumber: '+1-555-0100',
          type: 'Company',
          currencyCode: 'USD'
        }
      },
      stopReason: 'tool_use',
      usage: { inputTokens: 120, outputTokens: 80 }
    } as MockResponseTemplate,

    createInvoice: {
      id: 'tool-create-invoice',
      description: 'Create sales invoice',
      thinking: 'The user wants to create a sales invoice. I need to use the create_salesInvoice tool with the customer and line items specified.',
      text: 'I\'ll create a sales invoice for this customer. This will require your approval before being submitted to Business Central.',
      toolUse: {
        toolName: 'create_salesInvoice',
        toolInput: {
          customerId: '12345678-1234-1234-1234-123456789012',
          customerNumber: 'C-00001',
          invoiceDate: '2025-12-08',
          dueDate: '2025-12-22',
          currencyCode: 'USD',
          salesInvoiceLines: [
            {
              lineType: 'Item',
              lineObjectNumber: 'ITEM-001',
              description: 'Professional Services - Consulting',
              quantity: 10,
              unitPrice: 150.00
            }
          ]
        }
      },
      stopReason: 'tool_use',
      usage: { inputTokens: 150, outputTokens: 90 }
    } as MockResponseTemplate,

    findCustomers: {
      id: 'tool-find-customers',
      description: 'Search for customers',
      thinking: 'The user wants to find customers. I should use the list_customer tool with appropriate filters.',
      text: 'Let me search for customers matching your criteria.',
      toolUse: {
        toolName: 'list_customer',
        toolInput: {
          $filter: "startswith(displayName, 'Contoso')",
          $select: 'id,displayName,email,phoneNumber,balance',
          $top: 10
        }
      },
      stopReason: 'tool_use',
      usage: { inputTokens: 100, outputTokens: 60 }
    } as MockResponseTemplate,

    getCustomerById: {
      id: 'tool-get-customer',
      description: 'Retrieve specific customer',
      text: 'I\'ll retrieve the customer details for you.',
      toolUse: {
        toolName: 'get_customer',
        toolInput: {
          id: '12345678-1234-1234-1234-123456789012',
          $expand: 'customerFinancialDetails'
        }
      },
      stopReason: 'tool_use',
      usage: { inputTokens: 80, outputTokens: 45 }
    } as MockResponseTemplate,

    updateCustomer: {
      id: 'tool-update-customer',
      description: 'Update customer information',
      thinking: 'The user wants to update customer information. This is a write operation requiring approval.',
      text: 'I\'ll update the customer information. This will require your approval.',
      toolUse: {
        toolName: 'update_customer',
        toolInput: {
          id: '12345678-1234-1234-1234-123456789012',
          email: 'newemail@contoso.com',
          phoneNumber: '+1-555-0200'
        }
      },
      stopReason: 'tool_use',
      usage: { inputTokens: 110, outputTokens: 70 }
    } as MockResponseTemplate
  },

  // --------------------------------------------------------------------------
  // SEARCH RESULTS
  // --------------------------------------------------------------------------
  searchResults: {
    customers: {
      id: 'search-customers',
      description: 'Mock customer search results',
      text: 'I found 3 customers matching your criteria:\n\n' +
            '**1. Contoso Ltd.**\n' +
            '- Email: contact@contoso.com\n' +
            '- Phone: +1-555-0100\n' +
            '- Balance: $12,450.00\n\n' +
            '**2. Contoso North America**\n' +
            '- Email: na@contoso.com\n' +
            '- Phone: +1-555-0101\n' +
            '- Balance: $8,920.50\n\n' +
            '**3. Contoso Europe GmbH**\n' +
            '- Email: eu@contoso.com\n' +
            '- Phone: +49-555-0100\n' +
            '- Balance: €15,200.00\n\n' +
            'Would you like more details about any of these customers?',
      stopReason: 'end_turn',
      usage: { inputTokens: 95, outputTokens: 180 }
    } as MockResponseTemplate,

    invoices: {
      id: 'search-invoices',
      description: 'Mock invoice search results',
      thinking: 'The user requested a list of invoices. I should present the results in a clear, structured format.',
      text: 'Here are the recent invoices:\n\n' +
            '**Invoice #INV-2025-001**\n' +
            '- Customer: Contoso Ltd.\n' +
            '- Date: 2025-12-01\n' +
            '- Amount: $1,500.00\n' +
            '- Status: Paid\n\n' +
            '**Invoice #INV-2025-002**\n' +
            '- Customer: Fabrikam Inc.\n' +
            '- Date: 2025-12-03\n' +
            '- Amount: $2,850.00\n' +
            '- Status: Outstanding\n\n' +
            '**Invoice #INV-2025-003**\n' +
            '- Customer: Adventure Works\n' +
            '- Date: 2025-12-05\n' +
            '- Amount: $975.50\n' +
            '- Status: Overdue\n\n' +
            'Total outstanding: $3,825.50',
      stopReason: 'end_turn',
      usage: { inputTokens: 105, outputTokens: 200 }
    } as MockResponseTemplate,

    noResults: {
      id: 'search-no-results',
      description: 'No search results found',
      text: 'I couldn\'t find any records matching your search criteria. You might want to:\n\n' +
            '- Try broader search terms\n' +
            '- Check spelling and formatting\n' +
            '- Remove some filters to expand the search\n' +
            '- Create a new record if it doesn\'t exist\n\n' +
            'Would you like to adjust your search or create a new record?',
      stopReason: 'end_turn',
      usage: { inputTokens: 85, outputTokens: 95 }
    } as MockResponseTemplate
  },

  // --------------------------------------------------------------------------
  // COMPLEX EXPLANATIONS
  // --------------------------------------------------------------------------
  complexExplanations: {
    architecture: {
      id: 'explain-architecture',
      description: 'System architecture explanation',
      thinking: 'The user is asking about the system architecture. This is a complex topic that requires careful explanation of multiple components and their interactions. I should break this down into digestible sections.',
      text: 'Let me explain the architecture of this Business Central Agent:\n\n' +
            '**Frontend Layer**\n' +
            '- React application with TypeScript\n' +
            '- Socket.IO for real-time communication\n' +
            '- Streaming message display with markdown support\n\n' +
            '**Backend Layer**\n' +
            '- Node.js with Express\n' +
            '- DirectAgentService for Claude API integration\n' +
            '- Event sourcing with append-only message_events table\n' +
            '- BullMQ for async message queue processing\n\n' +
            '**Business Central Integration**\n' +
            '- 115 vendored MCP tools loaded from JSON files\n' +
            '- OData v4 API client with OAuth 2.0\n' +
            '- Per-user token encryption and storage\n\n' +
            '**Data Layer**\n' +
            '- Azure SQL Database for persistent storage\n' +
            '- Redis for session management and rate limiting\n' +
            '- Event store with atomic sequence numbers\n\n' +
            'The system uses an approval flow for all write operations to Business Central, ensuring human oversight.',
      stopReason: 'end_turn',
      usage: { inputTokens: 140, outputTokens: 280 }
    } as MockResponseTemplate,

    approvalWorkflow: {
      id: 'explain-approval-workflow',
      description: 'Approval workflow explanation',
      thinking: 'The user wants to understand how the approval system works. I should explain the complete flow from request to resolution, including the technical implementation details.',
      text: 'The approval workflow ensures human oversight for all write operations:\n\n' +
            '**Step 1: Tool Request**\n' +
            'When I need to perform a write operation (create, update, delete), I invoke the appropriate tool.\n\n' +
            '**Step 2: Approval Request**\n' +
            'The ApprovalManager creates a pending approval record in the database and emits a WebSocket event to your browser.\n\n' +
            '**Step 3: User Review**\n' +
            'You see the proposed operation details and can choose to:\n' +
            '- Approve: Operation proceeds to Business Central\n' +
            '- Reject: Operation is cancelled\n' +
            '- Timeout: After 5 minutes, operation auto-rejects\n\n' +
            '**Step 4: Resolution**\n' +
            'Your decision is recorded and the tool execution continues or aborts accordingly.\n\n' +
            '**Technical Implementation**:\n' +
            '- Promise-based async flow with in-memory resolvers\n' +
            '- Database persistence for audit trail\n' +
            '- WebSocket events for real-time UI updates\n' +
            '- Rate limiting to prevent approval fatigue\n\n' +
            'This ensures you maintain full control over modifications to your Business Central data.',
      stopReason: 'end_turn',
      usage: { inputTokens: 160, outputTokens: 320 }
    } as MockResponseTemplate,

    eventSourcing: {
      id: 'explain-event-sourcing',
      description: 'Event sourcing pattern explanation',
      thinking: 'The user is asking about event sourcing. This is a sophisticated architectural pattern that requires careful explanation of the benefits and implementation.',
      text: 'This system uses event sourcing for message persistence:\n\n' +
            '**Core Concept**\n' +
            'Instead of storing just the current state, we store every event (message, tool use, thinking) as an immutable record.\n\n' +
            '**Benefits**:\n' +
            '- Complete audit trail of all conversations\n' +
            '- Ability to replay or reconstruct any session\n' +
            '- No data loss from crashes or errors\n' +
            '- Eventually consistent materialized views\n\n' +
            '**Implementation**:\n' +
            '- `message_events` table: Append-only event log\n' +
            '- Atomic sequence numbers via Redis INCR\n' +
            '- Synchronous event writes (~10ms) to EventStore\n' +
            '- Async materialization to `messages` table via BullMQ\n\n' +
            '**Performance**:\n' +
            'By making event writes synchronous but keeping materialization async, we eliminate the perceived 600ms latency of database writes while maintaining data durability.\n\n' +
            'The trade-off is eventual consistency - the materialized `messages` table might lag slightly behind the event log, but the event log is always immediately consistent.',
      stopReason: 'end_turn',
      usage: { inputTokens: 180, outputTokens: 340 }
    } as MockResponseTemplate
  },

  // --------------------------------------------------------------------------
  // ERRORS
  // --------------------------------------------------------------------------
  errors: {
    notFound: {
      id: 'error-not-found',
      description: 'Resource not found error',
      text: 'I couldn\'t find the requested resource in Business Central. This could mean:\n\n' +
            '- The ID or number provided doesn\'t exist\n' +
            '- The record may have been deleted\n' +
            '- There might be a typo in the identifier\n\n' +
            'Would you like me to search for similar records or create a new one?',
      stopReason: 'end_turn',
      usage: { inputTokens: 70, outputTokens: 85 }
    } as MockResponseTemplate,

    permissionDenied: {
      id: 'error-permission-denied',
      description: 'Permission denied error',
      thinking: 'The user attempted an operation they don\'t have permission for. I should explain this clearly and suggest alternatives.',
      text: 'I\'m unable to perform this operation because your Business Central account doesn\'t have the necessary permissions.\n\n' +
            'This typically means:\n' +
            '- Your user role doesn\'t include this permission\n' +
            '- The operation requires elevated privileges\n' +
            '- There may be company-specific restrictions\n\n' +
            'Please contact your Business Central administrator to request access, or let me know if there\'s another way I can help.',
      stopReason: 'end_turn',
      usage: { inputTokens: 90, outputTokens: 110 }
    } as MockResponseTemplate,

    apiError: {
      id: 'error-api',
      description: 'API communication error',
      text: 'I encountered an error communicating with Business Central:\n\n' +
            '- The API might be temporarily unavailable\n' +
            '- There could be a network connectivity issue\n' +
            '- Your session may have expired\n\n' +
            'Please try again in a moment. If the problem persists, you may need to re-authenticate.',
      stopReason: 'end_turn',
      usage: { inputTokens: 75, outputTokens: 95 }
    } as MockResponseTemplate,

    validationError: {
      id: 'error-validation',
      description: 'Input validation error',
      text: 'The data provided doesn\'t meet Business Central\'s validation requirements:\n\n' +
            '- Required fields may be missing\n' +
            '- Data format might be incorrect\n' +
            '- Values may be out of acceptable ranges\n\n' +
            'Please check the input and try again. Let me know if you need help with the correct format.',
      stopReason: 'end_turn',
      usage: { inputTokens: 85, outputTokens: 100 }
    } as MockResponseTemplate,

    rateLimitExceeded: {
      id: 'error-rate-limit',
      description: 'Rate limit exceeded error',
      thinking: 'The user has hit the rate limit. I should explain this clearly and set expectations for when they can continue.',
      text: 'You\'ve reached the rate limit for this session (100 operations per hour).\n\n' +
            'This limit helps ensure fair usage and system stability. You can:\n\n' +
            '- Wait for the limit to reset (limits are rolling)\n' +
            '- Start a new session for a fresh allocation\n' +
            '- Contact support if you need higher limits\n\n' +
            'Your current operations will be available again shortly.',
      stopReason: 'end_turn',
      usage: { inputTokens: 95, outputTokens: 115 }
    } as MockResponseTemplate
  }
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get a random response from a category
 */
export function getRandomResponse(
  category: keyof typeof MockResponses
): MockResponseTemplate {
  const categoryResponses = MockResponses[category];
  const responses = Object.values(categoryResponses);
  const randomIndex = Math.floor(Math.random() * responses.length);
  return responses[randomIndex] as MockResponseTemplate;
}

/**
 * Find response by ID
 */
export function getResponseById(id: string): MockResponseTemplate | undefined {
  // Search all categories for matching ID
  for (const category of Object.values(MockResponses)) {
    for (const response of Object.values(category)) {
      if (response.id === id) {
        return response as MockResponseTemplate;
      }
    }
  }
  return undefined;
}

/**
 * Get all response IDs for a category
 */
export function getCategoryResponseIds(
  category: keyof typeof MockResponses
): string[] {
  const categoryResponses = MockResponses[category];
  return Object.values(categoryResponses).map((r) => r.id);
}

/**
 * Create custom response with minimal required fields
 */
export function createCustomResponse(
  text: string,
  options?: Partial<MockResponseTemplate>
): MockResponseTemplate {
  return {
    id: `custom-${Date.now()}`,
    description: 'Custom response',
    text,
    stopReason: 'end_turn',
    usage: { inputTokens: 50, outputTokens: 100 },
    ...options
  };
}

/**
 * List all available response categories
 */
export function listCategories(): string[] {
  return Object.keys(MockResponses);
}

/**
 * List all response IDs with their descriptions
 */
export function listAllResponses(): Array<{ id: string; description: string; category: string }> {
  const results: Array<{ id: string; description: string; category: string }> = [];

  for (const [categoryName, category] of Object.entries(MockResponses)) {
    for (const response of Object.values(category)) {
      results.push({
        id: response.id,
        description: response.description,
        category: categoryName
      });
    }
  }

  return results;
}

/**
 * Get responses by stop reason
 */
export function getResponsesByStopReason(
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens'
): MockResponseTemplate[] {
  const results: MockResponseTemplate[] = [];

  for (const category of Object.values(MockResponses)) {
    for (const response of Object.values(category)) {
      if (response.stopReason === stopReason) {
        results.push(response as MockResponseTemplate);
      }
    }
  }

  return results;
}

/**
 * Get responses with thinking blocks
 */
export function getResponsesWithThinking(): MockResponseTemplate[] {
  const results: MockResponseTemplate[] = [];

  for (const category of Object.values(MockResponses)) {
    for (const response of Object.values(category)) {
      if (response.thinking) {
        results.push(response as MockResponseTemplate);
      }
    }
  }

  return results;
}

/**
 * Get responses with tool use
 */
export function getResponsesWithToolUse(): MockResponseTemplate[] {
  const results: MockResponseTemplate[] = [];

  for (const category of Object.values(MockResponses)) {
    for (const response of Object.values(category)) {
      if (response.toolUse) {
        results.push(response as MockResponseTemplate);
      }
    }
  }

  return results;
}
