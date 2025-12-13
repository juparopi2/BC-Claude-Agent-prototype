/**
 * Usage examples for ModelFactory with Prompt Caching and Extended Thinking
 */

import { ModelFactory } from './ModelFactory';

// Example 1: Basic usage without caching or thinking
const basicModel = ModelFactory.create({
  provider: 'anthropic',
  modelName: 'claude-3-5-sonnet-20241022',
  temperature: 0.7,
  maxTokens: 4096,
});

// Example 2: Enable Prompt Caching for repeated prompts
// Use this when you have system prompts or tools that are repeated across requests
const cachedModel = ModelFactory.create({
  provider: 'anthropic',
  modelName: 'claude-3-5-sonnet-20241022',
  enableCaching: true, // Enables prompt caching beta feature
  temperature: 0.7,
  maxTokens: 4096,
});

// Example 3: Enable Extended Thinking for complex reasoning
// Use this when you need Claude to think through problems step by step
const thinkingModel = ModelFactory.create({
  provider: 'anthropic',
  modelName: 'claude-3-5-sonnet-20241022',
  enableThinking: true, // Enables extended thinking
  thinkingBudget: 2048, // Allocate 2048 tokens for thinking (min: 1024)
  maxTokens: 8192, // Must be greater than thinkingBudget
  temperature: 0.7,
});

// Example 4: Combine both features for optimal performance
// Best for complex, repeated queries that benefit from both caching and reasoning
const optimizedModel = ModelFactory.create({
  provider: 'anthropic',
  modelName: 'claude-3-5-sonnet-20241022',
  enableCaching: true, // Cache system prompts and tools
  enableThinking: true, // Enable reasoning process
  thinkingBudget: 3072, // More tokens for complex reasoning
  maxTokens: 8192,
  temperature: 0.7,
});

// Example 5: Use with default settings
const defaultModel = ModelFactory.createDefault();

export {
  basicModel,
  cachedModel,
  thinkingModel,
  optimizedModel,
  defaultModel,
};
