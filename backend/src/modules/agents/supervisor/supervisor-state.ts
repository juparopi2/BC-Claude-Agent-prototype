/**
 * Supervisor State Schema
 *
 * Defines the state schema used by createSupervisor and createReactAgent.
 * The primary userId mechanism is config.configurable (LangGraph auto-propagates to children).
 *
 * @module modules/agents/supervisor/supervisor-state
 */

import { MessagesAnnotation } from '@langchain/langgraph';

/**
 * Supervisor uses MessagesAnnotation (standard LangGraph message state).
 * userId/sessionId are passed via config.configurable, not state fields,
 * because createSupervisor manages its own state schema internally.
 */
export const SupervisorStateAnnotation = MessagesAnnotation;

export type SupervisorState = typeof SupervisorStateAnnotation.State;
