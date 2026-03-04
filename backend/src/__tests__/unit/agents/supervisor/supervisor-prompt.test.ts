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

    it('should contain orchestrator identity', () => {
      const prompt = buildSupervisorPrompt();
      expect(prompt).toContain('Orchestrator');
    });

    it('should contain evaluation workflow', () => {
      const prompt = buildSupervisorPrompt();
      expect(prompt).toContain('EVALUATE');
      expect(prompt).toContain('PLAN');
      expect(prompt).toContain('DELEGATE');
      expect(prompt).toContain('DECIDE');
    });

    it('should NOT contain "You are a ROUTER"', () => {
      const prompt = buildSupervisorPrompt();
      expect(prompt).not.toContain('You are a ROUTER');
    });

    it('should contain FILE PROCESSING RULES section', () => {
      const prompt = buildSupervisorPrompt();
      expect(prompt).toContain('FILE PROCESSING RULES');
    });

    it('should mention container_upload in file processing rules', () => {
      const prompt = buildSupervisorPrompt();
      expect(prompt).toContain('[FILE PROCESSING REQUIRED');
    });

    it('should contain WEB SEARCH RULES section', () => {
      const prompt = buildSupervisorPrompt();
      expect(prompt).toContain('WEB SEARCH RULES');
    });

    it('should contain research-agent routing for web search', () => {
      const prompt = buildSupervisorPrompt();
      expect(prompt).toContain('research-agent');
    });

    it('should include graphing-agent for data visualization', () => {
      const prompt = buildSupervisorPrompt();
      expect(prompt).toContain('graphing-agent');
    });

    it('should include IMPORTANT DISTINCTIONS section', () => {
      const prompt = buildSupervisorPrompt();
      expect(prompt).toContain('IMPORTANT DISTINCTIONS');
    });

    it('should include CRITICAL RULES section', () => {
      const prompt = buildSupervisorPrompt();
      expect(prompt).toContain('CRITICAL RULES');
    });
  });
});
