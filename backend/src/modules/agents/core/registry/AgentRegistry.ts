/**
 * Agent Registry
 *
 * Singleton registry that serves as the single source of truth for all
 * agent metadata, capabilities, and tool bindings.
 *
 * @module modules/agents/core/registry/AgentRegistry
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { AgentCapability, AgentId, AgentUISummary } from '@bc-agent/shared';
import { createChildLogger } from '@/shared/utils/logger';
import type {
  AgentDefinition,
  AgentToolConfig,
  AgentWithTools,
  SupervisorAgentInfo,
} from './AgentDefinition';

const logger = createChildLogger({ service: 'AgentRegistry' });

/**
 * Centralized Agent Registry - manages all agent definitions and tool bindings.
 *
 * Provides:
 * - Registration: register(), registerTools(), registerWithTools(), unregister()
 * - Queries: get(), getWithTools(), getAll(), getUserSelectableAgents(), getWorkerAgents(), getByCapability(), has(), size
 * - Tool resolution: getToolsForAgent(agentId, userId?)
 * - Supervisor: getAgentsForSupervisor(), buildSupervisorAgentList()
 * - UI: getUISummary()
 */
export class AgentRegistry {
  private agents = new Map<AgentId, AgentDefinition>();
  private toolConfigs = new Map<AgentId, AgentToolConfig>();

  // ============================================
  // Registration
  // ============================================

  /**
   * Register an agent definition.
   * @throws Error if agent with same ID already registered
   */
  register(definition: AgentDefinition): void {
    if (this.agents.has(definition.id)) {
      throw new Error(`Agent "${definition.id}" is already registered`);
    }
    this.agents.set(definition.id, definition);
    logger.info({ agentId: definition.id }, 'Agent registered');
  }

  /**
   * Register tools for an already-registered agent.
   * @throws Error if agent not found
   */
  registerTools(agentId: AgentId, toolConfig: AgentToolConfig): void {
    if (!this.agents.has(agentId)) {
      throw new Error(`Agent "${agentId}" not found. Register the agent first.`);
    }
    this.toolConfigs.set(agentId, toolConfig);
    logger.info({ agentId }, 'Tools registered for agent');
  }

  /**
   * Register an agent definition with tools in a single call.
   * @throws Error if agent with same ID already registered
   */
  registerWithTools(definition: AgentDefinition, toolConfig: AgentToolConfig): void {
    this.register(definition);
    this.toolConfigs.set(definition.id, toolConfig);
  }

  /**
   * Remove an agent from the registry.
   */
  unregister(agentId: AgentId): boolean {
    this.toolConfigs.delete(agentId);
    const deleted = this.agents.delete(agentId);
    if (deleted) {
      logger.info({ agentId }, 'Agent unregistered');
    }
    return deleted;
  }

  // ============================================
  // Queries
  // ============================================

  /**
   * Get agent definition by ID.
   */
  get(agentId: AgentId): AgentDefinition | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get agent with resolved tools.
   * For agents with toolFactory, userId is required.
   */
  getWithTools(agentId: AgentId, userId?: string): AgentWithTools | undefined {
    const definition = this.agents.get(agentId);
    if (!definition) return undefined;

    const tools = this.getToolsForAgent(agentId, userId);
    return { ...definition, tools };
  }

  /**
   * Get all registered agent definitions.
   */
  getAll(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agents that can be selected by users in the UI.
   */
  getUserSelectableAgents(): AgentDefinition[] {
    return this.getAll().filter(a => a.isUserSelectable);
  }

  /**
   * Get worker agents (non-system agents that do actual work).
   */
  getWorkerAgents(): AgentDefinition[] {
    return this.getAll().filter(a => !a.isSystemAgent);
  }

  /**
   * Get agents that have a specific capability.
   */
  getByCapability(capability: AgentCapability): AgentDefinition[] {
    return this.getAll().filter(a => a.capabilities.includes(capability));
  }

  /**
   * Check if an agent is registered.
   */
  has(agentId: AgentId): boolean {
    return this.agents.has(agentId);
  }

  /**
   * Get the number of registered agents.
   */
  get size(): number {
    return this.agents.size;
  }

  // ============================================
  // Tool Resolution
  // ============================================

  /**
   * Resolve tools for an agent.
   * Static tools are returned directly.
   * Tool factories require a userId to create user-scoped tools.
   */
  getToolsForAgent(agentId: AgentId, userId?: string): StructuredToolInterface[] {
    const config = this.toolConfigs.get(agentId);
    if (!config) return [];

    const tools: StructuredToolInterface[] = [];

    if (config.staticTools) {
      tools.push(...config.staticTools);
    }

    if (config.toolFactory) {
      if (!userId) {
        logger.warn({ agentId }, 'toolFactory requires userId but none provided');
        return tools;
      }
      tools.push(...config.toolFactory(userId));
    }

    return tools;
  }

  // ============================================
  // Supervisor Integration (Phase 3)
  // ============================================

  /**
   * Get agents formatted for createSupervisor() (Phase 3).
   * Returns only worker agents (non-system).
   */
  getAgentsForSupervisor(): SupervisorAgentInfo[] {
    return this.getWorkerAgents().map(a => ({
      name: a.id,
      description: a.description,
    }));
  }

  /**
   * Build supervisor agent list as a formatted string.
   */
  buildSupervisorAgentList(): string {
    return this.getAgentsForSupervisor()
      .map(a => `- ${a.name}: ${a.description}`)
      .join('\n');
  }

  // ============================================
  // UI Serialization
  // ============================================

  /**
   * Get agent summaries safe for frontend consumption.
   * Only includes user-selectable agents.
   * Excludes systemPrompt and modelRole.
   */
  getUISummary(): AgentUISummary[] {
    return this.getUserSelectableAgents().map(a => ({
      id: a.id,
      name: a.name,
      description: a.description,
      icon: a.icon,
      color: a.color,
      capabilities: a.capabilities,
    }));
  }

  // ============================================
  // Reset (for testing)
  // ============================================

  /**
   * Clear all registrations. For testing only.
   */
  reset(): void {
    this.agents.clear();
    this.toolConfigs.clear();
  }
}

// ============================================
// Singleton
// ============================================

let instance: AgentRegistry | null = null;

/**
 * Get the singleton AgentRegistry instance.
 */
export function getAgentRegistry(): AgentRegistry {
  if (!instance) {
    instance = new AgentRegistry();
  }
  return instance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetAgentRegistry(): void {
  if (instance) {
    instance.reset();
  }
  instance = null;
}
