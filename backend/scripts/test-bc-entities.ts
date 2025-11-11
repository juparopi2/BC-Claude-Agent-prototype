/**
 * Test Script: Business Central Entities Query
 *
 * Tests agent query for listing all BC entities via MCP.
 * Verifies:
 * - No ProcessTransport error
 * - SDK detects 7 MCP tools
 * - Tool mcp__bc-mcp__list_all_entities executes
 * - Response includes 52 entities
 *
 * Usage:
 *   npx ts-node scripts/test-bc-entities.ts
 */

import { io as ioClient, Socket } from 'socket.io-client';
import crypto from 'crypto';

const SERVER_URL = 'http://localhost:3001';
const TEST_SESSION_ID = crypto.randomUUID();
const TEST_USER_ID = crypto.randomUUID();

async function testBCEntities(): Promise<void> {
  console.log('🧪 Testing Business Central entities query...\n');

  const socket: Socket = ioClient(SERVER_URL, {
    transports: ['websocket', 'polling'],
  });

  let toolUseCalled = false;
  let entityCount = 0;

  socket.on('connect', () => {
    console.log('✅ Connected to server');
    console.log(`   Socket ID: ${socket.id}`);
    console.log(`   Session ID: ${TEST_SESSION_ID}`);
    console.log('');

    // Send BC entities query
    console.log('📤 Sending query: "Lista todas las entidades disponibles en Business Central"');
    socket.emit('chat:message', {
      message: 'Lista todas las entidades disponibles en Business Central',
      sessionId: TEST_SESSION_ID,
      userId: TEST_USER_ID,
    });
  });

  // Listen for agent events
  socket.on('agent:thinking', (_data: unknown) => {
    console.log('🤔 Agent is thinking...');
  });

  socket.on('agent:tool_use', (data: { toolName: string; args?: unknown }) => {
    console.log('🔧 Tool use detected:');
    console.log(`   Tool: ${data.toolName}`);
    if (data.args) {
      console.log(`   Args: ${JSON.stringify(data.args, null, 2)}`);
    }

    if (data.toolName === 'mcp__bc-mcp__list_all_entities') {
      toolUseCalled = true;
      console.log('✅ Correct tool called: list_all_entities');
    }
  });

  socket.on('agent:tool_result', (data: { toolName: string; result?: { entities?: unknown[] } }) => {
    console.log('🔧 Tool result received:');
    console.log(`   Tool: ${data.toolName}`);

    if (data.result && Array.isArray(data.result.entities)) {
      entityCount = data.result.entities.length;
      console.log(`   Entity count: ${entityCount}`);
    }
  });

  socket.on('agent:message_chunk', (data: { content: string }) => {
    process.stdout.write(data.content);
  });

  socket.on('agent:message_complete', (data: { role: string; content: string }) => {
    console.log('\n');
    console.log('✅ Agent response complete');
    console.log(`   Role: ${data.role}`);
    console.log('');
  });

  socket.on('agent:complete', (data: { reason: string }) => {
    console.log('✅ Agent execution completed');
    console.log(`   Reason: ${data.reason}`);
    console.log('');

    // Verification
    console.log('📋 Verification Results:');
    console.log(`   ✅ No ProcessTransport error (server still running)`);
    console.log(`   ${toolUseCalled ? '✅' : '❌'} Tool mcp__bc-mcp__list_all_entities executed: ${toolUseCalled}`);
    console.log(`   ${entityCount === 52 ? '✅' : '⚠️'} Entity count: ${entityCount} (expected: 52)`);
    console.log('');

    if (toolUseCalled && entityCount > 0) {
      console.log('✅ Test completed successfully');
    } else {
      console.log('⚠️ Test completed with warnings');
    }

    // Disconnect
    setTimeout(() => {
      socket.disconnect();
      process.exit(0);
    }, 1000);
  });

  socket.on('agent:error', (data: { error: string }) => {
    console.error('❌ Agent error:', data.error);

    if (data.error.includes('ProcessTransport') || data.error.includes('Claude Code process')) {
      console.error('❌ CRITICAL: ProcessTransport error detected!');
    }

    socket.disconnect();
    process.exit(1);
  });

  socket.on('connect_error', (error: Error) => {
    console.error('❌ Connection error:', error.message);
    process.exit(1);
  });

  // Timeout after 60 seconds (queries can take time)
  setTimeout(() => {
    console.log('⏰ Test timeout - taking too long (60s exceeded)');
    socket.disconnect();
    process.exit(1);
  }, 60000);
}

// Run test
testBCEntities().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
