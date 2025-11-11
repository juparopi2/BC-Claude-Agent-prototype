/**
 * Test Script: Simple Query - Minimal Configuration
 *
 * Tests the absolute minimum SDK configuration to isolate ProcessTransport error.
 * NO agents, NO hooks, NO complex options.
 *
 * Usage:
 *   npx ts-node scripts/test-simple-query.ts
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function testSimpleQuery(): Promise<void> {
  console.log('🧪 Testing SIMPLE query (no agents, no hooks)...\n');

  try {
    // MINIMAL configuration - just import the in-process MCP server
    const { bcMCPServer } = await import('../src/services/mcp/SDKMCPServer');

    console.log('✅ MCP Server imported successfully');
    console.log('✅ ANTHROPIC_API_KEY set:', process.env.ANTHROPIC_API_KEY ? 'YES' : 'NO');
    console.log('');

    // SIMPLEST possible query - no agents, no hooks, no extra options
    const response = query({
      prompt: 'Hello! Can you list the tools available to you?',
      options: {
        mcpServers: {
          'bc-mcp': bcMCPServer
        },
        model: 'claude-sonnet-4-5-20250929'
      }
    });

    console.log('✅ Query started, waiting for response...\n');

    let messageCount = 0;
    for await (const message of response) {
      messageCount++;
      console.log(`[Message ${messageCount}] Type: ${message.type}`);

      switch (message.type) {
        case 'system':
          if (message.subtype === 'init') {
            console.log(`   Session ID: ${message.session_id}`);
          }
          break;

        case 'assistant':
          if (typeof message.content === 'string') {
            console.log(`   Content: ${message.content.substring(0, 200)}...`);
          }
          break;

        case 'tool_call':
          console.log(`   Tool: ${message.tool_name}`);
          break;

        case 'tool_result':
          console.log(`   Result received`);
          break;

        case 'error':
          console.error(`   ❌ Error: ${message.error}`);
          break;
      }
    }

    console.log('\n✅ Test completed successfully!');
    console.log(`   Total messages: ${messageCount}`);
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Test failed:');
    console.error(error);

    if (error instanceof Error) {
      console.error('\nStack trace:');
      console.error(error.stack);

      if (error.message.includes('ProcessTransport')) {
        console.error('\n⚠️  CRITICAL: ProcessTransport error detected!');
        console.error('This is the known SDK bug - even simple queries trigger it.');
      }
    }

    process.exit(1);
  }
}

// Run test
testSimpleQuery();
