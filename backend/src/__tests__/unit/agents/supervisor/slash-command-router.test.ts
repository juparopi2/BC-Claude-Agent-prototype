import { describe, it, expect } from 'vitest';
import { detectSlashCommand } from '@modules/agents/supervisor/slash-command-router';
import { AGENT_ID } from '@bc-agent/shared';

describe('slash-command-router', () => {
  describe('detectSlashCommand', () => {
    it('should detect /bc command and extract query', () => {
      const result = detectSlashCommand('/bc status');
      expect(result.isSlashCommand).toBe(true);
      expect(result.targetAgentId).toBe(AGENT_ID.BC_AGENT);
      expect(result.cleanedPrompt).toBe('status');
    });

    it('should detect /search command and extract query', () => {
      const result = detectSlashCommand('/search payment terms');
      expect(result.isSlashCommand).toBe(true);
      expect(result.targetAgentId).toBe(AGENT_ID.RAG_AGENT);
      expect(result.cleanedPrompt).toBe('payment terms');
    });

    it('should detect /rag command and extract query', () => {
      const result = detectSlashCommand('/rag contracts');
      expect(result.isSlashCommand).toBe(true);
      expect(result.targetAgentId).toBe(AGENT_ID.RAG_AGENT);
      expect(result.cleanedPrompt).toBe('contracts');
    });

    it('should not detect slash command in regular text', () => {
      const result = detectSlashCommand('Hello world');
      expect(result.isSlashCommand).toBe(false);
      expect(result.cleanedPrompt).toBe('Hello world');
      expect(result.targetAgentId).toBeUndefined();
    });

    it('should handle /bc without query', () => {
      const result = detectSlashCommand('/bc');
      expect(result.isSlashCommand).toBe(true);
      expect(result.targetAgentId).toBe(AGENT_ID.BC_AGENT);
      expect(result.cleanedPrompt).toBe('/bc');
    });

    it('should detect slash command with surrounding whitespace', () => {
      const result = detectSlashCommand('  /bc status  ');
      expect(result.isSlashCommand).toBe(true);
      expect(result.targetAgentId).toBe(AGENT_ID.BC_AGENT);
      expect(result.cleanedPrompt).toBe('status');
    });

    it('should detect /search with surrounding whitespace', () => {
      const result = detectSlashCommand('  /search invoices  ');
      expect(result.isSlashCommand).toBe(true);
      expect(result.targetAgentId).toBe(AGENT_ID.RAG_AGENT);
      expect(result.cleanedPrompt).toBe('invoices');
    });

    it('should not detect slash command in middle of text', () => {
      const result = detectSlashCommand('Please use /bc status');
      expect(result.isSlashCommand).toBe(false);
      expect(result.cleanedPrompt).toBe('Please use /bc status');
    });
  });
});
