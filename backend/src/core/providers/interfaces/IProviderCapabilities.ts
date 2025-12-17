/**
 * Defines what features a provider supports.
 * Used to conditionally enable UI features like thinking, citations, etc.
 */
export interface IProviderCapabilities {
  streaming: boolean;
  tools: boolean;
  vision: boolean;
  reasoning: boolean;      // Extended thinking / Chain of thought
  citations: boolean;      // RAG source attribution with breakdown
  webSearch: boolean;      // Server-side web search capability
}

/**
 * Capabilities for Anthropic (Claude) models.
 * Supports almost all advanced features including extended thinking.
 */
export const ANTHROPIC_CAPABILITIES: IProviderCapabilities = {
  streaming: true,
  tools: true,
  vision: true,
  reasoning: true,    // Supported via 'thinking' block
  citations: true,    // Supported via RAG citations
  webSearch: true,    // Supported via first-party tool
};

/**
 * Capabilities for Azure OpenAI models (GPT-4 / GPT-4o).
 * Note: Reasoning (o1) logic might differ, this is for standard GPT-4.
 */
export const AZURE_OPENAI_CAPABILITIES: IProviderCapabilities = {
  streaming: true,
  tools: true,
  vision: true,
  reasoning: false,   // Standard GPT-4 does not have native visible reasoning block
  citations: false,   // Typical Azure OpenAI implementation doesn't stream structured citations same way
  webSearch: false,   // Depends on specific deployment configuration
};
