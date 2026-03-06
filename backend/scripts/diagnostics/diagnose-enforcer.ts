/**
 * Diagnostic script: Verify FirstCallToolEnforcer works with real ChatAnthropic
 *
 * Tests the enforcer binding structure and simulates what createReactAgent does
 * internally with _shouldBindTools.
 *
 * Usage: npx tsx scripts/diagnose-enforcer.ts
 */

import 'dotenv/config';
import { RunnableBinding } from '@langchain/core/runnables';
import { ModelFactory } from '../src/core/langchain/ModelFactory';
import { createFirstCallEnforcer } from '../src/core/langchain/FirstCallToolEnforcer';
import { getAgentRegistry, resetAgentRegistry } from '../src/modules/agents/core/registry/AgentRegistry';
import { registerAgents } from '../src/modules/agents/core/registry/registerAgents';

async function main() {
  console.log('=== FirstCallToolEnforcer Diagnostic ===\n');

  // 1. Setup registry
  resetAgentRegistry();
  registerAgents();
  const registry = getAgentRegistry();

  // 2. Get BC agent definition and tools
  const bcDef = registry.getWorkerAgents().find(a => a.id === 'bc-agent');
  if (!bcDef) {
    console.error('BC agent not found in registry');
    process.exit(1);
  }

  const tools = registry.getToolsForAgent(bcDef.id);
  console.log(`BC agent tools: ${tools.length}`);
  console.log(`Tool names: ${tools.map(t => t.name).join(', ')}\n`);

  // 3. Create model
  const model = await ModelFactory.create(bcDef.modelRole);
  console.log(`Model type: ${model.constructor.name}`);
  console.log(`Model has bindTools: ${'bindTools' in model && typeof model.bindTools === 'function'}\n`);

  // 4. Test raw bindTools
  console.log('--- Raw bindTools test ---');
  const rawBound = model.bindTools(tools, { tool_choice: 'any' });
  const rawBinding = rawBound as unknown as {
    bound?: unknown;
    kwargs?: Record<string, unknown>;
    config?: Record<string, unknown>;
  };
  console.log(`isRunnableBinding: ${RunnableBinding.isRunnableBinding(rawBound)}`);
  console.log(`kwargs keys: ${rawBinding.kwargs ? JSON.stringify(Object.keys(rawBinding.kwargs)) : 'null'}`);
  console.log(`config keys: ${rawBinding.config ? JSON.stringify(Object.keys(rawBinding.config)) : 'null'}`);
  console.log(`kwargs.tools exists: ${Array.isArray(rawBinding.kwargs?.tools)}`);
  console.log(`config.tools exists: ${Array.isArray(rawBinding.config?.tools)}`);
  console.log(`config.tool_choice: ${JSON.stringify(rawBinding.config?.tool_choice)}`);
  console.log(`kwargs.tool_choice: ${JSON.stringify(rawBinding.kwargs?.tool_choice)}`);
  if (rawBinding.config?.tools) {
    console.log(`config.tools count: ${(rawBinding.config.tools as unknown[]).length}`);
    const firstTool = (rawBinding.config.tools as Record<string, unknown>[])[0];
    console.log(`First tool name: ${firstTool?.name}`);
  }
  console.log();

  // 5. Test enforcer
  console.log('--- FirstCallToolEnforcer test ---');
  const enforced = createFirstCallEnforcer(model, tools);
  const enforcedBinding = enforced as unknown as {
    bound?: unknown;
    kwargs?: Record<string, unknown>;
    config?: Record<string, unknown>;
  };
  console.log(`isRunnableBinding: ${RunnableBinding.isRunnableBinding(enforced)}`);
  console.log(`kwargs keys: ${enforcedBinding.kwargs ? JSON.stringify(Object.keys(enforcedBinding.kwargs)) : 'null'}`);
  console.log(`config keys: ${enforcedBinding.config ? JSON.stringify(Object.keys(enforcedBinding.config)) : 'null'}`);
  console.log(`config.tools count: ${Array.isArray(enforcedBinding.config?.tools) ? (enforcedBinding.config!.tools as unknown[]).length : 'N/A'}`);
  console.log(`config.tool_choice: ${JSON.stringify(enforcedBinding.config?.tool_choice)}`);
  console.log(`Has invoke override (own property): ${enforced.invoke !== Object.getPrototypeOf(enforced).invoke}`);
  console.log();

  // 6. Simulate _shouldBindTools check
  console.log('--- Simulating _shouldBindTools ---');
  const llm = enforced;

  // Step 1: isRunnableBinding?
  const step1 = RunnableBinding.isRunnableBinding(llm);
  console.log(`Step 1 - isRunnableBinding(llm): ${step1}`);
  if (!step1) {
    console.log('RESULT: _shouldBindTools returns TRUE (will re-bind, BYPASSING enforcer!)');
    process.exit(1);
  }

  // Step 2: Extract tools from kwargs or config
  const model2 = llm as unknown as {
    kwargs?: Record<string, unknown>;
    config?: Record<string, unknown>;
  };
  let boundTools: unknown[] | null = null;
  if (model2.kwargs && typeof model2.kwargs === 'object' && 'tools' in model2.kwargs && Array.isArray(model2.kwargs.tools)) {
    boundTools = model2.kwargs.tools;
    console.log(`Step 2 - Found tools in kwargs: ${boundTools!.length}`);
  } else if (model2.config && typeof model2.config === 'object' && 'tools' in model2.config && Array.isArray(model2.config.tools)) {
    boundTools = model2.config.tools;
    console.log(`Step 2 - Found tools in config (fallback): ${boundTools!.length}`);
  } else {
    console.log('Step 2 - No tools found in kwargs or config!');
    console.log('RESULT: _shouldBindTools returns TRUE (will re-bind, BYPASSING enforcer!)');
    process.exit(1);
  }

  // Step 3: Compare lengths
  if (tools.length !== boundTools!.length) {
    console.log(`Step 3 - LENGTH MISMATCH: tools=${tools.length}, boundTools=${boundTools!.length}`);
    console.log('RESULT: _shouldBindTools would THROW an error!');
    process.exit(1);
  }
  console.log(`Step 3 - Tool count matches: ${tools.length}`);

  // Step 4: Compare names
  const toolNames = new Set(tools.map(t => t.name));
  const boundToolNames = new Set<string>();
  for (const bt of boundTools!) {
    const btObj = bt as Record<string, unknown>;
    if ('name' in btObj && typeof btObj.name === 'string') {
      boundToolNames.add(btObj.name);
    } else if ('type' in btObj && btObj.type === 'function') {
      const fn = (btObj as { function: { name: string } }).function;
      boundToolNames.add(fn.name);
    }
  }
  const missingTools = [...toolNames].filter(n => !boundToolNames.has(n));
  if (missingTools.length > 0) {
    console.log(`Step 4 - MISSING TOOLS: ${missingTools.join(', ')}`);
    console.log(`  Tool names (passed): ${[...toolNames].join(', ')}`);
    console.log(`  Bound tool names: ${[...boundToolNames].join(', ')}`);
    console.log('RESULT: _shouldBindTools would THROW an error!');
    process.exit(1);
  }
  console.log(`Step 4 - All tool names match: ${[...toolNames].join(', ')}`);

  console.log('\n✅ RESULT: _shouldBindTools returns FALSE — enforcer will NOT be re-bound');
  console.log('   createReactAgent will use the enforced model as-is');
  console.log('\n=== Diagnostic Complete ===');
}

main().catch(err => {
  console.error('Diagnostic failed:', err);
  process.exit(1);
});
