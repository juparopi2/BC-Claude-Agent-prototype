/**
 * FirstCallToolEnforcer - Hybrid tool enforcement for ReAct agents
 *
 * Forces tool_choice: 'any' on the first LLM call per thread_id, then
 * switches to 'auto' for subsequent calls. This guarantees at least one
 * domain tool call per invocation while allowing natural ReAct termination.
 *
 * Mechanism:
 * - Creates two bound models: forced (tool_choice: 'any') and auto (default 'auto')
 * - Overrides invoke() on the forced model to switch based on call count per thread_id
 * - Returns a RunnableBinding that createReactAgent's _shouldBindTools() recognizes
 *   as pre-bound (kwargs.tools present), so it skips re-binding
 *
 * Thread safety: Uses a Map<thread_id, callCount> for concurrent invocations.
 * Each thread_id is unique per invocation (e.g., `${sessionId}-${Date.now()}`).
 *
 * @module core/langchain/FirstCallToolEnforcer
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { Runnable, RunnableConfig } from '@langchain/core/runnables';
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';
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
 * The returned object is a RunnableBinding with kwargs.tools set, so
 * createReactAgent's _shouldBindTools() returns false (skips re-binding).
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
    const threadId = (
      options?.configurable as Record<string, unknown> | undefined
    )?.thread_id as string | undefined;
    const key = threadId ?? '__default__';

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
      logger.debug(
        { threadId, callCount: count },
        'Enforced tool_choice: any (first call)'
      );
      return originalForcedInvoke(input, options);
    }

    logger.debug(
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
