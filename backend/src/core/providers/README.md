# Provider Abstraction Layer

## Overview

This layer abstracts the specific implementation details of Large Language Model (LLM) providers (like Anthropic, OpenAI, etc.) to provide a normalized event stream to the DirectAgentService.

**Key Principle**: Business logic should NEVER depend on provider-specific event types. All events are normalized to `INormalizedStreamEvent`.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│      BUSINESS LOGIC (Provider-Agnostic)                 │
│      DirectAgentService, MessageEmitter, etc.           │
├─────────────────────────────────────────────────────────┤
│      NORMALIZED EVENTS                                  │
│      INormalizedStreamEvent                             │
├─────────────────────────────────────────────────────────┤
│      ADAPTERS (Provider-Specific)                       │
│      AnthropicStreamAdapter, (future: AzureOpenAI...)   │
├─────────────────────────────────────────────────────────┤
│      LANGCHAIN WRAPPERS                                 │
│      ChatAnthropic, AzureChatOpenAI                     │
└─────────────────────────────────────────────────────────┘
```

### Interfaces (`/interfaces`)

- **`IStreamAdapter`**: Core interface for all provider adapters
  - `processChunk(event: StreamEvent): INormalizedStreamEvent | null`
  - `reset(): void`
  - `getCurrentBlockIndex(): number`

- **`INormalizedStreamEvent`**: Standardized event format
  - Types: `reasoning_delta`, `content_delta`, `tool_call`, `citation`, `usage`
  - Provider-agnostic metadata: `blockIndex`, `messageId`, `isStreaming`, `isFinal`

- **`IProviderCapabilities`**: Feature matrix per provider
  - `streaming`, `tools`, `vision`, `reasoning`, `citations`, `webSearch`

### Adapters (`/adapters`)

- **`AnthropicStreamAdapter`**: Claude models implementation
- **`StreamAdapterFactory`**: Factory pattern for adapter instantiation

## Usage

```typescript
import { StreamAdapterFactory } from '@/core/providers/adapters';

// Create adapter via factory (NOT direct instantiation)
const adapter = StreamAdapterFactory.create('anthropic', sessionId);

// Process LangChain stream events
const normalizedEvent = adapter.processChunk(langchainStreamEvent);

if (normalizedEvent?.type === 'reasoning_delta') {
  // Handle thinking/reasoning content
}
```

## Event Normalization

| Provider Event | Normalized Event | Description |
|----------------|------------------|-------------|
| `thinking_delta` (Anthropic) | `reasoning_delta` | Extended thinking content |
| `text_delta` (Anthropic) | `content_delta` | Visible response text |
| `tool_use` (Anthropic) | `tool_call` | Tool execution request |
| `citations_delta` (Anthropic) | `citation` | RAG source attribution |
| `usage` (LangChain) | `usage` | Token counts (camelCase) |

## Testing

**Test Location**: `backend/src/__tests__/unit/core/providers/`

Tests are centralized in the main test directory, not co-located with source files.

```bash
# Run provider tests
npm test -- AnthropicStreamAdapter StreamAdapterFactory

# Run with coverage
npm run test:coverage -- --include="**/providers/**/*.ts"
```

**Test Files**:
- `AnthropicStreamAdapter.test.ts` - Adapter unit tests
- `StreamAdapterFactory.test.ts` - Factory pattern tests

## Adding a New Provider

1. Create adapter in `/adapters/` implementing `IStreamAdapter`
2. Add provider capabilities to `IProviderCapabilities`
3. Update `StreamAdapterFactory.create()` switch statement
4. Add tests in `__tests__/unit/core/providers/`

## Legacy Code & Deprecation

- **`StreamAdapter.ts`** (`src/core/langchain/`): **DEPRECATED**
  - Tightly coupled to Anthropic
  - No normalization for multi-provider support
  - Will be removed in future phase

---

*Last updated: 2025-12-17*
