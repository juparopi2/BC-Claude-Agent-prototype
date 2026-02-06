/**
 * Slash Command Router
 *
 * Pre-routing for slash commands (/bc, /search, /rag).
 * These bypass the supervisor LLM entirely for instant routing.
 *
 * @module modules/agents/supervisor/slash-command-router
 */

import { AGENT_ID, type AgentId } from '@bc-agent/shared';

/**
 * Result of slash command detection.
 */
export interface SlashCommandResult {
  /** Whether a slash command was detected */
  isSlashCommand: boolean;
  /** Target agent ID if slash command matched */
  targetAgentId?: AgentId;
  /** Prompt with slash command prefix removed */
  cleanedPrompt: string;
}

/**
 * Detect slash commands in user input.
 *
 * Supported commands:
 * - /bc <query>     → BC Agent
 * - /search <query> → RAG Agent
 * - /rag <query>    → RAG Agent
 *
 * @param prompt - Raw user input
 * @returns SlashCommandResult with detection info and cleaned prompt
 */
export function detectSlashCommand(prompt: string): SlashCommandResult {
  const trimmed = prompt.trim();

  if (trimmed.startsWith('/bc')) {
    return {
      isSlashCommand: true,
      targetAgentId: AGENT_ID.BC_AGENT,
      cleanedPrompt: trimmed.slice(3).trim() || trimmed,
    };
  }

  if (trimmed.startsWith('/search')) {
    return {
      isSlashCommand: true,
      targetAgentId: AGENT_ID.RAG_AGENT,
      cleanedPrompt: trimmed.slice(7).trim() || trimmed,
    };
  }

  if (trimmed.startsWith('/rag')) {
    return {
      isSlashCommand: true,
      targetAgentId: AGENT_ID.RAG_AGENT,
      cleanedPrompt: trimmed.slice(4).trim() || trimmed,
    };
  }

  return {
    isSlashCommand: false,
    cleanedPrompt: trimmed,
  };
}
