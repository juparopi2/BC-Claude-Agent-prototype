# Type System

## Shared Types Package

The `@bc-agent/shared` package is the single source of truth for types shared between frontend and backend.

### Installation

The shared package is automatically linked via npm workspaces:

```json
{
  "dependencies": {
    "@bc-agent/shared": "*"
  }
}
```

### Importing Types

```typescript
// Import types
import type {
  AgentEvent,
  ChatMessageData,
  ApiErrorResponse
} from '@bc-agent/shared';

// Import constants/functions
import {
  ErrorCode,
  getErrorMessage
} from '@bc-agent/shared';

// Import schemas (tree-shakeable)
import {
  chatMessageSchema,
  validateSafe
} from '@bc-agent/shared/schemas';
```

## Agent Event Types

The discriminated union `AgentEvent` represents all 16 event types:

```typescript
type AgentEvent =
  | SessionStartEvent
  | ThinkingEvent
  | ThinkingChunkEvent
  | MessagePartialEvent
  | MessageEvent
  | MessageChunkEvent
  | ToolUseEvent
  | ToolResultEvent
  | ErrorEvent
  | SessionEndEvent
  | CompleteEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | UserMessageConfirmedEvent
  | TurnPausedEvent
  | ContentRefusedEvent;
```

### Type Narrowing

Use switch statements for type-safe event handling:

```typescript
function handleEvent(event: AgentEvent) {
  switch (event.type) {
    case 'message':
      // TypeScript knows: event is MessageEvent
      console.log(event.content, event.stopReason);
      break;

    case 'tool_use':
      // TypeScript knows: event is ToolUseEvent
      console.log(event.toolName, event.args);
      break;

    case 'approval_requested':
      // TypeScript knows: event is ApprovalRequestedEvent
      console.log(event.approvalId, event.changeSummary);
      break;
  }
}
```

## WebSocket Types

### Client → Server Events

```typescript
interface ChatMessageData {
  message: string;
  sessionId: string;
  userId: string;
  thinking?: ExtendedThinkingConfig;
}

interface StopAgentData {
  sessionId: string;
  userId: string;
}

interface ApprovalResponseData {
  approvalId: string;
  approved: boolean;
  userId: string;
  reason?: string;
}
```

### Server → Client Events

All server events are emitted via `agent:event` with the discriminated union:

```typescript
socket.on('agent:event', (event: AgentEvent) => {
  // Handle based on event.type
});

socket.on('agent:error', (error: AgentErrorData) => {
  // Handle error
});

socket.on('session:ready', (data: SessionReadyEvent) => {
  // Session is ready for messages
});
```

## Error Types

### API Error Response

```typescript
interface ApiErrorResponse {
  error: string;       // HTTP status name
  message: string;     // User-friendly message
  code: ErrorCode;     // Machine-readable code
  details?: Record<string, string | number | boolean>;
}
```

### Error Code Enum

```typescript
enum ErrorCode {
  // 400
  BAD_REQUEST = 'BAD_REQUEST',
  VALIDATION_ERROR = 'VALIDATION_ERROR',

  // 401
  UNAUTHORIZED = 'UNAUTHORIZED',
  SESSION_EXPIRED = 'SESSION_EXPIRED',

  // 403
  FORBIDDEN = 'FORBIDDEN',
  SESSION_ACCESS_DENIED = 'SESSION_ACCESS_DENIED',

  // 404
  NOT_FOUND = 'NOT_FOUND',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',

  // 500
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  // ... more codes
}
```

### Type Guards

```typescript
import { isApiErrorResponse, isValidErrorCode } from '@bc-agent/shared';

// Check if response is an error
if (isApiErrorResponse(data)) {
  console.error(data.code, data.message);
}

// Validate error code
if (isValidErrorCode(someString)) {
  // someString is now ErrorCode type
}
```

## Zod Schemas

For runtime validation:

```typescript
import { chatMessageSchema, validateSafe, z } from '@bc-agent/shared/schemas';

// Validate input
const result = validateSafe(chatMessageSchema, userInput);

if (result.success) {
  // result.data is fully typed
  sendMessage(result.data);
} else {
  // result.error contains Zod validation errors
  console.error(result.error.errors);
}
```

## Type Safety Verification

Run type checking across the monorepo:

```bash
# From root
npm run verify:types
```

This command:
1. Builds `@bc-agent/shared`
2. Type-checks the shared package
3. Type-checks the backend
4. Type-checks the frontend

Any type mismatches between frontend and backend will cause compilation errors.
