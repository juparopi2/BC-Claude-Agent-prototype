/**
 * Test Script: Direct Agent Service
 *
 * Tests the DirectAgentService workaround that bypasses Agent SDK bug.
 * Uses @anthropic-ai/sdk directly with manual tool calling loop.
 *
 * Usage:
 *   npx ts-node scripts/test-direct-agent.ts
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
import { DirectAgentService } from '../src/services/agent/DirectAgentService';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function testDirectAgent(): Promise<void> {
  console.log('🧪 Testing DirectAgentService (bypassing Agent SDK bug)...\n');

  try {
    // Create Direct Agent Service
    const agentService = new DirectAgentService();

    console.log('✅ DirectAgentService created');
    console.log('✅ ANTHROPIC_API_KEY loaded:', process.env.ANTHROPIC_API_KEY ? 'YES' : 'NO');
    console.log('');

    // Test query
    console.log('📤 Sending query: "Lista todas las entidades disponibles en Business Central"');
    console.log('');

    let eventCount = 0;

    const result = await agentService.executeQuery(
      'Lista todas las entidades disponibles en Business Central',
      'test-session-' + Date.now(),
      (event) => {
        eventCount++;
        console.log(`[Event ${eventCount}] ${event.type}`);

        switch (event.type) {
          case 'thinking':
            console.log('   🤔 Agent is thinking...');
            break;

          case 'tool_use':
            console.log(`   🔧 Tool: ${event.toolName}`);
            if (event.args) {
              console.log(`   Args: ${JSON.stringify(event.args, null, 2).substring(0, 200)}`);
            }
            break;

          case 'tool_result':
            console.log(`   ✅ Tool completed`);
            if (typeof event.result === 'string') {
              console.log(`   Result length: ${event.result.length} chars`);
            }
            break;

          case 'message_chunk':
            process.stdout.write('.');
            break;

          case 'complete':
            console.log('');
            console.log(`   ✅ Agent completed: ${event.reason}`);
            break;

          case 'error':
            console.error(`   ❌ Error: ${event.error}`);
            break;
        }
      }
    );

    console.log('');
    console.log('='.repeat(80));
    console.log('📊 RESULTS');
    console.log('='.repeat(80));
    console.log('');
    console.log(`Success: ${result.success}`);
    console.log(`Duration: ${result.duration}ms`);
    console.log(`Input tokens: ${result.inputTokens}`);
    console.log(`Output tokens: ${result.outputTokens}`);
    console.log(`Tools used: ${result.toolsUsed.length}`);
    if (result.toolsUsed.length > 0) {
      console.log(`Tool names: ${result.toolsUsed.join(', ')}`);
    }
    console.log('');

    if (result.success) {
      console.log('Response:');
      console.log('-'.repeat(80));
      console.log(result.response);
      console.log('-'.repeat(80));
      console.log('');
      console.log('✅ Test completed successfully!');
      console.log('✅ DirectAgentService WORKS - ProcessTransport bug BYPASSED!');
      process.exit(0);
    } else {
      console.error('❌ Query failed:', result.error);
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Test failed:');
    console.error(error);

    if (error instanceof Error) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }

    process.exit(1);
  }
}

// Run test
testDirectAgent();
