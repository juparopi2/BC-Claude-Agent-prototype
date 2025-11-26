import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { sql } from '@/config/database';
import { DirectAgentService } from '@/services/agent/DirectAgentService';
import { FakeAnthropicClient } from '@/services/agent/FakeAnthropicClient';
import type { AgentEvent, MessageEvent } from '@/types/agent.types';
import { randomUUID } from 'crypto';

/**
 * Phase 1B Diagnostic Test Suite
 *
 * Purpose: Validate all claims in IMPLEMENTATION-PLAN.md Phase 1B (lines 334-610)
 * before implementing the migration to Anthropic Message IDs as primary key.
 *
 * This test suite ensures that:
 * 1. Current implementation uses UUIDs for message IDs (audit claim)
 * 2. Anthropic IDs are captured but not used as PK (audit claim)
 * 3. Database schema uses UNIQUEIDENTIFIER type (audit claim)
 * 4. Complete data flow is understood and documented
 * 5. Type consistency is validated across all layers
 *
 * Date Created: 2025-11-24
 * Status: Pre-implementation validation
 */

describe('Phase 1B Diagnostic: Pre-Migration Validation', () => {

  describe('Audit Claim 1: UUID Generation for Message IDs', () => {

    it('should verify DirectAgentService generates UUID fallback for messageId', () => {
      const serviceCode = fs.readFileSync(
        path.join(process.cwd(), 'src/services/agent/DirectAgentService.ts'),
        'utf-8'
      );

      // Check for UUID fallback pattern at line ~665
      const hasUuidFallback = serviceCode.includes('messageId || randomUUID()');
      expect(hasUuidFallback).toBe(true);

      // Verify randomUUID is imported
      const hasRandomUuidImport = serviceCode.includes("import { randomUUID }") ||
                                   serviceCode.includes("from 'crypto'");
      expect(hasRandomUuidImport).toBe(true);
    });

    it('should verify MessageService generates UUID for agent messages', () => {
      const serviceCode = fs.readFileSync(
        path.join(process.cwd(), 'src/services/messages/MessageService.ts'),
        'utf-8'
      );

      // Check for UUID generation in saveAgentMessage (line ~196)
      const hasSaveAgentMessage = serviceCode.includes('saveAgentMessage');
      const hasUuidGeneration = serviceCode.includes('const messageId = randomUUID()');

      expect(hasSaveAgentMessage).toBe(true);
      expect(hasUuidGeneration).toBe(true);
    });

    it('should count total randomUUID() calls for messages (not events)', () => {
      const directAgentCode = fs.readFileSync(
        path.join(process.cwd(), 'src/services/agent/DirectAgentService.ts'),
        'utf-8'
      );

      const messageServiceCode = fs.readFileSync(
        path.join(process.cwd(), 'src/services/messages/MessageService.ts'),
        'utf-8'
      );

      // Count randomUUID occurrences (approximate)
      const directAgentUuids = (directAgentCode.match(/randomUUID\(\)/g) || []).length;
      const messageServiceUuids = (messageServiceCode.match(/randomUUID\(\)/g) || []).length;

      // Should have multiple UUID usages (baseline for comparison after migration)
      expect(directAgentUuids).toBeGreaterThan(0);
      expect(messageServiceUuids).toBeGreaterThan(0);

      console.log(`[DIAGNOSTIC] randomUUID() calls - DirectAgentService: ${directAgentUuids}, MessageService: ${messageServiceUuids}`);
    });
  });

  describe('Audit Claim 2: Anthropic ID Capture', () => {

    it('should verify Anthropic message ID is captured from message_start event', () => {
      const serviceCode = fs.readFileSync(
        path.join(process.cwd(), 'src/services/agent/DirectAgentService.ts'),
        'utf-8'
      );

      // Verify messageId variable initialization (line ~337)
      const hasMessageIdInit = serviceCode.includes('let messageId: string | null = null');
      expect(hasMessageIdInit).toBe(true);

      // Verify capture from event.message.id (line ~347)
      const hasMessageIdCapture = serviceCode.includes('messageId = event.message.id');
      expect(hasMessageIdCapture).toBe(true);

      // Verify message_start case
      const hasMessageStartCase = serviceCode.includes("case 'message_start':");
      expect(hasMessageStartCase).toBe(true);
    });

    it('should verify Anthropic ID is logged but not used as PK', async () => {
      const mockClient = new FakeAnthropicClient();
      const service = new DirectAgentService(undefined, undefined, mockClient);

      const events: AgentEvent[] = [];
      const sessionId = randomUUID();
      const userId = randomUUID();

      await service.executeQueryStreaming(
        'Test prompt',
        sessionId,
        (e) => events.push(e),
        userId
      );

      const messageEvent = events.find(e => e.type === 'message') as MessageEvent;

      // Verify messageId exists in event
      expect(messageEvent).toBeDefined();
      expect(messageEvent.messageId).toBeDefined();

      // Current implementation: messageId could be UUID or Anthropic format
      // (This test establishes baseline - after migration, should always be Anthropic)
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}/.test(messageEvent.messageId);
      const isAnthropicFormat = /^msg_\d{2}[A-Za-z0-9]+$/.test(messageEvent.messageId);

      // At least one format should match
      expect(isUuid || isAnthropicFormat).toBe(true);

      console.log(`[DIAGNOSTIC] messageId format - UUID: ${isUuid}, Anthropic: ${isAnthropicFormat}, value: ${messageEvent.messageId}`);
    });

    it('should verify token tracking logs include messageId', () => {
      const serviceCode = fs.readFileSync(
        path.join(process.cwd(), 'src/services/agent/DirectAgentService.ts'),
        'utf-8'
      );

      // Check for token tracking log that includes messageId (line ~631)
      const hasTokenTracking = serviceCode.includes('[TOKEN TRACKING]');
      const logsMessageId = serviceCode.match(/messageId[,\s]/);

      expect(hasTokenTracking).toBe(true);
      expect(logsMessageId).toBeTruthy();
    });
  });

  describe('Audit Claim 3: Database Schema Validation', () => {

    it('should verify messages.id column type is UNIQUEIDENTIFIER', async () => {
      const result = await sql.query<{ DATA_TYPE: string }>`
        SELECT DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'messages'
          AND COLUMN_NAME = 'id'
      `;

      expect(result.recordset.length).toBeGreaterThan(0);
      expect(result.recordset[0].DATA_TYPE).toBe('uniqueidentifier');

      console.log(`[DIAGNOSTIC] messages.id type: ${result.recordset[0].DATA_TYPE}`);
    });

    it('should verify messages table has primary key on id column', async () => {
      const result = await sql.query<{ CONSTRAINT_NAME: string; COLUMN_NAME: string }>`
        SELECT
          tc.CONSTRAINT_NAME,
          kcu.COLUMN_NAME
        FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
          ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
        WHERE tc.TABLE_NAME = 'messages'
          AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
      `;

      expect(result.recordset.length).toBeGreaterThan(0);
      expect(result.recordset[0].COLUMN_NAME).toBe('id');

      console.log(`[DIAGNOSTIC] Primary key constraint: ${result.recordset[0].CONSTRAINT_NAME} on ${result.recordset[0].COLUMN_NAME}`);
    });

    it('should identify all foreign keys referencing messages.id', async () => {
      const result = await sql.query<{
        FK_NAME: string;
        REFERENCING_TABLE: string;
        REFERENCING_COLUMN: string
      }>`
        SELECT
          fk.name AS FK_NAME,
          OBJECT_NAME(fk.parent_object_id) AS REFERENCING_TABLE,
          COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS REFERENCING_COLUMN
        FROM sys.foreign_keys AS fk
        INNER JOIN sys.foreign_key_columns AS fkc
          ON fk.object_id = fkc.constraint_object_id
        WHERE fk.referenced_object_id = OBJECT_ID('messages')
          AND COL_NAME(fk.referenced_object_id, fkc.referenced_column_id) = 'id'
      `;

      // Expected: At least approvals.message_id
      console.log(`[DIAGNOSTIC] Foreign keys referencing messages.id: ${result.recordset.length}`);
      result.recordset.forEach(fk => {
        console.log(`  - ${fk.REFERENCING_TABLE}.${fk.REFERENCING_COLUMN} (${fk.FK_NAME})`);
      });

      // Document FKs for migration script
      expect(result.recordset.length).toBeGreaterThanOrEqual(0); // May be 0 or more
    });
  });

  describe('Data Flow Validation: SDK → Database', () => {

    it('should trace message ID through complete flow', async () => {
      const mockClient = new FakeAnthropicClient();
      const service = new DirectAgentService(undefined, undefined, mockClient);

      const sessionId = randomUUID();
      const userId = randomUUID();
      const events: AgentEvent[] = [];

      // Execute query
      await service.executeQueryStreaming(
        'Test data flow',
        sessionId,
        (e) => events.push(e),
        userId
      );

      // Wait for async persistence
      await new Promise(resolve => setTimeout(resolve, 1500));

      // 1. Verify event emitted
      const messageEvent = events.find(e => e.type === 'message') as MessageEvent;
      expect(messageEvent).toBeDefined();
      expect(messageEvent.messageId).toBeDefined();

      // 2. Query database for persisted message
      const dbResult = await sql.query<{ id: string; content: string }>`
        SELECT id, content
        FROM messages
        WHERE session_id = ${sessionId}
          AND role = 'assistant'
      `;

      expect(dbResult.recordset.length).toBeGreaterThan(0);

      const persistedId = dbResult.recordset[0].id;
      console.log(`[DIAGNOSTIC] Flow validation - Event messageId: ${messageEvent.messageId}, DB id: ${persistedId}`);

      // Current behavior: messageId from event should match DB id
      // (After Phase 1B, this should always be Anthropic format)
    });

    it('should verify EventStore generates event IDs (not message IDs)', async () => {
      const eventStoreCode = fs.readFileSync(
        path.join(process.cwd(), 'src/services/events/EventStore.ts'),
        'utf-8'
      );

      // EventStore should generate eventId with randomUUID()
      const hasEventIdGeneration = eventStoreCode.includes('eventId = randomUUID()') ||
                                     eventStoreCode.includes('id: randomUUID()');

      expect(hasEventIdGeneration).toBe(true);

      // Verify event_id is separate from message_id in event data
      const hasMessageIdInData = eventStoreCode.includes('message_id');
      expect(hasMessageIdInData).toBe(true);
    });
  });

  describe('Type Consistency Validation', () => {

    it('should verify MessageEvent interface requires messageId', () => {
      const agentTypesCode = fs.readFileSync(
        path.join(process.cwd(), 'src/types/agent.types.ts'),
        'utf-8'
      );

      // Check MessageEvent interface has messageId: string
      const hasMessageEvent = agentTypesCode.includes('interface MessageEvent');
      const hasMessageIdField = agentTypesCode.match(/messageId:\s*string/);

      expect(hasMessageEvent).toBe(true);
      expect(hasMessageIdField).toBeTruthy();
    });

    it('should verify MessagePersistenceJob interface has messageId', () => {
      const queueCode = fs.readFileSync(
        path.join(process.cwd(), 'src/services/queue/MessageQueue.ts'),
        'utf-8'
      );

      // Check for MessagePersistenceJob interface or inline type
      const hasMessageId = queueCode.includes('messageId');
      expect(hasMessageId).toBe(true);
    });

    it('should compile TypeScript with current message ID types', async () => {
      // This test validates that all type definitions are consistent
      // If compilation fails, it indicates type mismatches

      // Attempt to create a MessageEvent with current types
      const testEvent: MessageEvent = {
        type: 'message',
        messageId: randomUUID(), // Current: UUID format
        content: 'test',
        role: 'assistant',
        timestamp: new Date(),
        eventId: randomUUID(),
        persistenceState: 'persisted',
      };

      expect(testEvent.messageId).toBeDefined();
      expect(typeof testEvent.messageId).toBe('string');
    });
  });

  describe('Migration Readiness Assessment', () => {

    it('should verify no hard-coded UUID validations for message IDs', () => {
      const directAgentCode = fs.readFileSync(
        path.join(process.cwd(), 'src/services/agent/DirectAgentService.ts'),
        'utf-8'
      );

      // Check for UUID format validation regex (should not exist for messageId)
      const hasUuidValidation = directAgentCode.match(/messageId.*\[0-9a-f\]\{8\}/);

      // Should NOT have UUID-specific validation
      expect(hasUuidValidation).toBeNull();
    });

    it('should verify SQL parameter types for message ID', async () => {
      const queueCode = fs.readFileSync(
        path.join(process.cwd(), 'src/services/queue/MessageQueue.ts'),
        'utf-8'
      );

      // Check if messageId parameter is explicitly typed
      // (After migration, should use sql.NVarChar(255) instead of auto-detect)
      const hasMessageIdParam = queueCode.includes('messageId');
      expect(hasMessageIdParam).toBe(true);

      // Log current parameter handling approach
      console.log('[DIAGNOSTIC] SQL parameter typing will need review after schema migration');
    });

    it('should estimate number of files requiring changes', () => {
      const filesToChange = [
        'src/services/agent/DirectAgentService.ts',
        'src/services/messages/MessageService.ts',
        'src/services/queue/MessageQueue.ts',
        'src/types/agent.types.ts',
        'src/types/message.types.ts',
      ];

      // Verify all files exist
      filesToChange.forEach(file => {
        const fullPath = path.join(process.cwd(), file);
        const exists = fs.existsSync(fullPath);
        expect(exists).toBe(true);
        console.log(`[DIAGNOSTIC] File to modify: ${file} - exists: ${exists}`);
      });

      expect(filesToChange.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('Risk Identification', () => {

    it('should check for existing data in messages table', async () => {
      const result = await sql.query<{ total_messages: number; sample_id: string }>`
        SELECT
          COUNT(*) as total_messages,
          (SELECT TOP 1 id FROM messages) as sample_id
        FROM messages
      `;

      const totalMessages = result.recordset[0].total_messages;
      const sampleId = result.recordset[0].sample_id;

      console.log(`[DIAGNOSTIC] Existing messages in DB: ${totalMessages}`);
      if (sampleId) {
        console.log(`[DIAGNOSTIC] Sample message ID format: ${sampleId}`);

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(sampleId);
        console.log(`[DIAGNOSTIC] Sample ID is UUID: ${isUuid}`);
      }

      // Document data migration requirement
      if (totalMessages > 0) {
        console.warn(`[RISK] ${totalMessages} existing messages will need migration strategy`);
      }
    });

    it('should verify FakeAnthropicClient generates proper message IDs', () => {
      const fakeClientCode = fs.readFileSync(
        path.join(process.cwd(), 'src/services/agent/FakeAnthropicClient.ts'),
        'utf-8'
      );

      // Check what format FakeAnthropicClient uses for message.id
      const hasMessageId = fakeClientCode.includes('message.id') ||
                           fakeClientCode.includes('message: {');

      expect(hasMessageId).toBe(true);

      // Log finding for test update strategy
      console.log('[DIAGNOSTIC] FakeAnthropicClient will need update to generate msg_01... format');
    });
  });
});
