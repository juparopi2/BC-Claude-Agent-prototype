/**
 * Orchestrator.ts
 *
 * Main orchestration engine that routes user prompts to specialized agents.
 * Analyzes intent, selects appropriate agent, and coordinates execution.
 *
 * Pattern: Uses IntentAnalyzer for classification, AgentFactory for agent creation.
 */

import { type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import IntentAnalyzer from './IntentAnalyzer';
import {
  createQueryAgent,
  createWriteAgent,
  createValidationAgent,
  createAnalysisAgent,
} from './AgentFactory';
import type { ApprovalManager } from '../approval/ApprovalManager';
import type { TodoManager } from '../todo/TodoManager';
import type {
  IntentClassification,
  OrchestratorConfig,
  OrchestratorStatus,
} from '../../types/orchestration.types';
import type { AgentEvent, AgentType } from '../../types/agent.types';
import { v4 as uuidv4 } from 'uuid';

/**
 * Orchestrator class
 * Singleton pattern for consistent orchestration across the application
 */
export class Orchestrator {
  private static instance: Orchestrator;
  private intentAnalyzer: typeof IntentAnalyzer;
  private approvalManager: ApprovalManager | null = null;
  private todoManager: TodoManager | null = null;
  private mcpServers: Record<string, McpServerConfig> = {};
  private config: OrchestratorConfig;
  private activeExecutions: Map<string, boolean> = new Map();

  private constructor() {
    this.intentAnalyzer = IntentAnalyzer;
    this.config = {
      mcpServerUrl: '',
      anthropicApiKey: '',
      enableMultiStep: true,
      enableAutoValidation: true,
      maxAgentChainLength: 5,
      intentAnalysisTimeout: 5000,
      fallbackToGeneralAgent: true,
    };
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): Orchestrator {
    if (!Orchestrator.instance) {
      Orchestrator.instance = new Orchestrator();
    }
    return Orchestrator.instance;
  }

  /**
   * Initialize the orchestrator with dependencies
   */
  public initialize(
    mcpServers: Record<string, McpServerConfig>,
    approvalManager: ApprovalManager,
    todoManager: TodoManager,
    config?: Partial<OrchestratorConfig>
  ): void {
    this.mcpServers = mcpServers;
    this.approvalManager = approvalManager;
    this.todoManager = todoManager;

    if (config) {
      this.config = { ...this.config, ...config };
    }

    console.log('[Orchestrator] Initialized successfully');
  }

  /**
   * Main entry point: Analyze intent and execute with appropriate agent
   */
  public async analyzeAndExecute(
    prompt: string,
    sessionId: string,
    userId?: string
  ): Promise<AsyncGenerator<AgentEvent, void, unknown>> {
    console.log(`[Orchestrator] Analyzing and executing prompt for session ${sessionId}`);

    // Mark execution as active
    this.activeExecutions.set(sessionId, true);

    try {
      // Step 1: Analyze intent
      const classification = await this.intentAnalyzer.analyze(prompt, {
        includeReasoning: true,
      });

      console.log('[Orchestrator] Intent classification:', {
        intent: classification.intent,
        confidence: classification.confidence,
        entities: classification.entities,
        suggestedAgent: classification.suggestedAgent,
        isMultiStep: classification.isMultiStep,
      });

      // Step 2: Execute based on classification
      if (classification.isMultiStep && this.config.enableMultiStep) {
        // Multi-step orchestration
        return this.executeMultiStep(classification, sessionId, userId);
      } else {
        // Single-step execution
        return this.executeSingleStep(classification, prompt, sessionId, userId);
      }
    } catch (error) {
      console.error('[Orchestrator] Error during orchestration:', error);

      // Fallback to general agent if enabled
      if (this.config.fallbackToGeneralAgent) {
        console.log('[Orchestrator] Falling back to general agent');
        return this.executeWithGeneralAgent(prompt, sessionId);
      }

      throw error;
    } finally {
      // Mark execution as complete
      this.activeExecutions.delete(sessionId);
    }
  }

  /**
   * Execute single-step request with appropriate specialized agent
   */
  private async executeSingleStep(
    classification: IntentClassification,
    prompt: string,
    sessionId: string,
    _userId?: string
  ): Promise<AsyncGenerator<AgentEvent, void, unknown>> {
    const agentType = this.selectAgentType(classification);

    console.log(`[Orchestrator] Executing single-step with agent: ${agentType}`);

    // Route to appropriate agent factory
    switch (agentType) {
      case 'bc_query':
        return this.executeWithQueryAgent(prompt, sessionId);

      case 'bc_write':
        if (!this.approvalManager) {
          throw new Error('ApprovalManager not initialized');
        }
        return this.executeWithWriteAgent(prompt, sessionId);

      case 'bc_validation':
        return this.executeWithValidationAgent(prompt, sessionId);

      case 'bc_analysis':
        return this.executeWithAnalysisAgent(prompt, sessionId);

      default:
        // Fallback to general agent
        console.log(`[Orchestrator] Unknown agent type ${agentType}, using general agent`);
        return this.executeWithGeneralAgent(prompt, sessionId);
    }
  }

  /**
   * Execute multi-step request with coordinated agents
   */
  private async executeMultiStep(
    classification: IntentClassification,
    sessionId: string,
    userId?: string
  ): Promise<AsyncGenerator<AgentEvent, void, unknown>> {
    console.log('[Orchestrator] Multi-step execution not yet implemented');
    console.log('[Orchestrator] Falling back to single-step execution');

    // For MVP, fall back to single-step
    // TODO: Implement multi-step coordination in Phase 2
    return this.executeSingleStep(classification, classification.originalPrompt, sessionId, userId);
  }

  /**
   * Execute with Query Agent
   */
  private async executeWithQueryAgent(
    prompt: string,
    sessionId: string
  ): Promise<AsyncGenerator<AgentEvent, void, unknown>> {
    console.log('[Orchestrator] Executing with QueryAgent');

    const agentResult = createQueryAgent(prompt, sessionId, this.mcpServers);

    return this.streamAgentEvents(agentResult, 'bc_query', sessionId);
  }

  /**
   * Execute with Write Agent
   */
  private async executeWithWriteAgent(
    prompt: string,
    sessionId: string
  ): Promise<AsyncGenerator<AgentEvent, void, unknown>> {
    console.log('[Orchestrator] Executing with WriteAgent');

    if (!this.approvalManager) {
      throw new Error('ApprovalManager required for WriteAgent');
    }

    const agentResult = createWriteAgent(
      prompt,
      sessionId,
      this.mcpServers,
      this.approvalManager
    );

    return this.streamAgentEvents(agentResult, 'bc_write', sessionId);
  }

  /**
   * Execute with Validation Agent
   */
  private async executeWithValidationAgent(
    prompt: string,
    sessionId: string
  ): Promise<AsyncGenerator<AgentEvent, void, unknown>> {
    console.log('[Orchestrator] Executing with ValidationAgent');

    const agentResult = createValidationAgent(prompt, sessionId, this.mcpServers);

    return this.streamAgentEvents(agentResult, 'bc_validation', sessionId);
  }

  /**
   * Execute with Analysis Agent
   */
  private async executeWithAnalysisAgent(
    prompt: string,
    sessionId: string
  ): Promise<AsyncGenerator<AgentEvent, void, unknown>> {
    console.log('[Orchestrator] Executing with AnalysisAgent');

    const agentResult = createAnalysisAgent(prompt, sessionId, this.mcpServers);

    return this.streamAgentEvents(agentResult, 'bc_analysis', sessionId);
  }

  /**
   * Fallback: Execute with general agent (no specialization)
   */
  private async executeWithGeneralAgent(
    prompt: string,
    sessionId: string
  ): Promise<AsyncGenerator<AgentEvent, void, unknown>> {
    console.log('[Orchestrator] Executing with general agent');

    // Use QueryAgent as fallback general agent
    const agentResult = createQueryAgent(prompt, sessionId, this.mcpServers);

    return this.streamAgentEvents(agentResult, 'general', sessionId);
  }

  /**
   * Stream events from Agent SDK to AgentEvent format
   */
  private async *streamAgentEvents(
    agentResult: ReturnType<typeof createQueryAgent>,
    agentType: AgentType,
    sessionId: string
  ): AsyncGenerator<AgentEvent, void, unknown> {
    try {
      for await (const event of agentResult) {
        // Map SDK event to AgentEvent
        const agentEvent = this.mapSDKEventToAgentEvent(event, agentType, sessionId);

        if (agentEvent) {
          yield agentEvent;
        }
      }
    } catch (error) {
      console.error('[Orchestrator] Error streaming agent events:', error);

      // Yield error event
      yield {
        type: 'error',
        timestamp: new Date(),
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Map SDK event to AgentEvent format
   */
  private mapSDKEventToAgentEvent(
    sdkEvent: Record<string, unknown>,
    _agentType: AgentType,
    sessionId: string
  ): AgentEvent | null {
    const timestamp = new Date();

    switch (sdkEvent.type) {
      case 'thinking':
        return {
          type: 'thinking',
          timestamp,
          sessionId,
          content: sdkEvent.thinking || '',
        };

      case 'tool_use':
        return {
          type: 'tool_use',
          timestamp,
          sessionId,
          toolUseId: sdkEvent.id || uuidv4(),
          toolName: sdkEvent.name || '',
          args: sdkEvent.input || {},
        };

      case 'tool_result':
        return {
          type: 'tool_result',
          timestamp,
          sessionId,
          toolUseId: sdkEvent.tool_use_id || '',
          toolName: sdkEvent.name || 'unknown',
          result: sdkEvent.content || '',
          success: !sdkEvent.is_error,
          error: sdkEvent.is_error ? String(sdkEvent.content) : undefined,
        };

      case 'message_partial':
        return {
          type: 'message_partial',
          timestamp,
          sessionId,
          content: sdkEvent.delta?.text || '',
        };

      case 'message':
        return {
          type: 'message',
          timestamp,
          sessionId,
          content: sdkEvent.content?.[0]?.text || '',
          messageId: `msg_${Date.now()}`,
          role: (sdkEvent.role || 'assistant') as 'user' | 'assistant',
          tokenUsage: sdkEvent.usage ? {
            inputTokens: sdkEvent.usage.input_tokens || 0,
            outputTokens: sdkEvent.usage.output_tokens || 0,
          } : undefined,
        };

      case 'error':
        return {
          type: 'error',
          timestamp,
          sessionId,
          error: sdkEvent.error?.message || 'Unknown error',
        };

      default:
        console.warn('[Orchestrator] Unknown SDK event type:', sdkEvent.type);
        return null;
    }
  }

  /**
   * Select agent type based on classification
   */
  private selectAgentType(classification: IntentClassification): AgentType {
    // Use the suggested agent from classification
    return classification.suggestedAgent;
  }

  /**
   * Get orchestrator status
   */
  public getStatus(): OrchestratorStatus {
    return {
      initialized: this.approvalManager !== null && this.todoManager !== null,
      enabled: true,
      config: this.config,
      activeExecutions: this.activeExecutions.size,
    };
  }

  /**
   * Check if orchestrator is properly configured
   */
  public isConfigured(): boolean {
    return (
      this.approvalManager !== null &&
      this.todoManager !== null &&
      Object.keys(this.mcpServers).length > 0
    );
  }
}

// Export singleton instance
export default Orchestrator.getInstance();
