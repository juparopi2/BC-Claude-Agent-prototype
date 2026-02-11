/**
 * FirstCallToolEnforcer - Hybrid tool enforcement for ReAct agents
 *
 * Forces tool_choice: 'any' on the first LLM call per invocation, then
 * switches to 'auto' for subsequent calls. This guarantees at least one
 * domain tool call per invocation while allowing natural ReAct termination.
 *
 * Mechanism:
 * - Creates two bound models: forced (tool_choice: 'any') and auto (default 'auto')
 * - Overrides invoke() on the forced model to switch based on call count per key
 * - Key priority: invocationId (unique per user message) > thread_id > '__default__'
 * - Returns a RunnableBinding that createReactAgent's _shouldBindTools() recognizes
 *   as pre-bound (config.tools present via ChatAnthropic.withConfig), so it skips re-binding
 *
 * Thread safety: Uses a Map<key, callCount> for concurrent invocations.
 * invocationId format: `inv-${Date.now()}` (generated per supervisor stream/invoke call).
 *
 * @module core/langchain/FirstCallToolEnforcer
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { Runnable, RunnableConfig } from '@langchain/core/runnables';
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import { RunnableBinding } from '@langchain/core/runnables';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'FirstCallToolEnforcer' });

/** Maximum tracked thread_ids before eviction (prevents unbounded growth) */
const MAX_TRACKED_THREADS = 100;

/**
 * Creates a hybrid tool-enforced model wrapper.
 *
 * - First LLM call per thread_id: tool_choice 'any' (must call a tool)
 * - Subsequent calls per thread_id: tool_choice 'auto' (can respond with text)
 *
 * The returned object is a RunnableBinding with config.tools set
 * (ChatAnthropic.bindTools uses withConfig, storing tools in config not kwargs).
 * createReactAgent's _shouldBindTools() checks config.tools as fallback → returns false.
 *
 * @param model - Base chat model (must support bindTools)
 * @param tools - Domain tools to bind
 * @returns Pre-bound Runnable compatible with createReactAgent's llm param
 * @throws If model does not support bindTools
 */
export function createFirstCallEnforcer(
  model: BaseChatModel,
  tools: StructuredToolInterface[],
): Runnable {
  if (!('bindTools' in model) || typeof model.bindTools !== 'function') {
    throw new Error(
      'Model does not support bindTools — cannot create first-call enforcer'
    );
  }

  // Two bound variants: forced (must call tool) and auto (can finish with text)
  const forcedBound = model.bindTools(tools, { tool_choice: 'any' });
  const autoBound = model.bindTools(tools);

  // Diagnostic: verify the binding structure at creation time
  const binding = forcedBound as unknown as {
    bound?: unknown;
    kwargs?: Record<string, unknown>;
    config?: Record<string, unknown>;
  };
  const isBinding = RunnableBinding.isRunnableBinding(forcedBound);
  const hasConfigTools = Array.isArray(binding.config?.tools);
  const hasKwargsTools = Array.isArray(binding.kwargs?.tools);
  const toolChoice = binding.config?.tool_choice ?? binding.kwargs?.tool_choice;

  logger.info(
    {
      isRunnableBinding: isBinding,
      hasConfigTools,
      hasKwargsTools,
      configToolCount: hasConfigTools ? (binding.config!.tools as unknown[]).length : 0,
      toolChoice,
      kwargsKeys: binding.kwargs ? Object.keys(binding.kwargs) : [],
      configKeys: binding.config ? Object.keys(binding.config) : [],
    },
    'Created enforcer binding — diagnostics'
  );

  // Per-thread call tracking for concurrent safety
  const callCounts = new Map<string, number>();

  // Preserve original invoke methods before override
  const originalForcedInvoke = forcedBound.invoke.bind(forcedBound);
  const autoInvoke = autoBound.invoke.bind(autoBound);

  // Override invoke() as own property — executes on each ReAct loop iteration.
  // createReactAgent's callModel() calls modelRunnable.invoke(messages, config)
  // where config includes configurable.thread_id.
  const overriddenInvoke = async (
    input: BaseLanguageModelInput,
    options?: Partial<RunnableConfig>,
  ): Promise<unknown> => {
    const configurable = options?.configurable as Record<string, unknown> | undefined;
    const invocationId = configurable?.invocationId as string | undefined;
    const threadId = configurable?.thread_id as string | undefined;
    const key = invocationId ?? threadId ?? '__default__';

    const count = (callCounts.get(key) ?? 0) + 1;
    callCounts.set(key, count);

    // Prevent unbounded Map growth — evict oldest entries
    if (callCounts.size > MAX_TRACKED_THREADS) {
      const firstKey = callCounts.keys().next().value as string;
      if (firstKey !== key) {
        callCounts.delete(firstKey);
      }
    }

    if (count === 1) {
      logger.info(
        { threadId, callCount: count },
        'ENFORCING tool_choice: any (first call)'
      );
      return originalForcedInvoke(input, options);
    }

    logger.info(
      { threadId, callCount: count },
      'Using tool_choice: auto (subsequent call)'
    );
    return autoInvoke(input, options);
  };

  // Assign override — safe because RunnableBinding.invoke is a regular method
  // The cast is necessary because Runnable.invoke has generic type params
  // that don't match our concrete signature, but delegation preserves types
  (forcedBound as unknown as { invoke: typeof overriddenInvoke }).invoke =
    overriddenInvoke;

  return forcedBound;
}
