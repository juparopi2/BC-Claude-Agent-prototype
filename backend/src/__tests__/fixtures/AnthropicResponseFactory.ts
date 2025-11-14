/**
 * AnthropicResponseFactory - Builder pattern for test responses
 *
 * This factory makes it easy to create FakeAnthropicClient responses for tests.
 * Uses the Builder pattern to allow fluent, readable test setup.
 *
 * Benefits:
 * - Reduces test boilerplate
 * - Makes tests more readable
 * - Provides sensible defaults
 * - Easy to create complex scenarios
 * - Self-documenting (method names explain what they do)
 *
 * Usage:
 * ```typescript
 * const response = AnthropicResponseFactory.textResponse()
 *   .withText('Hello, how can I help?')
 *   .build();
 *
 * const toolUseResponse = AnthropicResponseFactory.toolUseResponse()
 *   .withTool('list_all_entities', { filter_by_operations: ['list'] })
 *   .build();
 * ```
 */

/**
 * Builder for creating fake Anthropic responses
 */
export class AnthropicResponseFactory {
  private textBlocks: string[] = [];
  private toolUseBlocks: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }> = [];
  private stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' = 'end_turn';
  private inputTokens = 100;
  private outputTokens = 50;

  /**
   * Creates a new factory for a text response
   */
  static textResponse(): AnthropicResponseFactory {
    return new AnthropicResponseFactory();
  }

  /**
   * Creates a new factory for a tool use response
   */
  static toolUseResponse(): AnthropicResponseFactory {
    const factory = new AnthropicResponseFactory();
    factory.stopReason = 'tool_use';
    return factory;
  }

  /**
   * Creates a new factory for a max tokens response
   */
  static maxTokensResponse(): AnthropicResponseFactory {
    const factory = new AnthropicResponseFactory();
    factory.stopReason = 'max_tokens';
    return factory;
  }

  /**
   * Adds a text block to the response
   *
   * @param text - The text content
   * @returns This factory for chaining
   */
  withText(text: string): this {
    this.textBlocks.push(text);
    return this;
  }

  /**
   * Adds multiple text blocks
   *
   * @param texts - Array of text contents
   * @returns This factory for chaining
   */
  withTexts(texts: string[]): this {
    this.textBlocks.push(...texts);
    return this;
  }

  /**
   * Adds a tool use block
   *
   * @param toolName - Name of the tool
   * @param input - Tool input parameters
   * @param toolId - Optional custom tool ID
   * @returns This factory for chaining
   */
  withTool(toolName: string, input: Record<string, unknown>, toolId?: string): this {
    this.toolUseBlocks.push({
      id: toolId || `toolu_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      name: toolName,
      input,
    });
    return this;
  }

  /**
   * Sets the stop reason
   *
   * @param reason - The stop reason
   * @returns This factory for chaining
   */
  withStopReason(reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use'): this {
    this.stopReason = reason;
    return this;
  }

  /**
   * Sets custom token usage
   *
   * @param inputTokens - Number of input tokens
   * @param outputTokens - Number of output tokens
   * @returns This factory for chaining
   */
  withTokens(inputTokens: number, outputTokens: number): this {
    this.inputTokens = inputTokens;
    this.outputTokens = outputTokens;
    return this;
  }

  /**
   * Builds the fake response configuration
   *
   * @returns The fake response object ready to use with FakeAnthropicClient
   */
  build(): {
    textBlocks?: string[];
    toolUseBlocks?: Array<{
      id: string;
      name: string;
      input: Record<string, unknown>;
    }>;
    stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
    usage: {
      input_tokens: number;
      output_tokens: number;
    };
  } {
    return {
      textBlocks: this.textBlocks.length > 0 ? this.textBlocks : undefined,
      toolUseBlocks: this.toolUseBlocks.length > 0 ? this.toolUseBlocks : undefined,
      stopReason: this.stopReason,
      usage: {
        input_tokens: this.inputTokens,
        output_tokens: this.outputTokens,
      },
    };
  }

  /**
   * Common presets for typical test scenarios
   */
  static readonly Presets = {
    /**
     * Simple text response
     */
    simpleText: (text = 'Hello, how can I help you?') =>
      AnthropicResponseFactory.textResponse().withText(text).build(),

    /**
     * Tool use: list_all_entities
     */
    listAllEntities: (filter?: string[]) =>
      AnthropicResponseFactory.toolUseResponse()
        .withText('Let me get all the entities for you.')
        .withTool('list_all_entities', filter ? { filter_by_operations: filter } : {})
        .build(),

    /**
     * Tool use: search_entity_operations
     */
    searchEntities: (keyword: string) =>
      AnthropicResponseFactory.toolUseResponse()
        .withText(`Searching for "${keyword}"...`)
        .withTool('search_entity_operations', { keyword })
        .build(),

    /**
     * Tool use: get_operation_details
     */
    getOperation: (operationId: string) =>
      AnthropicResponseFactory.toolUseResponse()
        .withText('Getting operation details...')
        .withTool('get_operation_details', { operation_id: operationId })
        .build(),

    /**
     * Tool use: validate_workflow (write operation)
     */
    validateWorkflow: (workflow: unknown[]) =>
      AnthropicResponseFactory.toolUseResponse()
        .withText('Validating the workflow...')
        .withTool('validate_workflow', { workflow })
        .build(),

    /**
     * Max tokens reached
     */
    maxTokens: () =>
      AnthropicResponseFactory.maxTokensResponse()
        .withText('This is a very long response that exceeded the token limit...')
        .build(),

    /**
     * Multi-turn conversation
     */
    conversational: (messages: string[]) => {
      const factory = AnthropicResponseFactory.textResponse();
      for (const message of messages) {
        factory.withText(message);
      }
      return factory.build();
    },
  };
}
