/**
 * Agent Definition Types
 *
 * Backend-only types for full agent definitions including
 * systemPrompt and modelRole (not exposed to frontend).
 *
 * @module modules/agents/core/registry/AgentDefinition
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { AgentCapability, AgentId } from '@bc-agent/shared';
import type { ModelRole } from '@/infrastructure/config/models';

/** Full agent definition (backend-only, includes systemPrompt + modelRole) */
export interface AgentDefinition {
  id: AgentId;
  name: string;
  description: string;
  icon: string;
  color: string;
  capabilities: AgentCapability[];
  systemPrompt: string;
  modelRole: ModelRole;
  isUserSelectable: boolean;
  isSystemAgent: boolean;
}

/** Tool configuration supporting both static and dynamic tools */
export interface AgentToolConfig {
  staticTools?: StructuredToolInterface[];
  toolFactory?: (userId: string) => StructuredToolInterface[];
}

/** Agent with resolved tools */
export interface AgentWithTools extends AgentDefinition {
  tools: StructuredToolInterface[];
}

/** Agent info for createSupervisor() integration (Phase 3) */
export interface SupervisorAgentInfo {
  name: string;
  description: string;
}
