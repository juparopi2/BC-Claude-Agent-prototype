/**
 * CapturedResponseValidator - Level 1 Mock Validation
 *
 * Validates FakeAnthropicClient against captured real Anthropic API responses.
 * Level 1 validates raw MessageStreamEvent sequences.
 * Level 2 (TD-E2E-005) will add AnthropicStreamAdapter normalization validation.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import type {
  Message,
  MessageStreamEvent,
  ContentBlock,
} from '@anthropic-ai/sdk/resources/messages';
import {
  ANTHROPIC_SDK_VERSION,
  isTextBlock,
  isToolUseBlock,
  isThinkingBlock,
} from '@/types/sdk';
import { FakeAnthropicClient } from '@/services/agent/FakeAnthropicClient';
import type { ChatCompletionRequest } from '@/services/agent/IAnthropicClient';

// ============================================================================
// Types
// ============================================================================

/** Captured response structure (matches capture script output) */
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
  finalResponse: Message;
  streamingEvents: Array<{
    index: number;
    event: MessageStreamEvent;
    timestampMs: number;
  }>;
  eventTimings: { type: string; deltaMs: number }[];
  contentSummary: {
    thinkingBlocks: number;
    textBlocks: number;
    toolUseBlocks: number;
  };
}

/** Validation result */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  score: number;
  details: {
    eventSequenceMatch: boolean;
    requiredEventsPresent: boolean;
    contentStructureMatch: boolean;
    sdkVersionMatch: boolean;
  };
}

/** Discrepancy found during validation */
export interface Discrepancy {
  type: 'missing_event' | 'extra_event' | 'wrong_order' | 'content_mismatch' | 'missing_field';
  description: string;
  expected?: unknown;
  actual?: unknown;
  severity: 'critical' | 'warning' | 'info';
}

/** Suggested fix for FakeAnthropicClient */
export interface DiscrepancyFix {
  file: string;
  description: string;
  currentPattern?: string;
  suggestedPattern: string;
  severity: 'critical' | 'warning' | 'info';
}

/** SDK change report */
export interface SDKChangeReport {
  versionChanged: boolean;
  from?: string;
  to: string;
  recommendation?: string;
}

// ============================================================================
// Fixture Loading
// ============================================================================

const FIXTURES_DIR = join(__dirname, '../../fixtures/captured');

export function loadCapturedResponse(filename: string): CapturedResponse {
  const filepath = join(FIXTURES_DIR, filename);
  if (!existsSync(filepath)) {
    throw new Error(`Captured response not found: ${filepath}`);
  }
  const content = readFileSync(filepath, 'utf-8');
  return JSON.parse(content) as CapturedResponse;
}

export function listCapturedResponses(): string[] {
  if (!existsSync(FIXTURES_DIR)) return [];
  return readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json') && f !== '.gitkeep');
}

export function loadLatestCapturedResponse(scenarioPrefix: string): CapturedResponse | null {
  const files = listCapturedResponses()
    .filter(f => f.startsWith(scenarioPrefix))
    .sort()
    .reverse();
  if (files.length === 0) return null;
  return loadCapturedResponse(files[0]!);
}

// ============================================================================
// FakeAnthropicClient Integration
// ============================================================================

/**
 * Extracts FakeResponse config from captured real response
 */
export function extractFakeConfigFromCaptured(captured: CapturedResponse) {
  const { content, stop_reason } = captured.finalResponse;

  return {
    textBlocks: content
      .filter((b): b is typeof b & { type: 'text' } => isTextBlock(b as ContentBlock))
      .map(b => b.text),
    thinkingBlocks: content
      .filter((b): b is typeof b & { type: 'thinking' } => isThinkingBlock(b as ContentBlock))
      .map(b => (b as { thinking: string }).thinking),
    toolUseBlocks: content
      .filter((b): b is typeof b & { type: 'tool_use' } => isToolUseBlock(b as ContentBlock))
      .map(b => ({
        id: (b as { id: string }).id,
        name: (b as { name: string }).name,
        input: (b as { input: Record<string, unknown> }).input,
      })),
    stopReason: stop_reason as 'end_turn' | 'tool_use' | 'max_tokens',
    suppressAutoThinking: true, // Use captured thinking, not auto-generated
  };
}

/**
 * Builds a ChatCompletionRequest from captured metadata
 */
export function buildRequestFromCaptured(captured: CapturedResponse): ChatCompletionRequest {
  return {
    model: captured.metadata.model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: captured.metadata.request.message }],
    thinking: captured.metadata.request.thinking
      ? { type: 'enabled', budget_tokens: captured.metadata.request.thinkingBudget || 5000 }
      : undefined,
  };
}

/**
 * Generates FakeAnthropicClient events matching a captured scenario
 */
export async function generateFakeEvents(
  captured: CapturedResponse
): Promise<MessageStreamEvent[]> {
  const fake = new FakeAnthropicClient();
  fake.addResponse(extractFakeConfigFromCaptured(captured));

  const events: MessageStreamEvent[] = [];
  const request = buildRequestFromCaptured(captured);

  for await (const event of fake.createChatCompletionStream(request)) {
    events.push(event);
  }
  return events;
}

// ============================================================================
// Validation Functions
// ============================================================================

const REQUIRED_EVENTS = [
  'message_start',
  'content_block_start',
  'content_block_stop',
  'message_delta',
  'message_stop',
];

/**
 * Validates streaming events match (Level 1)
 */
export function validateStreamingEvents(
  fakeEvents: MessageStreamEvent[],
  captured: CapturedResponse
): ValidationResult {
  const capturedEvents = captured.streamingEvents.map(e => e.event);
  const errors: string[] = [];
  const warnings: string[] = [];

  // Extract event types
  const fakeTypes = fakeEvents.map(e => e.type);
  const capturedTypes = capturedEvents.map(e => e.type);

  // 1. Check event sequence structure
  const eventSequenceMatch = validateEventSequence(fakeTypes, capturedTypes, errors);

  // 2. Check required events
  const requiredEventsPresent = validateRequiredEvents(fakeTypes, capturedTypes, errors);

  // 3. Check content structure
  const contentStructureMatch = validateContentStructure(
    fakeEvents,
    capturedEvents,
    captured.contentSummary,
    errors,
    warnings
  );

  // 4. Check SDK version
  const sdkVersionMatch = captured.metadata.sdkVersion === ANTHROPIC_SDK_VERSION;
  if (!sdkVersionMatch) {
    warnings.push(
      `SDK version mismatch: captured=${captured.metadata.sdkVersion}, current=${ANTHROPIC_SDK_VERSION}`
    );
  }

  // Calculate score
  const score = calculateScore(eventSequenceMatch, requiredEventsPresent, contentStructureMatch, errors.length, warnings.length);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    score,
    details: {
      eventSequenceMatch,
      requiredEventsPresent,
      contentStructureMatch,
      sdkVersionMatch,
    },
  };
}

function validateEventSequence(fakeTypes: string[], capturedTypes: string[], errors: string[]): boolean {
  let match = true;

  // Both should start with message_start
  if (fakeTypes[0] !== 'message_start') {
    errors.push('Fake response should start with message_start');
    match = false;
  }

  // Both should end with message_stop
  if (fakeTypes[fakeTypes.length - 1] !== 'message_stop') {
    errors.push('Fake response should end with message_stop');
    match = false;
  }

  // Check message_delta before message_stop
  const fakeHasDelta = fakeTypes.includes('message_delta');
  const capturedHasDelta = capturedTypes.includes('message_delta');
  if (fakeHasDelta !== capturedHasDelta) {
    errors.push(`message_delta presence mismatch: fake=${fakeHasDelta}, captured=${capturedHasDelta}`);
    match = false;
  }

  return match;
}

function validateRequiredEvents(fakeTypes: string[], capturedTypes: string[], errors: string[]): boolean {
  let present = true;

  for (const required of REQUIRED_EVENTS) {
    if (!fakeTypes.includes(required)) {
      errors.push(`Fake response missing required event: ${required}`);
      present = false;
    }
  }

  return present;
}

function validateContentStructure(
  fakeEvents: MessageStreamEvent[],
  capturedEvents: MessageStreamEvent[],
  expectedSummary: { thinkingBlocks: number; textBlocks: number; toolUseBlocks: number },
  errors: string[],
  warnings: string[]
): boolean {
  // Count content blocks in fake
  let fakeThinking = 0;
  let fakeText = 0;
  let fakeToolUse = 0;

  for (const event of fakeEvents) {
    if (event.type === 'content_block_start') {
      const blockType = (event as { content_block?: { type: string } }).content_block?.type;
      if (blockType === 'thinking') fakeThinking++;
      else if (blockType === 'text') fakeText++;
      else if (blockType === 'tool_use') fakeToolUse++;
    }
  }

  let match = true;

  // Check thinking blocks
  if ((fakeThinking > 0) !== (expectedSummary.thinkingBlocks > 0)) {
    errors.push(`Thinking block presence mismatch: fake=${fakeThinking > 0}, expected=${expectedSummary.thinkingBlocks > 0}`);
    match = false;
  }

  // Check text blocks
  if ((fakeText > 0) !== (expectedSummary.textBlocks > 0)) {
    errors.push(`Text block presence mismatch: fake=${fakeText > 0}, expected=${expectedSummary.textBlocks > 0}`);
    match = false;
  }

  // Check tool use blocks
  if ((fakeToolUse > 0) !== (expectedSummary.toolUseBlocks > 0)) {
    errors.push(`Tool use block presence mismatch: fake=${fakeToolUse > 0}, expected=${expectedSummary.toolUseBlocks > 0}`);
    match = false;
  }

  // Warn about count differences
  if (fakeThinking !== expectedSummary.thinkingBlocks) {
    warnings.push(`Thinking block count: fake=${fakeThinking}, expected=${expectedSummary.thinkingBlocks}`);
  }
  if (fakeText !== expectedSummary.textBlocks) {
    warnings.push(`Text block count: fake=${fakeText}, expected=${expectedSummary.textBlocks}`);
  }

  return match;
}

function calculateScore(
  eventMatch: boolean,
  requiredPresent: boolean,
  contentMatch: boolean,
  errorCount: number,
  warningCount: number
): number {
  let score = 100;
  if (!eventMatch) score -= 30;
  if (!requiredPresent) score -= 30;
  if (!contentMatch) score -= 25;
  score -= Math.min(warningCount * 2, 15);
  return Math.max(0, score);
}

// ============================================================================
// SDK Change Detection
// ============================================================================

export function detectSDKChanges(captured: CapturedResponse): SDKChangeReport {
  const capturedVersion = captured.metadata.sdkVersion;
  const currentVersion = ANTHROPIC_SDK_VERSION;

  if (capturedVersion !== currentVersion) {
    return {
      versionChanged: true,
      from: capturedVersion,
      to: currentVersion,
      recommendation: 'Re-run capture script to update fixtures with new SDK version',
    };
  }

  return {
    versionChanged: false,
    to: currentVersion,
  };
}

// ============================================================================
// Auto-Adjustment Suggestions
// ============================================================================

/**
 * Analyzes discrepancies and suggests fixes for FakeAnthropicClient
 */
export function suggestFakeAdjustments(
  validationResult: ValidationResult,
  fakeEvents: MessageStreamEvent[],
  captured: CapturedResponse
): DiscrepancyFix[] {
  const fixes: DiscrepancyFix[] = [];
  const capturedEvents = captured.streamingEvents.map(e => e.event);

  // Check for missing event types in fake
  const fakeTypes = new Set(fakeEvents.map(e => e.type));
  const capturedTypes = new Set(capturedEvents.map(e => e.type));

  for (const capturedType of capturedTypes) {
    if (!fakeTypes.has(capturedType)) {
      fixes.push({
        file: 'backend/src/services/agent/FakeAnthropicClient.ts',
        description: `FakeAnthropicClient does not emit '${capturedType}' events`,
        suggestedPattern: `Add yield for ${capturedType} event type in createChatCompletionStream()`,
        severity: 'critical',
      });
    }
  }

  // Check for extra event types in fake
  for (const fakeType of fakeTypes) {
    if (!capturedTypes.has(fakeType)) {
      fixes.push({
        file: 'backend/src/services/agent/FakeAnthropicClient.ts',
        description: `FakeAnthropicClient emits '${fakeType}' events not present in real API response`,
        suggestedPattern: `Review if ${fakeType} should be emitted for this scenario`,
        severity: 'warning',
      });
    }
  }

  // Check content block structure differences
  for (const error of validationResult.errors) {
    if (error.includes('content_block')) {
      fixes.push({
        file: 'backend/src/services/agent/FakeAnthropicClient.ts',
        description: error,
        suggestedPattern: 'Review content block generation in createChatCompletionStream()',
        severity: 'critical',
      });
    }
  }

  return fixes;
}

// ============================================================================
// Main Validation Function
// ============================================================================

/**
 * Full validation pipeline for a captured scenario
 */
export async function validateScenario(
  scenarioPrefix: string
): Promise<{
  captured: CapturedResponse | null;
  validation: ValidationResult | null;
  fixes: DiscrepancyFix[];
  sdkChanges: SDKChangeReport | null;
}> {
  const captured = loadLatestCapturedResponse(scenarioPrefix);

  if (!captured) {
    return {
      captured: null,
      validation: null,
      fixes: [],
      sdkChanges: null,
    };
  }

  // Check SDK version
  const sdkChanges = detectSDKChanges(captured);

  // Generate fake events
  const fakeEvents = await generateFakeEvents(captured);

  // Validate
  const validation = validateStreamingEvents(fakeEvents, captured);

  // Suggest fixes
  const fixes = suggestFakeAdjustments(validation, fakeEvents, captured);

  return {
    captured,
    validation,
    fixes,
    sdkChanges,
  };
}
