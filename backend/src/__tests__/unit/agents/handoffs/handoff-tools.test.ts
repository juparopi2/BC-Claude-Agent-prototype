import { describe, it, expect } from 'vitest';
import { createAgentHandoffTool } from '@modules/agents/handoffs/handoff-tools';

describe('handoff-tools', () => {
  describe('createAgentHandoffTool', () => {
    it('should create a tool with transfer_to_ prefix', () => {
      const tool = createAgentHandoffTool({
        agentName: 'rag-agent',
        description: 'Transfer to RAG agent',
      });

      expect(tool.name).toBe('transfer_to_rag-agent');
    });

    it('should include the provided description', () => {
      const description = 'Transfer to the Knowledge Base Expert for document analysis';
      const tool = createAgentHandoffTool({
        agentName: 'rag-agent',
        description,
      });

      expect(tool.description).toBe(description);
    });

    it('should use z.object({}) schema (no arguments)', () => {
      const tool = createAgentHandoffTool({
        agentName: 'bc-agent',
        description: 'Transfer to BC agent',
      });

      // The schema should accept an empty object
      const schema = tool.schema;
      expect(schema).toBeDefined();
      // Parse empty object should succeed
      const result = schema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should create different tools for different agent names', () => {
      const tool1 = createAgentHandoffTool({
        agentName: 'rag-agent',
        description: 'Transfer to RAG',
      });
      const tool2 = createAgentHandoffTool({
        agentName: 'bc-agent',
        description: 'Transfer to BC',
      });

      expect(tool1.name).not.toBe(tool2.name);
      expect(tool1.name).toBe('transfer_to_rag-agent');
      expect(tool2.name).toBe('transfer_to_bc-agent');
    });
  });
});
