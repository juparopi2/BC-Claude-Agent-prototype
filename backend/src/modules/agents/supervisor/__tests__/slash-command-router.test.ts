/**
 * Slash Command Router Tests
 *
 * Tests for slash command detection and routing.
 */

import { describe, it, expect } from 'vitest';
import { AGENT_ID } from '@bc-agent/shared';
import { detectSlashCommand } from '../slash-command-router';

describe('detectSlashCommand', () => {
  describe('BC Agent commands', () => {
    it('should route /bc to BC agent', () => {
      const result = detectSlashCommand('/bc list customers');
      expect(result.isSlashCommand).toBe(true);
      expect(result.targetAgentId).toBe(AGENT_ID.BC_AGENT);
      expect(result.cleanedPrompt).toBe('list customers');
    });

    it('should handle /bc with no arguments', () => {
      const result = detectSlashCommand('/bc');
      expect(result.isSlashCommand).toBe(true);
      expect(result.targetAgentId).toBe(AGENT_ID.BC_AGENT);
      expect(result.cleanedPrompt).toBe('/bc');
    });
  });

  describe('RAG Agent commands', () => {
    it('should route /search to RAG agent', () => {
      const result = detectSlashCommand('/search quarterly report');
      expect(result.isSlashCommand).toBe(true);
      expect(result.targetAgentId).toBe(AGENT_ID.RAG_AGENT);
      expect(result.cleanedPrompt).toBe('quarterly report');
    });

    it('should route /rag to RAG agent', () => {
      const result = detectSlashCommand('/rag find documents');
      expect(result.isSlashCommand).toBe(true);
      expect(result.targetAgentId).toBe(AGENT_ID.RAG_AGENT);
      expect(result.cleanedPrompt).toBe('find documents');
    });
  });

  describe('Graphing Agent commands', () => {
    it('should route /chart to Graphing agent', () => {
      const result = detectSlashCommand('/chart revenue by quarter');
      expect(result.isSlashCommand).toBe(true);
      expect(result.targetAgentId).toBe(AGENT_ID.GRAPHING_AGENT);
      expect(result.cleanedPrompt).toBe('revenue by quarter');
    });

    it('should route /graph to Graphing agent', () => {
      const result = detectSlashCommand('/graph monthly sales trend');
      expect(result.isSlashCommand).toBe(true);
      expect(result.targetAgentId).toBe(AGENT_ID.GRAPHING_AGENT);
      expect(result.cleanedPrompt).toBe('monthly sales trend');
    });

    it('should handle /chart with no arguments', () => {
      const result = detectSlashCommand('/chart');
      expect(result.isSlashCommand).toBe(true);
      expect(result.targetAgentId).toBe(AGENT_ID.GRAPHING_AGENT);
      expect(result.cleanedPrompt).toBe('/chart');
    });

    it('should handle /graph with no arguments', () => {
      const result = detectSlashCommand('/graph');
      expect(result.isSlashCommand).toBe(true);
      expect(result.targetAgentId).toBe(AGENT_ID.GRAPHING_AGENT);
      expect(result.cleanedPrompt).toBe('/graph');
    });

    it('should handle /chart with leading whitespace', () => {
      const result = detectSlashCommand('  /chart create a bar chart');
      expect(result.isSlashCommand).toBe(true);
      expect(result.targetAgentId).toBe(AGENT_ID.GRAPHING_AGENT);
      expect(result.cleanedPrompt).toBe('create a bar chart');
    });
  });

  describe('Non-slash commands', () => {
    it('should not detect regular text as slash command', () => {
      const result = detectSlashCommand('show me the revenue chart');
      expect(result.isSlashCommand).toBe(false);
      expect(result.targetAgentId).toBeUndefined();
      expect(result.cleanedPrompt).toBe('show me the revenue chart');
    });

    it('should not detect slash in middle of text', () => {
      const result = detectSlashCommand('create a /chart for me');
      expect(result.isSlashCommand).toBe(false);
    });

    it('should handle empty string', () => {
      const result = detectSlashCommand('');
      expect(result.isSlashCommand).toBe(false);
      expect(result.cleanedPrompt).toBe('');
    });
  });
});
