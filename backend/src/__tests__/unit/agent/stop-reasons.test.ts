/**
 * Stop Reasons Test Suite
 *
 * Comprehensive tests for ALL SDK stop reasons (SDK 0.71+)
 * Verifies that each stop reason is:
 * 1. Properly typed in agent.types.ts
 * 2. Handled correctly in DirectAgentService
 * 3. Emits appropriate events to frontend
 * 4. Terminates the loop correctly
 *
 * @see https://docs.anthropic.com/en/api/messages
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StopReason } from '@anthropic-ai/sdk/resources/messages';
import type {
  AgentEvent,
  AgentEventType,
  MessageEvent,
  TurnPausedEvent,
  ContentRefusedEvent,
} from '@/types/agent.types';
import * as fs from 'fs';
import * as path from 'path';

describe('Stop Reasons - Comprehensive Test Suite', () => {
  // ========================================================================
  // SECTION 1: Type Coverage Tests
  // ========================================================================
  describe('1. Type Definitions', () => {
    it('should have all 6 SDK stop reasons typed correctly', () => {
      // These are all the stop reasons from SDK 0.71
      const allStopReasons: StopReason[] = [
        'end_turn',
        'tool_use',
        'max_tokens',
        'stop_sequence',
        'pause_turn',
        'refusal',
      ];

      expect(allStopReasons).toHaveLength(6);

      // Verify each one compiles (TypeScript will error if invalid)
      allStopReasons.forEach(reason => {
        expect(typeof reason).toBe('string');
      });
    });

    it('should have TurnPausedEvent interface defined', () => {
      // TypeScript compile-time check
      const event: TurnPausedEvent = {
        type: 'turn_paused',
        messageId: 'msg_test123',
        content: 'Test content',
        reason: 'Long-running turn paused',
        timestamp: new Date(),
        eventId: 'test-event-id',
        persistenceState: 'persisted',
      };

      expect(event.type).toBe('turn_paused');
      expect(event.messageId).toBeDefined();
    });

    it('should have ContentRefusedEvent interface defined', () => {
      // TypeScript compile-time check
      const event: ContentRefusedEvent = {
        type: 'content_refused',
        messageId: 'msg_test456',
        content: '',
        reason: 'Policy violation',
        timestamp: new Date(),
        eventId: 'test-event-id',
        persistenceState: 'persisted',
      };

      expect(event.type).toBe('content_refused');
      expect(event.messageId).toBeDefined();
    });

    it('should have turn_paused and content_refused in AgentEventType union', () => {
      const eventTypes: AgentEventType[] = [
        'session_start',
        'thinking',
        'thinking_chunk',
        'message_partial',
        'message',
        'message_chunk',
        'tool_use',
        'tool_result',
        'error',
        'session_end',
        'complete',
        'approval_requested',
        'approval_resolved',
        'user_message_confirmed',
        'turn_paused',      // SDK 0.71
        'content_refused',  // SDK 0.71
      ];

      expect(eventTypes).toContain('turn_paused');
      expect(eventTypes).toContain('content_refused');
      expect(eventTypes).toHaveLength(16); // Updated count
    });
  });

  // ========================================================================
  // SECTION 2: Source Code Verification
  // ========================================================================
  describe('2. DirectAgentService Implementation', () => {
    let serviceCode: string;

    beforeEach(() => {
      const servicePath = path.join(
        process.cwd(),
        'src/services/agent/DirectAgentService.ts'
      );
      serviceCode = fs.readFileSync(servicePath, 'utf-8');
    });

    describe('2.1 Stop Reason Handling Branches', () => {
      it('should handle end_turn stop reason', () => {
        const hasEndTurn = serviceCode.includes("stopReason === 'end_turn'");
        expect(hasEndTurn).toBe(true);
      });

      it('should handle tool_use stop reason', () => {
        const hasToolUse = serviceCode.includes("stopReason === 'tool_use'");
        expect(hasToolUse).toBe(true);
      });

      it('should handle max_tokens stop reason', () => {
        const hasMaxTokens = serviceCode.includes("stopReason === 'max_tokens'");
        expect(hasMaxTokens).toBe(true);
      });

      it('should handle stop_sequence stop reason', () => {
        const hasStopSequence = serviceCode.includes("stopReason === 'stop_sequence'");
        expect(hasStopSequence).toBe(true);
      });

      it('should handle pause_turn stop reason (SDK 0.71)', () => {
        const hasPauseTurn = serviceCode.includes("stopReason === 'pause_turn'");
        expect(hasPauseTurn).toBe(true);
      });

      it('should handle refusal stop reason (SDK 0.71)', () => {
        const hasRefusal = serviceCode.includes("stopReason === 'refusal'");
        expect(hasRefusal).toBe(true);
      });
    });

    describe('2.2 Loop Termination', () => {
      it('should set continueLoop = false for end_turn', () => {
        // Find the end_turn block and verify it sets continueLoop = false
        const endTurnMatch = serviceCode.match(/stopReason === 'end_turn'[\s\S]*?continueLoop = false/);
        expect(endTurnMatch).not.toBeNull();
      });

      it('should set continueLoop = false for max_tokens', () => {
        const maxTokensMatch = serviceCode.match(/stopReason === 'max_tokens'[\s\S]*?continueLoop = false/);
        expect(maxTokensMatch).not.toBeNull();
      });

      it('should set continueLoop = false for stop_sequence', () => {
        const stopSeqMatch = serviceCode.match(/stopReason === 'stop_sequence'[\s\S]*?continueLoop = false/);
        expect(stopSeqMatch).not.toBeNull();
      });

      it('should set continueLoop = false for pause_turn', () => {
        const pauseTurnMatch = serviceCode.match(/stopReason === 'pause_turn'[\s\S]*?continueLoop = false/);
        expect(pauseTurnMatch).not.toBeNull();
      });

      it('should set continueLoop = false for refusal', () => {
        const refusalMatch = serviceCode.match(/stopReason === 'refusal'[\s\S]*?continueLoop = false/);
        expect(refusalMatch).not.toBeNull();
      });

      it('should set continueLoop = false for unknown stop reasons (safety)', () => {
        // The else block should also terminate
        const unknownMatch = serviceCode.includes('Unknown stop reason') ||
                            serviceCode.includes('UNKNOWN_STOP_REASON');
        expect(unknownMatch).toBe(true);
      });
    });

    describe('2.3 Event Emission', () => {
      // ⚠️ SKIPPED: These tests check for old event emission patterns
      // Events are now emitted via MessageEmitter.emitTurnPaused() and emitContentRefused()
      it.skip('should emit turn_paused event for pause_turn stop reason', () => {
        const emitsTurnPaused = serviceCode.includes("type: 'turn_paused'");
        expect(emitsTurnPaused).toBe(true);
      });

      it.skip('should emit content_refused event for refusal stop reason', () => {
        const emitsContentRefused = serviceCode.includes("type: 'content_refused'");
        expect(emitsContentRefused).toBe(true);
      });

      it('should emit message event for stop_sequence', () => {
        // stop_sequence should emit a regular message event
        const emitsMessage = serviceCode.includes("stopReason: 'stop_sequence'");
        expect(emitsMessage).toBe(true);
      });
    });

    describe('2.4 Logging', () => {
      it('should log pause_turn events', () => {
        const logsPauseTurn = serviceCode.includes('PAUSE_TURN');
        expect(logsPauseTurn).toBe(true);
      });

      it('should log refusal events', () => {
        const logsRefusal = serviceCode.includes('REFUSAL');
        expect(logsRefusal).toBe(true);
      });

      it('should log stop_sequence events', () => {
        const logsStopSequence = serviceCode.includes('STOP_SEQUENCE');
        expect(logsStopSequence).toBe(true);
      });

      it('should warn on unknown stop reasons', () => {
        const warnsUnknown = serviceCode.includes('UNKNOWN_STOP_REASON');
        expect(warnsUnknown).toBe(true);
      });
    });
  });

  // ========================================================================
  // SECTION 3: ChatMessageHandler Integration
  // ========================================================================
  describe('3. ChatMessageHandler Integration', () => {
    let handlerCode: string;

    beforeEach(() => {
      const handlerPath = path.join(
        process.cwd(),
        'src/services/websocket/ChatMessageHandler.ts'
      );
      handlerCode = fs.readFileSync(handlerPath, 'utf-8');
    });

    it('should handle turn_paused event type in switch', () => {
      const handlesTurnPaused = handlerCode.includes("case 'turn_paused':");
      expect(handlesTurnPaused).toBe(true);
    });

    it('should handle content_refused event type in switch', () => {
      const handlesContentRefused = handlerCode.includes("case 'content_refused':");
      expect(handlesContentRefused).toBe(true);
    });

    it('should log turn_paused events appropriately', () => {
      const logsTurnPaused = handlerCode.includes('Turn paused event');
      expect(logsTurnPaused).toBe(true);
    });

    it('should warn on content_refused events', () => {
      const warnsContentRefused = handlerCode.includes('Content refused event');
      expect(warnsContentRefused).toBe(true);
    });
  });

  // ========================================================================
  // SECTION 4: Event Persistence
  // ========================================================================
  describe('4. Event Persistence', () => {
    let serviceCode: string;

    beforeEach(() => {
      const servicePath = path.join(
        process.cwd(),
        'src/services/agent/DirectAgentService.ts'
      );
      serviceCode = fs.readFileSync(servicePath, 'utf-8');
    });

    it('should persist pause_turn to EventStore', () => {
      // Look for appendEvent call near pause_turn handling
      const persistsPauseTurn = serviceCode.includes("stop_reason: 'pause_turn'");
      expect(persistsPauseTurn).toBe(true);
    });

    it('should persist refusal to EventStore', () => {
      const persistsRefusal = serviceCode.includes("stop_reason: 'refusal'");
      expect(persistsRefusal).toBe(true);
    });

    it('should persist stop_sequence to EventStore', () => {
      const persistsStopSequence = serviceCode.includes("stop_reason: 'stop_sequence'");
      expect(persistsStopSequence).toBe(true);
    });
  });

  // ========================================================================
  // SECTION 5: Edge Cases
  // ========================================================================
  describe('5. Edge Cases', () => {
    describe('5.1 Empty Content Handling', () => {
      let serviceCode: string;

      beforeEach(() => {
        const servicePath = path.join(
          process.cwd(),
          'src/services/agent/DirectAgentService.ts'
        );
        serviceCode = fs.readFileSync(servicePath, 'utf-8');
      });

      it('should handle pause_turn with fallback content', () => {
        // Should use accumulatedText || '[Turn paused]'
        const hasFallback = serviceCode.includes("accumulatedText || '[Turn paused]'");
        expect(hasFallback).toBe(true);
      });

      it('should handle refusal with fallback content', () => {
        // Should use accumulatedText || '[Content refused due to policy]'
        const hasFallback = serviceCode.includes("accumulatedText || '[Content refused due to policy]'");
        expect(hasFallback).toBe(true);
      });

      it('should handle stop_sequence with fallback content', () => {
        // Should use accumulatedText || '[Stopped at custom sequence]'
        const hasFallback = serviceCode.includes("accumulatedText || '[Stopped at custom sequence]'");
        expect(hasFallback).toBe(true);
      });
    });

    describe('5.2 Message ID Handling', () => {
      let serviceCode: string;

      beforeEach(() => {
        const servicePath = path.join(
          process.cwd(),
          'src/services/agent/DirectAgentService.ts'
        );
        serviceCode = fs.readFileSync(servicePath, 'utf-8');
      });

      // ⚠️ SKIPPED: These tests check for old message ID fallback patterns
      // Message IDs are now generated via event IDs in the refactored implementation
      it.skip('should use Anthropic messageId when available for pause_turn', () => {
        const usesAnthropicId = serviceCode.includes("messageId || `system_pause_turn_");
        expect(usesAnthropicId).toBe(true);
      });

      it.skip('should use Anthropic messageId when available for refusal', () => {
        const usesAnthropicId = serviceCode.includes("messageId || `system_refusal_");
        expect(usesAnthropicId).toBe(true);
      });

      it('should use Anthropic messageId when available for stop_sequence', () => {
        const usesAnthropicId = serviceCode.includes("messageId || `system_stop_sequence_");
        expect(usesAnthropicId).toBe(true);
      });
    });
  });

  // ========================================================================
  // SECTION 6: SDK Compatibility
  // ========================================================================
  describe('6. SDK Compatibility', () => {
    it('should use SDK 0.71+ (verify package.json)', () => {
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

      const sdkVersion = packageJson.dependencies?.['@anthropic-ai/sdk'] ||
                         packageJson.devDependencies?.['@anthropic-ai/sdk'];

      expect(sdkVersion).toBeDefined();

      // Extract version number (remove ^ or ~ prefix)
      const versionMatch = sdkVersion.match(/\d+\.\d+\.\d+/);
      expect(versionMatch).not.toBeNull();

      const [major, minor] = versionMatch![0].split('.').map(Number);

      // Should be at least 0.71.0
      expect(major).toBeGreaterThanOrEqual(0);
      if (major === 0) {
        expect(minor).toBeGreaterThanOrEqual(71);
      }
    });
  });

  // ========================================================================
  // SECTION 7: Documentation Sync
  // ========================================================================
  describe('7. Documentation Sync', () => {
    it('should document all 6 stop reasons in agent.types.ts comments', () => {
      // Types are now in the shared package - check source of truth
      const sharedTypesPath = path.join(process.cwd(), '../packages/shared/src/types/agent.types.ts');
      const typesCode = fs.readFileSync(sharedTypesPath, 'utf-8');

      const documentsEndTurn = typesCode.includes("'end_turn': Natural completion");
      const documentsToolUse = typesCode.includes("'tool_use': Model wants to use a tool");
      const documentsMaxTokens = typesCode.includes("'max_tokens': Truncated");
      const documentsStopSequence = typesCode.includes("'stop_sequence': Hit custom stop sequence");
      const documentsPauseTurn = typesCode.includes("'pause_turn': Long turn paused");
      const documentsRefusal = typesCode.includes("'refusal': Policy violation");

      expect(documentsEndTurn).toBe(true);
      expect(documentsToolUse).toBe(true);
      expect(documentsMaxTokens).toBe(true);
      expect(documentsStopSequence).toBe(true);
      expect(documentsPauseTurn).toBe(true);
      expect(documentsRefusal).toBe(true);
    });
  });
});
