/**
 * @module domains/agent
 *
 * Agent domain - Screaming Architecture refactor of DirectAgentService
 *
 * This domain handles all agent orchestration, streaming, tool execution,
 * and message persistence. Each subdomain has a focused responsibility:
 *
 * - orchestration: Main coordinator (AgentOrchestrator)
 * - context: System prompt + conversation history building
 * - streaming: Anthropic stream processing and normalization
 * - tools: Tool execution and approval gates
 * - persistence: Message saving to EventStore + MessageQueue
 * - emission: WebSocket event emission
 * - usage: Token usage tracking
 */

export * from './orchestration';
export * from './context';
export * from './streaming';
export * from './tools';
export * from './persistence';
export * from './emission';
export * from './usage';
