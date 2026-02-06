/**
 * @module extended-state.contract.test
 *
 * Contract tests for PRD-020 schemas.
 * Validates that AgentIdentity and AgentChangedEvent conform to Zod schemas.
 */

import { describe, it, expect } from 'vitest';
import {
  AgentIdentitySchema,
  AgentChangedEventSchema,
} from '@bc-agent/shared/schemas';
import {
  AGENT_ID,
  AGENT_DISPLAY_NAME,
  AGENT_ICON,
  AGENT_COLOR,
} from '@bc-agent/shared';

describe('AgentIdentitySchema', () => {
  it('should validate a complete AgentIdentity', () => {
    const identity = {
      agentId: AGENT_ID.BC_AGENT,
      agentName: AGENT_DISPLAY_NAME[AGENT_ID.BC_AGENT],
      agentIcon: AGENT_ICON[AGENT_ID.BC_AGENT],
      agentColor: AGENT_COLOR[AGENT_ID.BC_AGENT],
    };

    const result = AgentIdentitySchema.safeParse(identity);
    expect(result.success).toBe(true);
  });

  it('should validate AgentIdentity with only required fields', () => {
    const identity = {
      agentId: 'bc-agent',
      agentName: 'Business Central Expert',
    };

    const result = AgentIdentitySchema.safeParse(identity);
    expect(result.success).toBe(true);
  });

  it('should reject AgentIdentity with missing agentId', () => {
    const invalid = {
      agentName: 'Some Agent',
    };

    const result = AgentIdentitySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject AgentIdentity with missing agentName', () => {
    const invalid = {
      agentId: 'some-agent',
    };

    const result = AgentIdentitySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject AgentIdentity with empty agentId', () => {
    const invalid = {
      agentId: '',
      agentName: 'Some Agent',
    };

    const result = AgentIdentitySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject AgentIdentity with empty agentName', () => {
    const invalid = {
      agentId: 'some-agent',
      agentName: '',
    };

    const result = AgentIdentitySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should validate all three agent identities', () => {
    const agents = [AGENT_ID.BC_AGENT, AGENT_ID.RAG_AGENT, AGENT_ID.SUPERVISOR] as const;

    for (const agentId of agents) {
      const identity = {
        agentId,
        agentName: AGENT_DISPLAY_NAME[agentId],
        agentIcon: AGENT_ICON[agentId],
        agentColor: AGENT_COLOR[agentId],
      };

      const result = AgentIdentitySchema.safeParse(identity);
      expect(result.success, `Failed for agent: ${agentId}`).toBe(true);
    }
  });
});

describe('AgentChangedEventSchema', () => {
  const validEvent = {
    type: 'agent_changed' as const,
    sessionId: 'A1B2C3D4-E5F6-7890-1234-567890ABCDEF',
    timestamp: new Date().toISOString(),
    eventId: 'B1C2D3E4-F5A6-7890-1234-567890ABCDEF',
    persistenceState: 'transient' as const,
    previousAgent: {
      agentId: AGENT_ID.SUPERVISOR,
      agentName: AGENT_DISPLAY_NAME[AGENT_ID.SUPERVISOR],
      agentIcon: AGENT_ICON[AGENT_ID.SUPERVISOR],
      agentColor: AGENT_COLOR[AGENT_ID.SUPERVISOR],
    },
    currentAgent: {
      agentId: AGENT_ID.BC_AGENT,
      agentName: AGENT_DISPLAY_NAME[AGENT_ID.BC_AGENT],
      agentIcon: AGENT_ICON[AGENT_ID.BC_AGENT],
      agentColor: AGENT_COLOR[AGENT_ID.BC_AGENT],
    },
  };

  it('should validate a complete AgentChangedEvent', () => {
    const result = AgentChangedEventSchema.safeParse(validEvent);
    expect(result.success).toBe(true);
  });

  it('should validate without optional sessionId', () => {
    const { sessionId, ...eventWithoutSession } = validEvent;
    const result = AgentChangedEventSchema.safeParse(eventWithoutSession);
    expect(result.success).toBe(true);
  });

  it('should reject wrong event type', () => {
    const invalid = { ...validEvent, type: 'wrong_type' };
    const result = AgentChangedEventSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject missing previousAgent', () => {
    const { previousAgent, ...invalid } = validEvent;
    const result = AgentChangedEventSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject missing currentAgent', () => {
    const { currentAgent, ...invalid } = validEvent;
    const result = AgentChangedEventSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject invalid persistenceState', () => {
    const invalid = { ...validEvent, persistenceState: 'unknown' };
    const result = AgentChangedEventSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should accept all valid persistence states', () => {
    const states = ['pending', 'queued', 'persisted', 'failed', 'transient'] as const;
    for (const state of states) {
      const event = { ...validEvent, persistenceState: state };
      const result = AgentChangedEventSchema.safeParse(event);
      expect(result.success, `Failed for state: ${state}`).toBe(true);
    }
  });
});
