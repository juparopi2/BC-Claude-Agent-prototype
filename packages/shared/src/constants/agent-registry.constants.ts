/**
 * Agent Registry Constants
 *
 * Centralized constants for agent visual identity, capabilities, and API paths.
 * Single source of truth used by both backend and frontend.
 *
 * @module @bc-agent/shared/constants/agent-registry
 */

// ============================================
// AGENT IDs (single source of truth)
// ============================================
export const AGENT_ID = {
  BC_AGENT: 'bc-agent',
  RAG_AGENT: 'rag-agent',
  SUPERVISOR: 'supervisor',
} as const;

export type AgentId = (typeof AGENT_ID)[keyof typeof AGENT_ID];

// ============================================
// AGENT DISPLAY NAMES
// ============================================
export const AGENT_DISPLAY_NAME: Record<AgentId, string> = {
  [AGENT_ID.BC_AGENT]: 'Business Central Expert',
  [AGENT_ID.RAG_AGENT]: 'Knowledge Base Expert',
  [AGENT_ID.SUPERVISOR]: 'Supervisor',
} as const;

// ============================================
// AGENT ICONS
// ============================================
export const AGENT_ICON: Record<AgentId, string> = {
  [AGENT_ID.BC_AGENT]: '📊',
  [AGENT_ID.RAG_AGENT]: '🧠',
  [AGENT_ID.SUPERVISOR]: '🎯',
} as const;

// ============================================
// AGENT COLORS (hex, for UI theming)
// ============================================
export const AGENT_COLOR: Record<AgentId, string> = {
  [AGENT_ID.BC_AGENT]: '#3B82F6',
  [AGENT_ID.RAG_AGENT]: '#10B981',
  [AGENT_ID.SUPERVISOR]: '#8B5CF6',
} as const;

// ============================================
// AGENT DESCRIPTIONS (for routing + UI)
// ============================================
export const AGENT_DESCRIPTION: Record<AgentId, string> = {
  [AGENT_ID.BC_AGENT]: 'Specialist in Microsoft Business Central ERP. Can query customers, vendors, invoices, sales orders, inventory, and other BC entities.',
  [AGENT_ID.RAG_AGENT]: 'Searches and analyzes uploaded documents using semantic search. Can answer questions based on document content.',
  [AGENT_ID.SUPERVISOR]: 'Routes queries to specialized agents and coordinates multi-step tasks.',
} as const;

// ============================================
// CAPABILITY TYPES
// ============================================
export const AGENT_CAPABILITY = {
  ERP_QUERY: 'erp_query',
  ERP_MUTATION: 'erp_mutation',
  RAG_SEARCH: 'rag_search',
  DATA_VIZ: 'data_viz',
  GENERAL: 'general',
} as const;

export type AgentCapability = (typeof AGENT_CAPABILITY)[keyof typeof AGENT_CAPABILITY];

// ============================================
// AGENT API
// ============================================
export const AGENT_API = {
  BASE: '/api/agents',
} as const;
