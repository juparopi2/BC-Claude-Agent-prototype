/**
 * CapturedResponseValidator - Provider-Agnostic Response Validation
 *
 * REFACTORED: Phase 8 - Adapted for multi-provider support.
 *
 * This module validates that normalized events from different providers
 * (Anthropic, Azure OpenAI, Google Gemini) produce consistent AgentEvent outputs.
 *
 * ## Validation Strategy
 *
 * Level 1 (Current):
 * - Validates FakeAgentOrchestrator produces correct AgentEvent sequences
 * - Tested via E2E scenario tests (single-tool, max-tokens, error-tool)
 *
 * Level 2 (Future):
 * - Capture real responses from each provider
 * - Validate IStreamAdapter normalizes them consistently
 * - Compare normalized INormalizedStreamEvent sequences across providers
 *
 * ## Architecture
 *
 * ```
 * Real Provider API
 *       ↓
 * IStreamAdapter (provider-specific)
 *       ↓
 * INormalizedStreamEvent (provider-agnostic)
 *       ↓
 * GraphStreamProcessor
 *       ↓
 * AgentEvent (websocket events)
 * ```
 *
 * ## Usage (Future)
 *
 * ```typescript
 * // Capture and compare responses from multiple providers
 * const anthropicEvents = await captureNormalizedEvents('anthropic', scenario);
 * const azureEvents = await captureNormalizedEvents('azure', scenario);
 *
 * // Validate they produce equivalent normalized sequences
 * const result = compareNormalizedSequences(anthropicEvents, azureEvents);
 * expect(result.equivalent).toBe(true);
 * ```
 *
 * @see docs/plans/Refactor/99-FUTURE-DEVELOPMENT.md - Multi-Provider Support
 * @module __tests__/e2e/helpers/CapturedResponseValidator
 */

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { INormalizedStreamEvent } from '@/shared/providers/interfaces/INormalizedEvent';
import type { AgentEvent } from '@bc-agent/shared';

// ============================================================================
// Types
// ============================================================================

/** Supported LLM providers */
export type LLMProvider = 'anthropic' | 'azure' | 'google';

/** Captured normalized response structure */
export interface CapturedNormalizedResponse {
  metadata: {
    capturedAt: string;
    scenario: string;
    provider: LLMProvider;
    model: string;
    /** Version of the normalization adapter */
    adapterVersion: string;
    request: {
      message: string;
      thinking: boolean;
      thinkingBudget?: number;
      toolsEnabled: boolean;
    };
  };
  /** Normalized events from IStreamAdapter */
  normalizedEvents: Array<{
    index: number;
    event: INormalizedStreamEvent;
    timestampMs: number;
  }>;
  /** Final AgentEvents emitted to WebSocket */
  agentEvents: AgentEvent[];
  /** Summary for quick validation */
  contentSummary: {
    hasThinking: boolean;
    hasToolCalls: boolean;
    hasError: boolean;
    textBlockCount: number;
    toolCallCount: number;
    stopReason: string;
  };
}

/** Validation result for provider comparison */
export interface ProviderComparisonResult {
  /** Whether the normalized sequences are equivalent */
  equivalent: boolean;
  /** Detailed discrepancies found */
  discrepancies: ProviderDiscrepancy[];
  /** Overall match score (0-100) */
  score: number;
  /** Per-field match details */
  details: {
    eventTypeSequenceMatch: boolean;
    contentStructureMatch: boolean;
    stopReasonMatch: boolean;
    toolCallsMatch: boolean;
  };
}

/** Discrepancy between provider outputs */
export interface ProviderDiscrepancy {
  type: 'missing_event' | 'extra_event' | 'content_mismatch' | 'structure_mismatch';
  description: string;
  providerA?: string;
  providerB?: string;
  expected?: unknown;
  actual?: unknown;
  severity: 'critical' | 'warning' | 'info';
}

// ============================================================================
// Fixture Management
// ============================================================================

const FIXTURES_DIR = join(__dirname, '../../fixtures/captured');

/**
 * Ensure fixtures directory exists
 */
function ensureFixturesDir(): void {
  if (!existsSync(FIXTURES_DIR)) {
    mkdirSync(FIXTURES_DIR, { recursive: true });
  }
}

/**
 * Load a captured normalized response
 */
export function loadCapturedNormalizedResponse(filename: string): CapturedNormalizedResponse {
  const filepath = join(FIXTURES_DIR, filename);
  if (!existsSync(filepath)) {
    throw new Error(`Captured response not found: ${filepath}`);
  }
  const content = readFileSync(filepath, 'utf-8');
  return JSON.parse(content) as CapturedNormalizedResponse;
}

/**
 * Save a captured normalized response
 */
export function saveCapturedNormalizedResponse(
  response: CapturedNormalizedResponse,
  filename: string
): void {
  ensureFixturesDir();
  const filepath = join(FIXTURES_DIR, filename);
  writeFileSync(filepath, JSON.stringify(response, null, 2));
}

/**
 * List all captured response files
 */
export function listCapturedResponses(): string[] {
  ensureFixturesDir();
  return readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json') && f !== '.gitkeep');
}

/**
 * Load latest captured response for a scenario and provider
 */
export function loadLatestCapturedResponse(
  scenario: string,
  provider: LLMProvider
): CapturedNormalizedResponse | null {
  const prefix = `${scenario}-${provider}`;
  const files = listCapturedResponses()
    .filter(f => f.startsWith(prefix))
    .sort()
    .reverse();

  if (files.length === 0) return null;
  return loadCapturedNormalizedResponse(files[0]!);
}

// ============================================================================
// Validation Functions (Stubs for Future Implementation)
// ============================================================================

/**
 * Compare normalized event sequences from two providers
 *
 * @param eventsA - Normalized events from provider A
 * @param eventsB - Normalized events from provider B
 * @returns Comparison result with discrepancies
 *
 * @example
 * ```typescript
 * const anthropicEvents = [...]; // INormalizedStreamEvent[]
 * const azureEvents = [...];     // INormalizedStreamEvent[]
 * const result = compareNormalizedSequences(anthropicEvents, azureEvents);
 * ```
 */
export function compareNormalizedSequences(
  eventsA: INormalizedStreamEvent[],
  eventsB: INormalizedStreamEvent[]
): ProviderComparisonResult {
  // TODO: Implement when adding multi-provider support (Phase 7)
  // This will compare:
  // 1. Event type sequences (reasoning_delta, content_delta, tool_call, etc.)
  // 2. Content structure (text blocks, tool calls)
  // 3. Stop reasons
  // 4. Error handling

  const discrepancies: ProviderDiscrepancy[] = [];
  let score = 100;

  // Basic length comparison
  if (eventsA.length !== eventsB.length) {
    discrepancies.push({
      type: 'structure_mismatch',
      description: `Event count mismatch: ${eventsA.length} vs ${eventsB.length}`,
      severity: 'warning',
    });
    score -= 10;
  }

  // Compare event types
  const typesA = eventsA.map(e => e.type);
  const typesB = eventsB.map(e => e.type);
  const eventTypeSequenceMatch = JSON.stringify(typesA) === JSON.stringify(typesB);

  if (!eventTypeSequenceMatch) {
    discrepancies.push({
      type: 'structure_mismatch',
      description: 'Event type sequence mismatch',
      expected: typesA,
      actual: typesB,
      severity: 'critical',
    });
    score -= 30;
  }

  return {
    equivalent: discrepancies.length === 0,
    discrepancies,
    score: Math.max(0, score),
    details: {
      eventTypeSequenceMatch,
      contentStructureMatch: true, // TODO: Implement
      stopReasonMatch: true,       // TODO: Implement
      toolCallsMatch: true,        // TODO: Implement
    },
  };
}

/**
 * Validate AgentEvents match expected structure
 *
 * @param events - AgentEvents from WebSocket
 * @param expectedSummary - Expected content summary
 * @returns Validation result
 */
export function validateAgentEvents(
  events: AgentEvent[],
  expectedSummary: CapturedNormalizedResponse['contentSummary']
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for required event types based on scenario
  const eventTypes = events.map(e => e.type);

  // Every flow should have user_message_confirmed and complete
  if (!eventTypes.includes('user_message_confirmed')) {
    errors.push('Missing user_message_confirmed event');
  }
  if (!eventTypes.includes('complete')) {
    errors.push('Missing complete event');
  }

  // Check thinking events if expected
  if (expectedSummary.hasThinking) {
    const hasThinking = eventTypes.includes('thinking_chunk') || eventTypes.includes('thinking_complete');
    if (!hasThinking) {
      errors.push('Expected thinking events but none found');
    }
  }

  // Check tool events if expected
  if (expectedSummary.hasToolCalls) {
    const hasToolUse = eventTypes.includes('tool_use');
    const hasToolResult = eventTypes.includes('tool_result');
    if (!hasToolUse) {
      errors.push('Expected tool_use event but none found');
    }
    if (!hasToolResult) {
      errors.push('Expected tool_result event but none found');
    }
  }

  // Check error events if expected
  if (expectedSummary.hasError) {
    const hasError = eventTypes.includes('error');
    if (!hasError) {
      errors.push('Expected error event but none found');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// Legacy Compatibility (Deprecated)
// ============================================================================

/**
 * @deprecated Use loadCapturedNormalizedResponse instead
 * Kept for backward compatibility during migration
 */
export interface CapturedResponse {
  metadata: {
    capturedAt: string;
    scenario: string;
    model: string;
    sdkVersion: string;
    scriptVersion: string;
    request: {
      message: string;
      thinking: boolean;
      thinkingBudget?: number;
      toolsEnabled: boolean;
      toolCount: number;
    };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  finalResponse: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  streamingEvents: Array<{ index: number; event: any; timestampMs: number }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eventTimings: any[];
  contentSummary: {
    thinkingBlocks: number;
    textBlocks: number;
    toolUseBlocks: number;
  };
}

/**
 * @deprecated Use loadCapturedNormalizedResponse instead
 */
export function loadCapturedResponse(filename: string): CapturedResponse {
  console.warn('loadCapturedResponse is deprecated. Use loadCapturedNormalizedResponse instead.');
  const filepath = join(FIXTURES_DIR, filename);
  if (!existsSync(filepath)) {
    throw new Error(`Captured response not found: ${filepath}`);
  }
  const content = readFileSync(filepath, 'utf-8');
  return JSON.parse(content) as CapturedResponse;
}
