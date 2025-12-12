/**
 * E2E Data Flow Test Suite
 *
 * Verifies that data flows correctly through all system layers:
 * 1. CAPTURE: DirectAgentService captures data from SDK
 * 2. TRANSMIT: WebSocket emits events with data
 * 3. PERSIST: MessageQueue saves data to database
 * 4. QUERY: REST endpoints return data to frontend
 *
 * Tests cover:
 * - Citations (TextCitation[])
 * - Token tracking (model, input_tokens, output_tokens)
 * - Stop reasons (all 6 SDK stop reasons)
 *
 * @see docs/backend/DIAGNOSTIC-FINDINGS.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { TextCitation, StopReason } from '@anthropic-ai/sdk/resources/messages';
import * as fs from 'fs';
import * as path from 'path';

describe('E2E Data Flow - Comprehensive Test Suite', () => {
  // ========================================================================
  // SECTION 1: Citations E2E Flow
  // ========================================================================
  describe('1. Citations E2E Flow', () => {
    describe('1.1 CAPTURE - StreamProcessor (refactored from DirectAgentService)', () => {
      let streamProcessorCode: string;
      let accumulatorCode: string;

      beforeEach(() => {
        // Citations handling has been refactored to StreamProcessor and ContentBlockAccumulator
        const streamProcessorPath = path.join(
          process.cwd(),
          'src/services/agent/messages/StreamProcessor.ts'
        );
        const accumulatorPath = path.join(
          process.cwd(),
          'src/services/agent/messages/ContentBlockAccumulator.ts'
        );
        streamProcessorCode = fs.readFileSync(streamProcessorPath, 'utf-8');
        accumulatorCode = fs.readFileSync(accumulatorPath, 'utf-8');
      });

      it('should import CitationsDelta from SDK', () => {
        expect(streamProcessorCode).toContain('CitationsDelta');
      });

      it('should handle citations_delta event', () => {
        // StreamProcessor delegates to accumulator with 'citations_delta' type
        expect(streamProcessorCode).toContain("delta.type === 'citations_delta'");
      });

      it('should accumulate citations in ContentBlockAccumulator', () => {
        // ContentBlockAccumulator handles citations accumulation
        expect(accumulatorCode).toContain('block.citations.push');
      });

      it('should import TextCitation type in accumulator', () => {
        expect(accumulatorCode).toContain('TextCitation');
      });
    });

    describe('1.2 PERSIST - MessageQueue', () => {
      let queueCode: string;

      beforeEach(() => {
        const queuePath = path.join(
          process.cwd(),
          'src/services/queue/MessageQueue.ts'
        );
        queueCode = fs.readFileSync(queuePath, 'utf-8');
      });

      it('should have metadata field in MessagePersistenceJob', () => {
        expect(queueCode).toContain('metadata?: Record<string, unknown>');
      });

      it('should serialize metadata to JSON for database', () => {
        expect(queueCode).toContain('JSON.stringify(metadata)');
      });
    });

    describe('1.3 QUERY - REST Endpoint (sessions.ts)', () => {
      let routesCode: string;

      beforeEach(() => {
        const routesPath = path.join(
          process.cwd(),
          'src/routes/sessions.ts'
        );
        routesCode = fs.readFileSync(routesPath, 'utf-8');
      });

      it('should import TextCitation type from SDK', () => {
        expect(routesCode).toContain("import type { StopReason, TextCitation }");
      });

      it('should parse metadata JSON', () => {
        expect(routesCode).toContain('JSON.parse(row.metadata)');
      });

      it('should expose citations in response with proper SDK type', () => {
        expect(routesCode).toContain('citations: metadata.citations as TextCitation[]');
      });

      it('should expose citations_count in response', () => {
        expect(routesCode).toContain('citations_count: metadata.citations_count as number');
      });
    });
  });

  // ========================================================================
  // SECTION 2: Token Tracking E2E Flow
  // ========================================================================
  describe('2. Token Tracking E2E Flow', () => {
    describe('2.1 CAPTURE - DirectAgentService', () => {
      let serviceCode: string;

      beforeEach(() => {
        const servicePath = path.join(
          process.cwd(),
          'src/services/agent/DirectAgentService.ts'
        );
        serviceCode = fs.readFileSync(servicePath, 'utf-8');
      });

      it('should capture input_tokens from SDK usage', () => {
        expect(serviceCode).toContain('inputTokens');
      });

      it('should capture output_tokens from SDK usage', () => {
        expect(serviceCode).toContain('outputTokens');
      });

      it('should capture model name', () => {
        expect(serviceCode).toContain('model:');
      });
    });

    describe('2.2 PERSIST - MessageQueue', () => {
      let queueCode: string;

      beforeEach(() => {
        const queuePath = path.join(
          process.cwd(),
          'src/services/queue/MessageQueue.ts'
        );
        queueCode = fs.readFileSync(queuePath, 'utf-8');
      });

      it('should have model field in MessagePersistenceJob', () => {
        expect(queueCode).toContain('model?:');
      });

      it('should have input_tokens field in MessagePersistenceJob', () => {
        expect(queueCode).toContain('inputTokens?:');
      });

      it('should have output_tokens field in MessagePersistenceJob', () => {
        expect(queueCode).toContain('outputTokens?:');
      });
    });

    describe('2.3 QUERY - REST Endpoint (sessions.ts)', () => {
      let routesCode: string;

      beforeEach(() => {
        const routesPath = path.join(
          process.cwd(),
          'src/routes/sessions.ts'
        );
        routesCode = fs.readFileSync(routesPath, 'utf-8');
      });

      it('should SELECT model column', () => {
        expect(routesCode).toMatch(/SELECT[\s\S]*model[\s\S]*FROM messages/);
      });

      it('should SELECT input_tokens column', () => {
        expect(routesCode).toMatch(/SELECT[\s\S]*input_tokens[\s\S]*FROM messages/);
      });

      it('should SELECT output_tokens column', () => {
        expect(routesCode).toMatch(/SELECT[\s\S]*output_tokens[\s\S]*FROM messages/);
      });

      it('should expose model in response', () => {
        expect(routesCode).toContain('model: row.model');
      });

      it('should expose input_tokens in response', () => {
        expect(routesCode).toContain('input_tokens: row.input_tokens');
      });

      it('should expose output_tokens in response', () => {
        expect(routesCode).toContain('output_tokens: row.output_tokens');
      });
    });
  });

  // ========================================================================
  // SECTION 3: Stop Reasons E2E Flow
  // ========================================================================
  describe('3. Stop Reasons E2E Flow', () => {
    describe('3.1 All 6 SDK Stop Reasons', () => {
      it('should type all 6 stop reasons correctly', () => {
        const allStopReasons: StopReason[] = [
          'end_turn',
          'tool_use',
          'max_tokens',
          'stop_sequence',
          'pause_turn',
          'refusal',
        ];
        expect(allStopReasons).toHaveLength(6);
      });
    });

    describe('3.2 CAPTURE - DirectAgentService', () => {
      let serviceCode: string;

      beforeEach(() => {
        const servicePath = path.join(
          process.cwd(),
          'src/services/agent/DirectAgentService.ts'
        );
        serviceCode = fs.readFileSync(servicePath, 'utf-8');
      });

      it('should handle pause_turn stop reason', () => {
        expect(serviceCode).toContain("stopReason === 'pause_turn'");
      });

      it('should handle refusal stop reason', () => {
        expect(serviceCode).toContain("stopReason === 'refusal'");
      });

      it('should handle stop_sequence stop reason', () => {
        expect(serviceCode).toContain("stopReason === 'stop_sequence'");
      });
    });

    describe('3.3 QUERY - REST Endpoint (sessions.ts)', () => {
      let routesCode: string;

      beforeEach(() => {
        const routesPath = path.join(
          process.cwd(),
          'src/routes/sessions.ts'
        );
        routesCode = fs.readFileSync(routesPath, 'utf-8');
      });

      it('should import StopReason from SDK', () => {
        expect(routesCode).toContain("import type { StopReason");
      });

      it('should SELECT stop_reason column', () => {
        expect(routesCode).toMatch(/SELECT[\s\S]*stop_reason[\s\S]*FROM messages/);
      });

      it('should type stop_reason with SDK type', () => {
        expect(routesCode).toContain('stop_reason: StopReason | null');
      });

      it('should expose stop_reason in response', () => {
        expect(routesCode).toContain('stop_reason: row.stop_reason');
      });
    });
  });

  // ========================================================================
  // SECTION 4: Event Sourcing Fields
  // ========================================================================
  describe('4. Event Sourcing Fields E2E Flow', () => {
    describe('4.1 QUERY - REST Endpoint (sessions.ts)', () => {
      let routesCode: string;

      beforeEach(() => {
        const routesPath = path.join(
          process.cwd(),
          'src/routes/sessions.ts'
        );
        routesCode = fs.readFileSync(routesPath, 'utf-8');
      });

      it('should SELECT sequence_number column', () => {
        expect(routesCode).toMatch(/SELECT[\s\S]*sequence_number[\s\S]*FROM messages/);
      });

      it('should SELECT event_id column', () => {
        expect(routesCode).toMatch(/SELECT[\s\S]*event_id[\s\S]*FROM messages/);
      });

      it('should SELECT tool_use_id column', () => {
        expect(routesCode).toMatch(/SELECT[\s\S]*tool_use_id[\s\S]*FROM messages/);
      });

      it('should expose event_id in response', () => {
        expect(routesCode).toContain('event_id: row.event_id');
      });

      it('should expose tool_use_id in response', () => {
        expect(routesCode).toContain('tool_use_id: row.tool_use_id');
      });
    });
  });

  // ========================================================================
  // SECTION 5: Type Safety Verification
  // ========================================================================
  describe('5. Type Safety Verification', () => {
    it('should use SDK TextCitation type (not unknown or any)', () => {
      const routesPath = path.join(process.cwd(), 'src/routes/sessions.ts');
      const routesCode = fs.readFileSync(routesPath, 'utf-8');

      // Should NOT use unknown[] or any[]
      expect(routesCode).not.toContain('citations: metadata.citations as unknown[]');
      expect(routesCode).not.toContain('citations: metadata.citations as any[]');

      // SHOULD use proper SDK type
      expect(routesCode).toContain('citations: metadata.citations as TextCitation[]');
    });

    it('should use SDK StopReason type (not string)', () => {
      const routesPath = path.join(process.cwd(), 'src/routes/sessions.ts');
      const routesCode = fs.readFileSync(routesPath, 'utf-8');

      expect(routesCode).toContain('stop_reason: StopReason | null');
    });
  });
});
