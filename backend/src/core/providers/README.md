# Provider Abstraction Layer

## Overview
This layer abstracts the specific implementation details of Large Language Model (LLM) providers (like Anthropic, OpenAI, etc.) to provide a normalized event stream to the DirectAgentService.

## Architecture

### Interfaces (`/interfaces`)
- **`IStreamAdapter`**: The core interface that all provider adapters must implement. It defines the `processChunk(event: any): INormalizedStreamEvent | null` method.
- **`INormalizedStreamEvent`**: The standardized event format used by the backend business logic. It normalizes distinct provider events (thinking, text, tool use) into a consistent schema.
- **`IProviderCapabilities`**: (Planned) Defines what features a provider supports (e.g., native thinking, streaming, vision).

### Adapters (`/adapters`)
- **`AnthropicStreamAdapter`**: Implementation for Anthropic's Claude models. Handles mapping of LangChain/Anthropic specific events to the normalized format.
- **`StreamAdapterFactory`**: The Factory pattern used to instantiate the correct adapter based on configuration.

## Usage

Instead of instantiating an adapter directly, use the factory:

```typescript
import { StreamAdapterFactory } from '@/core/providers/adapters';

const adapter = StreamAdapterFactory.create({
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-latest',
  sessionId: '...'
});

const normalizedEvent = adapter.processChunk(rawStreamEvent);
```

## Legacy Code & Deprecation
- **Legacy `StreamAdapter.ts`** (`src/core/langchain/StreamAdapter.ts`): This class is **DEPRECATED**. It was tightly coupled to Anthropic and lacked proper normalization for future providers. Do not use it.
