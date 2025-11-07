/**
 * orchestration.types.ts
 *
 * Type definitions for the orchestration layer.
 * Defines intent classification, orchestrator config, and multi-agent coordination types.
 */

import { AgentType } from './agent.types';
import { AgentEvent } from './agent.types';

/**
 * Types of intents that can be classified from user prompts
 */
export type IntentType =
  | 'query'          // Read-only queries (list, get, search)
  | 'create'         // Create new entities
  | 'update'         // Update existing entities
  | 'delete'         // Delete entities
  | 'validate'       // Validate data without execution
  | 'analyze'        // Analysis and insights
  | 'multi-step'     // Complex multi-step operations
  | 'unknown';       // Unable to classify

/**
 * Entity types that can be identified in user prompts
 */
export type EntityType =
  | 'customer'
  | 'vendor'
  | 'item'
  | 'sales_order'
  | 'purchase_order'
  | 'invoice'
  | 'payment'
  | 'general_ledger'
  | 'unknown';

/**
 * Confidence level for intent classification
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/**
 * Result of intent classification
 */
export interface IntentClassification {
  /** Primary intent type */
  intent: IntentType;

  /** Confidence level of classification */
  confidence: ConfidenceLevel;

  /** Identified entities in the prompt */
  entities: EntityType[];

  /** Specific operations identified (create, list, update, etc.) */
  operations: string[];

  /** Keywords that influenced the classification */
  keywords: string[];

  /** Whether this requires multiple agents (multi-step) */
  isMultiStep: boolean;

  /** Suggested agent type to handle this intent */
  suggestedAgent: AgentType;

  /** Original user prompt */
  originalPrompt: string;

  /** Explanation of why this classification was chosen */
  reasoning?: string;
}

/**
 * Configuration for the Orchestrator
 */
export interface OrchestratorConfig {
  /** MCP server URL */
  mcpServerUrl: string;

  /** Anthropic API key */
  anthropicApiKey: string;

  /** Enable multi-step coordination */
  enableMultiStep: boolean;

  /** Enable automatic validation before writes */
  enableAutoValidation: boolean;

  /** Maximum number of sequential agent calls */
  maxAgentChainLength: number;

  /** Timeout for intent analysis (ms) */
  intentAnalysisTimeout: number;

  /** Fallback to general agent if classification fails */
  fallbackToGeneralAgent: boolean;
}

/**
 * A step in a multi-agent execution plan
 */
export interface AgentExecutionStep {
  /** Unique step ID */
  stepId: string;

  /** Agent type for this step */
  agentType: AgentType;

  /** Intent for this step */
  intent: IntentType;

  /** Prompt to send to the agent */
  prompt: string;

  /** Dependencies (step IDs that must complete before this) */
  dependsOn: string[];

  /** Whether this step can run in parallel with others */
  canRunParallel: boolean;

  /** Optional validation before execution */
  requiresValidation?: boolean;

  /** Optional approval before execution */
  requiresApproval?: boolean;
}

/**
 * Multi-agent execution plan
 */
export interface AgentExecutionPlan {
  /** Unique plan ID */
  planId: string;

  /** Original user request */
  originalRequest: string;

  /** Classified intent */
  intent: IntentClassification;

  /** Ordered steps to execute */
  steps: AgentExecutionStep[];

  /** Expected total duration (ms) */
  estimatedDuration?: number;

  /** Created timestamp */
  createdAt: Date;
}

/**
 * Result of a single agent execution step
 */
export interface StepExecutionResult {
  /** Step ID */
  stepId: string;

  /** Agent type used */
  agentType: AgentType;

  /** Whether step succeeded */
  success: boolean;

  /** Response from agent */
  response?: string;

  /** Events emitted during execution */
  events: AgentEvent[];

  /** Error if step failed */
  error?: Error;

  /** Duration of execution (ms) */
  duration: number;

  /** Started at */
  startedAt: Date;

  /** Completed at */
  completedAt: Date;
}

/**
 * Result of multi-step orchestration
 */
export interface MultiStepResult {
  /** Plan ID */
  planId: string;

  /** Overall success */
  success: boolean;

  /** Results of each step */
  stepResults: StepExecutionResult[];

  /** Final response to user */
  finalResponse: string;

  /** Total duration (ms) */
  totalDuration: number;

  /** Number of steps executed */
  stepsExecuted: number;

  /** Number of steps failed */
  stepsFailed: number;

  /** Whether execution was cancelled */
  cancelled: boolean;

  /** Cancellation reason */
  cancellationReason?: string;

  /** Error if orchestration failed */
  error?: Error;
}

/**
 * Orchestration metrics for monitoring
 */
export interface OrchestrationMetrics {
  /** Session ID */
  sessionId: string;

  /** Total orchestrations executed */
  totalExecutions: number;

  /** Intent distribution */
  intentDistribution: Record<IntentType, number>;

  /** Agent distribution */
  agentDistribution: Record<AgentType, number>;

  /** Average classification confidence */
  averageConfidence: number;

  /** Multi-step vs single-step ratio */
  multiStepRatio: number;

  /** Average execution duration (ms) */
  averageDuration: number;

  /** Success rate */
  successRate: number;
}

/**
 * Intent analysis options
 */
export interface IntentAnalysisOptions {
  /** Use LLM for classification (more accurate but slower) */
  useLLM?: boolean;

  /** Timeout for analysis (ms) */
  timeout?: number;

  /** Include reasoning in response */
  includeReasoning?: boolean;

  /** Context from previous messages */
  conversationContext?: string[];
}

/**
 * Orchestrator status
 */
export interface OrchestratorStatus {
  /** Whether orchestrator is initialized */
  initialized: boolean;

  /** Whether orchestrator is enabled */
  enabled: boolean;

  /** Current configuration */
  config: Partial<OrchestratorConfig>;

  /** Active executions count */
  activeExecutions: number;

  /** Metrics */
  metrics?: OrchestrationMetrics;
}
