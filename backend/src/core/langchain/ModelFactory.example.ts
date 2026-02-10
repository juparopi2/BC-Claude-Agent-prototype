/**
 * Usage examples for ModelFactory
 *
 * ModelFactory uses direct LangChain provider constructors for multi-provider support.
 * Models are configured by role, making it easy to switch providers.
 */

import { ModelFactory } from './ModelFactory';

// Example 1: Create model by role (recommended)
// This is the standard pattern for all agent code
async function roleBasedExample() {
  const bcModel = await ModelFactory.create('bc_agent');
  const ragModel = await ModelFactory.create('rag_agent');
  const supervisorModel = await ModelFactory.create('supervisor');

  // Use the model
  // const response = await bcModel.invoke([new HumanMessage('Hello')]);
  return { bcModel, ragModel, supervisorModel };
}

// Example 2: Create model with different provider
// Useful for A/B testing or provider fallback
async function providerSwitchExample() {
  // Use OpenAI instead of default Anthropic
  const openAiModel = await ModelFactory.createWithProvider('bc_agent', 'openai');

  // Use Google
  const googleModel = await ModelFactory.createWithProvider('rag_agent', 'google');

  return { openAiModel, googleModel };
}

// Example 3: Create model from explicit config
// For advanced use cases where role config doesn't fit
async function explicitConfigExample() {
  const model = await ModelFactory.createFromConfig({
    provider: 'anthropic',
    modelName: 'claude-haiku-4-5-20251001',
    temperature: 0.5,
    maxTokens: 8192,
  });

  return model;
}

// Example 4: Check cache statistics
function cacheStatsExample() {
  const stats = ModelFactory.getCacheStats();
  console.log(`Cache size: ${stats.size}`);
  console.log(`Cached models: ${stats.keys.join(', ')}`);
}

// Example 5: Clear cache (useful for testing)
function clearCacheExample() {
  ModelFactory.clearCache();
  console.log('Model cache cleared');
}

export {
  roleBasedExample,
  providerSwitchExample,
  explicitConfigExample,
  cacheStatsExample,
  clearCacheExample,
};
