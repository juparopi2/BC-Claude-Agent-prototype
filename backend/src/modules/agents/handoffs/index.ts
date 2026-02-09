/**
 * Handoffs Module (PRD-040)
 *
 * Dynamic agent handoffs via LangGraph Command pattern.
 *
 * @module modules/agents/handoffs
 */

export { createAgentHandoffTool, type CreateHandoffToolParams } from './handoff-tools';
export { buildHandoffToolsForAgent } from './handoff-tool-builder';
export { processUserAgentSelection, type UserAgentSelectionResult } from './user-handoff';
