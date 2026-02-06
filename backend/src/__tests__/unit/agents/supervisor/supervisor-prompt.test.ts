import { describe, it, expect, beforeEach } from 'vitest';
import { buildSupervisorPrompt } from '@modules/agents/supervisor/supervisor-prompt';
import { getAgentRegistry, resetAgentRegistry } from '@modules/agents/core/registry/AgentRegistry';
import { registerAgents } from '@modules/agents/core/registry/registerAgents';

describe('supervisor-prompt', () => {
  beforeEach(() => {
    resetAgentRegistry();
    registerAgents();
  });

  describe('buildSupervisorPrompt', () => {
    it('should include bc-agent in the prompt', () => {
      const prompt = buildSupervisorPrompt();
      expect(prompt).toContain('bc-agent');
    });

    it('should include rag-agent in the prompt', () => {
      const prompt = buildSupervisorPrompt();
      expect(prompt).toContain('rag-agent');
    });

    it('should contain routing guidelines', () => {
      const prompt = buildSupervisorPrompt();
      expect(prompt.toLowerCase()).toContain('route');
    });

    it('should contain MyWorkMate branding', () => {
      const prompt = buildSupervisorPrompt();
      expect(prompt).toContain('MyWorkMate');
    });

    it('should include worker agent descriptions from registry', () => {
      const registry = getAgentRegistry();
      const prompt = buildSupervisorPrompt();

      // Worker agents (non-system) should have descriptions included
      registry.getWorkerAgents().forEach((agent) => {
        expect(prompt).toContain(agent.description);
      });
    });

    it('should be a non-empty string', () => {
      const prompt = buildSupervisorPrompt();
      expect(prompt).toBeTruthy();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    });

    it('should include information about agents', () => {
      const prompt = buildSupervisorPrompt();
      expect(prompt.toLowerCase()).toContain('agent');
      expect(prompt).toContain('AVAILABLE AGENTS');
    });
  });
});
