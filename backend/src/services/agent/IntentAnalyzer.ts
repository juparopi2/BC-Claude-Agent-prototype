/**
 * IntentAnalyzer.ts
 *
 * Analyzes user prompts to classify intent and extract entities.
 * Uses heuristic-based approach with keyword matching and pattern recognition.
 */

import {
  IntentType,
  EntityType,
  ConfidenceLevel,
  IntentClassification,
  IntentAnalysisOptions,
} from '../../types/orchestration.types';
import { AgentType } from '../../types/agent.types';

/**
 * Intent keywords mapping
 */
const INTENT_KEYWORDS: Record<IntentType, string[]> = {
  query: [
    'list', 'show', 'get', 'find', 'search', 'display', 'view', 'fetch',
    'retrieve', 'what', 'which', 'who', 'where', 'when', 'how many',
    'tell me', 'give me', 'can you show', 'i want to see'
  ],
  create: [
    'create', 'add', 'new', 'insert', 'make', 'register', 'set up',
    'establish', 'initialize', 'i need to create', 'i want to add'
  ],
  update: [
    'update', 'modify', 'change', 'edit', 'revise', 'adjust', 'alter',
    'set', 'rename', 'i need to update', 'i want to change'
  ],
  delete: [
    'delete', 'remove', 'cancel', 'drop', 'destroy', 'erase', 'clear',
    'i need to delete', 'i want to remove'
  ],
  validate: [
    'validate', 'check', 'verify', 'confirm', 'test', 'is this valid',
    'can i', 'would this work', 'is it possible', 'does this look right',
    'review this', 'check this'
  ],
  analyze: [
    'analyze', 'insight', 'trend', 'pattern', 'summary', 'report',
    'statistics', 'metrics', 'breakdown', 'comparison', 'why', 'explain',
    'what does this mean', 'tell me about'
  ],
  'multi-step': [
    'then', 'after that', 'next', 'also', 'and then', 'followed by',
    'first', 'second', 'finally', 'in addition'
  ],
  unknown: []
};

/**
 * Entity keywords mapping
 */
const ENTITY_KEYWORDS: Record<EntityType, string[]> = {
  customer: ['customer', 'client', 'buyer', 'account', 'customers'],
  vendor: ['vendor', 'supplier', 'sellers', 'vendors'],
  item: ['item', 'product', 'sku', 'goods', 'items', 'products', 'inventory'],
  sales_order: ['sales order', 'order', 'sale', 'orders', 'sales orders'],
  purchase_order: ['purchase order', 'purchase', 'po', 'purchase orders'],
  invoice: ['invoice', 'bill', 'invoices'],
  payment: ['payment', 'pay', 'transaction', 'payments'],
  general_ledger: ['general ledger', 'gl', 'ledger', 'account', 'chart of accounts'],
  unknown: []
};

/**
 * IntentAnalyzer class
 * Singleton pattern for consistent analysis across the application
 */
export class IntentAnalyzer {
  private static instance: IntentAnalyzer;

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): IntentAnalyzer {
    if (!IntentAnalyzer.instance) {
      IntentAnalyzer.instance = new IntentAnalyzer();
    }
    return IntentAnalyzer.instance;
  }

  /**
   * Analyze a user prompt to determine intent
   */
  public async analyze(
    prompt: string,
    options: IntentAnalysisOptions = {}
  ): Promise<IntentClassification> {
    const normalizedPrompt = prompt.toLowerCase().trim();

    // Extract entities first
    const entities = this.extractEntities(normalizedPrompt);

    // Classify intent
    const { intent, keywords, confidence } = this.classifyIntent(normalizedPrompt);

    // Extract operations
    const operations = this.extractOperations(normalizedPrompt, intent);

    // Check if multi-step
    const isMultiStep = this.isMultiStepRequest(normalizedPrompt);

    // Suggest appropriate agent
    const suggestedAgent = this.suggestAgentType(intent, isMultiStep);

    // Generate reasoning if requested
    const reasoning = options.includeReasoning
      ? this.generateReasoning(intent, entities, keywords, isMultiStep)
      : undefined;

    return {
      intent,
      confidence,
      entities,
      operations,
      keywords,
      isMultiStep,
      suggestedAgent,
      originalPrompt: prompt,
      reasoning,
    };
  }

  /**
   * Classify the primary intent of the prompt
   */
  private classifyIntent(prompt: string): {
    intent: IntentType;
    keywords: string[];
    confidence: ConfidenceLevel;
  } {
    const scores: Record<IntentType, { score: number; keywords: string[] }> = {
      query: { score: 0, keywords: [] },
      create: { score: 0, keywords: [] },
      update: { score: 0, keywords: [] },
      delete: { score: 0, keywords: [] },
      validate: { score: 0, keywords: [] },
      analyze: { score: 0, keywords: [] },
      'multi-step': { score: 0, keywords: [] },
      unknown: { score: 0, keywords: [] },
    };

    // Score each intent based on keyword matches
    for (const [intentKey, keywords] of Object.entries(INTENT_KEYWORDS)) {
      const intent = intentKey as IntentType;
      for (const keyword of keywords) {
        if (prompt.includes(keyword)) {
          scores[intent].score += 1;
          scores[intent].keywords.push(keyword);
        }
      }
    }

    // Find highest scoring intent
    let maxScore = 0;
    let primaryIntent: IntentType = 'unknown';
    let matchedKeywords: string[] = [];

    for (const [intent, data] of Object.entries(scores)) {
      if (data.score > maxScore) {
        maxScore = data.score;
        primaryIntent = intent as IntentType;
        matchedKeywords = data.keywords;
      }
    }

    // Determine confidence
    let confidence: ConfidenceLevel = 'low';
    if (maxScore >= 3) {
      confidence = 'high';
    } else if (maxScore >= 2) {
      confidence = 'medium';
    }

    // If no clear winner, mark as unknown with low confidence
    if (maxScore === 0) {
      primaryIntent = 'unknown';
      confidence = 'low';
    }

    return { intent: primaryIntent, keywords: matchedKeywords, confidence };
  }

  /**
   * Extract entities from the prompt
   */
  private extractEntities(prompt: string): EntityType[] {
    const entities: EntityType[] = [];
    const uniqueEntities = new Set<EntityType>();

    for (const [entityKey, keywords] of Object.entries(ENTITY_KEYWORDS)) {
      const entity = entityKey as EntityType;
      for (const keyword of keywords) {
        if (prompt.includes(keyword)) {
          uniqueEntities.add(entity);
          break; // One match per entity is enough
        }
      }
    }

    // Convert Set to Array
    entities.push(...Array.from(uniqueEntities));

    // If no entities found, mark as unknown
    if (entities.length === 0) {
      entities.push('unknown');
    }

    return entities;
  }

  /**
   * Extract specific operations from the prompt
   */
  private extractOperations(prompt: string, intent: IntentType): string[] {
    const operations: string[] = [];

    // Based on intent, extract specific operations
    switch (intent) {
      case 'query':
        if (prompt.includes('list') || prompt.includes('show all')) {
          operations.push('list');
        }
        if (prompt.includes('get') || prompt.includes('find') || prompt.includes('search')) {
          operations.push('search');
        }
        if (prompt.includes('filter') || prompt.includes('where')) {
          operations.push('filter');
        }
        break;

      case 'create':
        operations.push('create');
        break;

      case 'update':
        operations.push('update');
        if (prompt.includes('add') && !prompt.includes('new')) {
          operations.push('append');
        }
        break;

      case 'delete':
        operations.push('delete');
        break;

      case 'validate':
        operations.push('validate');
        break;

      case 'analyze':
        if (prompt.includes('trend')) operations.push('trend_analysis');
        if (prompt.includes('summary')) operations.push('summarize');
        if (prompt.includes('compare')) operations.push('compare');
        break;
    }

    return operations;
  }

  /**
   * Check if the request requires multiple steps
   */
  private isMultiStepRequest(prompt: string): boolean {
    const multiStepIndicators = INTENT_KEYWORDS['multi-step'];
    let indicatorCount = 0;

    for (const indicator of multiStepIndicators) {
      if (prompt.includes(indicator)) {
        indicatorCount++;
      }
    }

    // If multiple indicators or multiple verbs, likely multi-step
    return indicatorCount >= 2 || this.hasMultipleVerbs(prompt);
  }

  /**
   * Check if prompt has multiple action verbs (indicates multi-step)
   */
  private hasMultipleVerbs(prompt: string): boolean {
    const actionVerbs = [
      'create', 'update', 'delete', 'validate', 'check', 'list',
      'add', 'remove', 'modify', 'analyze'
    ];

    let verbCount = 0;
    for (const verb of actionVerbs) {
      if (prompt.includes(verb)) {
        verbCount++;
      }
    }

    return verbCount >= 2;
  }

  /**
   * Suggest the appropriate agent type for this intent
   */
  private suggestAgentType(intent: IntentType, isMultiStep: boolean): AgentType {
    if (isMultiStep) {
      return 'general'; // Use general agent for multi-step (orchestrator will handle)
    }

    switch (intent) {
      case 'query':
        return 'bc_query';
      case 'create':
      case 'update':
      case 'delete':
        return 'bc_write';
      case 'validate':
        return 'bc_validation';
      case 'analyze':
        return 'bc_analysis';
      default:
        return 'general'; // Fallback to general agent
    }
  }

  /**
   * Generate reasoning for the classification
   */
  private generateReasoning(
    intent: IntentType,
    entities: EntityType[],
    keywords: string[],
    isMultiStep: boolean
  ): string {
    let reasoning = `Classified as "${intent}" intent based on keywords: ${keywords.join(', ')}.`;

    if (entities.length > 0 && entities[0] !== 'unknown') {
      reasoning += ` Detected entities: ${entities.join(', ')}.`;
    }

    if (isMultiStep) {
      reasoning += ' Detected multi-step request.';
    }

    return reasoning;
  }

  /**
   * Validate if a classification result is reliable
   */
  public isReliableClassification(classification: IntentClassification): boolean {
    // High or medium confidence is considered reliable
    if (classification.confidence === 'high' || classification.confidence === 'medium') {
      return true;
    }

    // Low confidence with unknown intent is unreliable
    if (classification.confidence === 'low' && classification.intent === 'unknown') {
      return false;
    }

    // Low confidence but clear intent is marginally reliable
    return classification.confidence === 'low' && classification.intent !== 'unknown';
  }

  /**
   * Get statistics about classification (for monitoring)
   */
  public getClassificationStats(classifications: IntentClassification[]): {
    totalClassifications: number;
    intentDistribution: Record<IntentType, number>;
    averageConfidence: number;
    reliablePercentage: number;
  } {
    const intentDistribution: Record<IntentType, number> = {
      query: 0,
      create: 0,
      update: 0,
      delete: 0,
      validate: 0,
      analyze: 0,
      'multi-step': 0,
      unknown: 0,
    };

    let reliableCount = 0;
    const confidenceScores = { high: 3, medium: 2, low: 1 };
    let totalConfidenceScore = 0;

    for (const classification of classifications) {
      intentDistribution[classification.intent]++;
      totalConfidenceScore += confidenceScores[classification.confidence];

      if (this.isReliableClassification(classification)) {
        reliableCount++;
      }
    }

    return {
      totalClassifications: classifications.length,
      intentDistribution,
      averageConfidence: totalConfidenceScore / classifications.length,
      reliablePercentage: (reliableCount / classifications.length) * 100,
    };
  }
}

// Export singleton instance
export default IntentAnalyzer.getInstance();
