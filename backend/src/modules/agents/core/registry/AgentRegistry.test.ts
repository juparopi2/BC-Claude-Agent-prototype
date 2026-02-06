/**
 * AgentRegistry Unit Tests
 *
 * Tests for the centralized agent registry covering:
 * - Registration (register, registerTools, registerWithTools, unregister)
 * - Queries (get, getAll, getUserSelectableAgents, getWorkerAgents, getByCapability, has, size)
 * - Supervisor Integration (getAgentsForSupervisor, buildSupervisorAgentList)
 * - UI Serialization (getUISummary)
 * - Tool Resolution (static tools, toolFactory)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentRegistry, resetAgentRegistry } from './AgentRegistry';
import type { AgentDefinition, AgentToolConfig } from './AgentDefinition';
import {
  AGENT_ID,
  AGENT_CAPABILITY,
} from '@bc-agent/shared';

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ============================================
// Test Fixtures
// ============================================

function createTestAgentDefinition(overrides?: Partial<AgentDefinition>): AgentDefinition {
  return {
    id: AGENT_ID.BC_AGENT,
    name: 'Test BC Agent',
    description: 'Test description',
    icon: '📊',
    color: '#3B82F6',
    capabilities: [AGENT_CAPABILITY.ERP_QUERY],
    systemPrompt: 'You are a test agent.',
    modelRole: 'bc_agent',
    isUserSelectable: true,
    isSystemAgent: false,
    ...overrides,
  };
}

function createMockTool(name: string) {
  return {
    name,
    description: `Mock tool ${name}`,
    schema: {},
    invoke: vi.fn(),
    lc_namespace: ['test'],
  } as unknown as import('@langchain/core/tools').StructuredToolInterface;
}

// ============================================
// Tests
// ============================================

describe('AgentRegistry', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    resetAgentRegistry();
    registry = new AgentRegistry();
  });

  // ============================================
  // Registration
  // ============================================

  describe('Registration', () => {
    it('should register an agent definition', () => {
      const definition = createTestAgentDefinition();
      registry.register(definition);

      expect(registry.has(AGENT_ID.BC_AGENT)).toBe(true);
      expect(registry.size).toBe(1);
    });

    it('should throw when registering duplicate agent ID', () => {
      const definition = createTestAgentDefinition();
      registry.register(definition);

      expect(() => registry.register(definition)).toThrow(
        'Agent "bc-agent" is already registered'
      );
    });

    it('should register agent with static tools', () => {
      const definition = createTestAgentDefinition();
      const tools = [createMockTool('tool1'), createMockTool('tool2')];
      const config: AgentToolConfig = { staticTools: tools };

      registry.registerWithTools(definition, config);

      const resolved = registry.getToolsForAgent(AGENT_ID.BC_AGENT);
      expect(resolved).toHaveLength(2);
    });

    it('should register agent with toolFactory', () => {
      const definition = createTestAgentDefinition({
        id: AGENT_ID.RAG_AGENT,
      });
      const factory = vi.fn((userId: string) => [createMockTool(`tool-${userId}`)]);
      const config: AgentToolConfig = { toolFactory: factory };

      registry.registerWithTools(definition, config);

      const resolved = registry.getToolsForAgent(AGENT_ID.RAG_AGENT, 'USER-123');
      expect(resolved).toHaveLength(1);
      expect(factory).toHaveBeenCalledWith('USER-123');
    });

    it('should unregister an agent', () => {
      const definition = createTestAgentDefinition();
      registry.register(definition);
      expect(registry.size).toBe(1);

      const deleted = registry.unregister(AGENT_ID.BC_AGENT);
      expect(deleted).toBe(true);
      expect(registry.size).toBe(0);
      expect(registry.has(AGENT_ID.BC_AGENT)).toBe(false);
    });

    it('should return false when unregistering non-existent agent', () => {
      const deleted = registry.unregister(AGENT_ID.BC_AGENT);
      expect(deleted).toBe(false);
    });

    it('should throw when registering tools for non-existent agent', () => {
      expect(() =>
        registry.registerTools(AGENT_ID.BC_AGENT, { staticTools: [] })
      ).toThrow('Agent "bc-agent" not found');
    });
  });

  // ============================================
  // Queries
  // ============================================

  describe('Queries', () => {
    beforeEach(() => {
      registry.register(createTestAgentDefinition({ id: AGENT_ID.BC_AGENT, isUserSelectable: true, isSystemAgent: false }));
      registry.register(createTestAgentDefinition({ id: AGENT_ID.RAG_AGENT, name: 'RAG', capabilities: [AGENT_CAPABILITY.RAG_SEARCH], isUserSelectable: true, isSystemAgent: false }));
      registry.register(createTestAgentDefinition({ id: AGENT_ID.SUPERVISOR, name: 'Supervisor', capabilities: [AGENT_CAPABILITY.GENERAL], isUserSelectable: false, isSystemAgent: true }));
    });

    it('should get agent by ID', () => {
      const agent = registry.get(AGENT_ID.BC_AGENT);
      expect(agent).toBeDefined();
      expect(agent!.id).toBe(AGENT_ID.BC_AGENT);
    });

    it('should return undefined for unknown ID', () => {
      const agent = registry.get('nonexistent' as import('@bc-agent/shared').AgentId);
      expect(agent).toBeUndefined();
    });

    it('should return all agents', () => {
      const all = registry.getAll();
      expect(all).toHaveLength(3);
    });

    it('should return user-selectable agents only', () => {
      const selectable = registry.getUserSelectableAgents();
      expect(selectable).toHaveLength(2);
      expect(selectable.every(a => a.isUserSelectable)).toBe(true);
    });

    it('should return worker (non-system) agents', () => {
      const workers = registry.getWorkerAgents();
      expect(workers).toHaveLength(2);
      expect(workers.every(a => !a.isSystemAgent)).toBe(true);
    });

    it('should filter agents by capability', () => {
      const erpAgents = registry.getByCapability(AGENT_CAPABILITY.ERP_QUERY);
      expect(erpAgents).toHaveLength(1);
      expect(erpAgents[0].id).toBe(AGENT_ID.BC_AGENT);
    });

    it('should report correct size', () => {
      expect(registry.size).toBe(3);
    });

    it('should check agent existence with has()', () => {
      expect(registry.has(AGENT_ID.BC_AGENT)).toBe(true);
      expect(registry.has('nonexistent' as import('@bc-agent/shared').AgentId)).toBe(false);
    });
  });

  // ============================================
  // Supervisor Integration
  // ============================================

  describe('Supervisor Integration', () => {
    beforeEach(() => {
      registry.register(createTestAgentDefinition({ id: AGENT_ID.BC_AGENT, isSystemAgent: false }));
      registry.register(createTestAgentDefinition({ id: AGENT_ID.RAG_AGENT, name: 'RAG', description: 'RAG desc', isSystemAgent: false }));
      registry.register(createTestAgentDefinition({ id: AGENT_ID.SUPERVISOR, name: 'Supervisor', isSystemAgent: true }));
    });

    it('should return supervisor agent info for worker agents only', () => {
      const info = registry.getAgentsForSupervisor();
      expect(info).toHaveLength(2);
      expect(info[0]).toEqual({ name: AGENT_ID.BC_AGENT, description: 'Test description' });
    });

    it('should build formatted supervisor agent list', () => {
      const list = registry.buildSupervisorAgentList();
      expect(list).toContain('- bc-agent:');
      expect(list).toContain('- rag-agent:');
      expect(list).not.toContain('supervisor');
    });
  });

  // ============================================
  // UI Serialization
  // ============================================

  describe('UI Serialization', () => {
    beforeEach(() => {
      registry.register(createTestAgentDefinition({
        id: AGENT_ID.BC_AGENT,
        systemPrompt: 'SECRET PROMPT',
        modelRole: 'bc_agent',
        isUserSelectable: true,
      }));
      registry.register(createTestAgentDefinition({
        id: AGENT_ID.SUPERVISOR,
        name: 'Supervisor',
        isUserSelectable: false,
        isSystemAgent: true,
      }));
    });

    it('should exclude systemPrompt and modelRole from UI summary', () => {
      const summaries = registry.getUISummary();
      expect(summaries).toHaveLength(1); // Only user-selectable

      const summary = summaries[0];
      expect(summary.id).toBe(AGENT_ID.BC_AGENT);
      expect(summary.name).toBeDefined();
      expect(summary.description).toBeDefined();
      expect(summary.icon).toBeDefined();
      expect(summary.color).toBeDefined();
      expect(summary.capabilities).toBeDefined();

      // Ensure backend-only fields are NOT present
      expect((summary as Record<string, unknown>)['systemPrompt']).toBeUndefined();
      expect((summary as Record<string, unknown>)['modelRole']).toBeUndefined();
    });

    it('should only include user-selectable agents in UI summary', () => {
      const summaries = registry.getUISummary();
      expect(summaries).toHaveLength(1);
      expect(summaries[0].id).toBe(AGENT_ID.BC_AGENT);
    });
  });

  // ============================================
  // Tool Resolution
  // ============================================

  describe('Tool Resolution', () => {
    it('should resolve static tools correctly', () => {
      const tools = [createMockTool('t1'), createMockTool('t2'), createMockTool('t3')];
      registry.registerWithTools(
        createTestAgentDefinition(),
        { staticTools: tools }
      );

      const resolved = registry.getToolsForAgent(AGENT_ID.BC_AGENT);
      expect(resolved).toHaveLength(3);
    });

    it('should resolve toolFactory with userId', () => {
      const factory = vi.fn((userId: string) => [
        createMockTool(`search-${userId}`),
      ]);

      registry.registerWithTools(
        createTestAgentDefinition({ id: AGENT_ID.RAG_AGENT }),
        { toolFactory: factory }
      );

      const resolved = registry.getToolsForAgent(AGENT_ID.RAG_AGENT, 'USER-ABC');
      expect(resolved).toHaveLength(1);
      expect(factory).toHaveBeenCalledWith('USER-ABC');
    });

    it('should return empty array when toolFactory called without userId', () => {
      const factory = vi.fn(() => [createMockTool('tool')]);
      registry.registerWithTools(
        createTestAgentDefinition({ id: AGENT_ID.RAG_AGENT }),
        { toolFactory: factory }
      );

      const resolved = registry.getToolsForAgent(AGENT_ID.RAG_AGENT);
      expect(resolved).toHaveLength(0);
      expect(factory).not.toHaveBeenCalled();
    });

    it('should return empty array for agent with no tools', () => {
      registry.register(createTestAgentDefinition());
      const resolved = registry.getToolsForAgent(AGENT_ID.BC_AGENT);
      expect(resolved).toHaveLength(0);
    });

    it('should combine static tools and factory tools', () => {
      const staticTools = [createMockTool('static1')];
      const factory = vi.fn((userId: string) => [createMockTool(`dynamic-${userId}`)]);

      registry.registerWithTools(
        createTestAgentDefinition(),
        { staticTools, toolFactory: factory }
      );

      const resolved = registry.getToolsForAgent(AGENT_ID.BC_AGENT, 'USER-123');
      expect(resolved).toHaveLength(2);
    });

    it('should return agent with tools via getWithTools', () => {
      const tools = [createMockTool('t1')];
      registry.registerWithTools(
        createTestAgentDefinition(),
        { staticTools: tools }
      );

      const agentWithTools = registry.getWithTools(AGENT_ID.BC_AGENT);
      expect(agentWithTools).toBeDefined();
      expect(agentWithTools!.tools).toHaveLength(1);
      expect(agentWithTools!.id).toBe(AGENT_ID.BC_AGENT);
      expect(agentWithTools!.systemPrompt).toBeDefined();
    });
  });

  // ============================================
  // Reset
  // ============================================

  describe('Reset', () => {
    it('should clear all registrations', () => {
      registry.register(createTestAgentDefinition());
      expect(registry.size).toBe(1);

      registry.reset();
      expect(registry.size).toBe(0);
    });
  });
});
