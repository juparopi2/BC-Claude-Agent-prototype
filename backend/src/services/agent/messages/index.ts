/**
 * Message Services
 *
 * Extracted from DirectAgentService for cleaner separation of concerns.
 * Handles content block accumulation, ordering, and WebSocket emission.
 */

// Types
export * from './types';

// Services
export { ContentBlockAccumulator } from './ContentBlockAccumulator';
export { StreamProcessor, blocksToAnthropicFormat } from './StreamProcessor';
export type { StreamEvent, StreamProcessorOptions } from './StreamProcessor';
export { MessageOrderingService, getMessageOrderingService } from './MessageOrderingService';
export type { OrderedEventData, OrderedEventResult } from './MessageOrderingService';
export { MessageEmitter, getMessageEmitter, resetMessageEmitter } from './MessageEmitter';
export type { IMessageEmitter } from './MessageEmitter';
