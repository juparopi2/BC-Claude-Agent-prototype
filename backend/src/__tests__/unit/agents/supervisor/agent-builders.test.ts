import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildReactAgents } from '@modules/agents/supervisor/agent-builders';
import { getAgentRegistry, resetAgentRegistry } from '@modules/agents/core/registry/AgentRegistry';
import { registerAgents } from '@modules/agents/core/registry/registerAgents';

// Mock ModelFactory to avoid real API calls
vi.mock('@/core/langchain/ModelFactory', () => ({
  ModelFactory: {
    create: vi.fn().mockResolvedValue({
      bindTools: vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue({ content: 'test' }),
      }),
      invoke: vi.fn().mockResolvedValue({ content: 'test' }),
    }),
  },
}));

// Mock createReactAgent since it needs a real model
vi.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: vi.fn().mockReturnValue({
    invoke: vi.fn().mockResolvedValue({ messages: [] }),
  }),
}));

describe('agent-builders', () => {
  beforeEach(() => {
    resetAgentRegistry();
    registerAgents();
  });

  describe('buildReactAgents', () => {
    it('should build agents for BC and RAG', async () => {
      const agents = await buildReactAgents();

      expect(agents).toHaveLength(2);
    });

    it('should create agents with id, name, and agent properties', async () => {
      const agents = await buildReactAgents();

      agents.forEach((agent) => {
        expect(agent).toHaveProperty('id');
        expect(agent).toHaveProperty('name');
        expect(agent).toHaveProperty('agent');
        expect(typeof agent.id).toBe('string');
        expect(typeof agent.name).toBe('string');
        expect(agent.agent).toBeTruthy();
      });
    });

    it('should create BC agent with correct id', async () => {
      const agents = await buildReactAgents();

      const bcAgent = agents.find((a) => a.id === 'bc-agent');
      expect(bcAgent).toBeDefined();
      expect(bcAgent?.name).toBeTruthy();
    });

    it('should create RAG agent with correct id', async () => {
      const agents = await buildReactAgents();

      const ragAgent = agents.find((a) => a.id === 'rag-agent');
      expect(ragAgent).toBeDefined();
      expect(ragAgent?.name).toBeTruthy();
    });

    it('should not create supervisor agent (supervisor is not a react agent)', async () => {
      const agents = await buildReactAgents();

      const supervisorAgent = agents.find((a) => a.id === 'supervisor');
      expect(supervisorAgent).toBeUndefined();
    });

    it('should create agents with unique ids', async () => {
      const agents = await buildReactAgents();

      const ids = agents.map((a) => a.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should create agents that match registry entries', async () => {
      const registry = getAgentRegistry();
      const agents = await buildReactAgents();

      agents.forEach((agent) => {
        const registryEntry = registry.get(agent.id);
        expect(registryEntry).toBeDefined();
        expect(registryEntry?.name).toBe(agent.name);
      });
    });

    it('should include handoff tools alongside domain tools (PRD-040)', async () => {
      const { createReactAgent } = await import('@langchain/langgraph/prebuilt');
      const mockCreateReactAgent = vi.mocked(createReactAgent);

      await buildReactAgents();

      // Each call to createReactAgent should include handoff tools
      for (const call of mockCreateReactAgent.mock.calls) {
        const config = call[0] as { tools: unknown[]; name: string };
        const tools = config.tools;
        const agentName = config.name;

        // Each worker agent should have at least 1 handoff tool (transfer to the other worker)
        const handoffTools = (tools as { name: string }[]).filter(
          (t) => typeof t.name === 'string' && t.name.startsWith('transfer_to_')
        );
        expect(handoffTools.length).toBeGreaterThanOrEqual(1);

        // Should not have self-transfer
        const selfTransfer = handoffTools.find((t) => t.name === `transfer_to_${agentName}`);
        expect(selfTransfer).toBeUndefined();
      }
    });
  });
});
