/**
 * Test Script: New MCP Tools
 *
 * Tests the 5 newly implemented MCP tools:
 * 1. search_entity_operations
 * 2. get_entity_relationships
 * 3. validate_workflow_structure
 * 4. build_knowledge_base_workflow
 * 5. get_endpoint_documentation
 *
 * Usage:
 *   npx ts-node scripts/test-new-tools.ts
 */

import { io, Socket } from 'socket.io-client';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';
const TEST_USER_ID = 'test-user-tools';
const TEST_SESSION_ID = 'test-session-tools-' + Date.now();

interface ChatMessageData {
  message: string;
  sessionId: string;
  userId: string;
}

async function testNewTools(): Promise<void> {
  console.log('🧪 Testing New MCP Tools...\n');
  console.log(`   Backend URL: ${BACKEND_URL}`);
  console.log(`   Session ID: ${TEST_SESSION_ID}`);
  console.log(`   User ID: ${TEST_USER_ID}`);
  console.log('');

  // Connect to WebSocket
  console.log('🔌 Connecting to WebSocket...');
  const socket: Socket = io(BACKEND_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
  });

  let testNumber = 0;
  const testResults: Record<string, boolean> = {};

  // Connection event
  socket.on('connect', () => {
    console.log(`✅ Connected to WebSocket: ${socket.id}\n`);

    // Join session
    console.log(`📥 Joining session: ${TEST_SESSION_ID}`);
    socket.emit('session:join', { sessionId: TEST_SESSION_ID });
  });

  // Session joined event
  socket.on('session:joined', (data: { sessionId: string }) => {
    console.log(`✅ Joined session: ${data.sessionId}\n`);

    // Start tests
    runNextTest();
  });

  function runNextTest(): void {
    testNumber++;

    let testMessage = '';
    let expectedTool = '';

    if (testNumber === 1) {
      testMessage = 'Busca todas las operaciones relacionadas con "customer"';
      expectedTool = 'search_entity_operations';
    } else if (testNumber === 2) {
      testMessage = 'Muéstrame las relaciones de la entidad customer';
      expectedTool = 'get_entity_relationships';
    } else if (testNumber === 3) {
      testMessage = 'Dame la documentación detallada de la operación bc_list_customers';
      expectedTool = 'get_endpoint_documentation';
    } else {
      // All tests done
      printSummary();
      return;
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`🧪 TEST ${testNumber}: ${expectedTool}`);
    console.log('='.repeat(80));
    console.log(`💬 Message: "${testMessage}"\n`);

    const chatData: ChatMessageData = {
      message: testMessage,
      sessionId: TEST_SESSION_ID,
      userId: TEST_USER_ID,
    };

    currentExpectedTool = expectedTool;
    socket.emit('chat:message', chatData);
  }

  let currentExpectedTool = '';
  let currentToolUsed = false;

  // Agent events
  socket.on('agent:thinking', (_data: { content?: string }) => {
    console.log(`[Event] agent:thinking`);
  });

  socket.on('agent:tool_use', (data: { toolName: string; args: unknown }) => {
    console.log(`[Event] agent:tool_use`);
    console.log(`   Tool: ${data.toolName}`);

    if (data.toolName === currentExpectedTool) {
      currentToolUsed = true;
      console.log(`   ✅ Correct tool used!`);
    }

    if (data.args) {
      const argsStr = JSON.stringify(data.args);
      console.log(`   Args: ${argsStr.substring(0, 150)}${argsStr.length > 150 ? '...' : ''}`);
    }
  });

  socket.on('agent:tool_result', (resultData: { toolName: string; success: boolean; result: unknown }) => {
    console.log(`[Event] agent:tool_result`);
    console.log(`   Tool: ${resultData.toolName}`);
    console.log(`   Success: ${resultData.success}`);

    if (resultData.result && typeof resultData.result === 'string') {
      console.log(`   Result length: ${resultData.result.length} chars`);

      // Show first 200 chars of result
      const preview = resultData.result.substring(0, 200);
      console.log(`   Result preview:\n   ${preview}...`);
    }
  });

  socket.on('agent:message_chunk', (_data: { content: string }) => {
    process.stdout.write('.');
  });

  socket.on('agent:complete', (data: { reason: string }) => {
    console.log('\n');
    console.log(`[Event] agent:complete (${data.reason})`);

    // Record test result
    if (currentExpectedTool) {
      testResults[currentExpectedTool] = currentToolUsed;
    }

    // Reset for next test
    currentToolUsed = false;

    // Wait a bit before next test
    setTimeout(() => {
      runNextTest();
    }, 1000);
  });

  socket.on('agent:error', (data: { error: string }) => {
    console.error('\n❌ Agent Error:', data.error);
    testResults[currentExpectedTool] = false;

    // Continue to next test
    setTimeout(() => {
      runNextTest();
    }, 1000);
  });

  function printSummary(): void {
    console.log('\n');
    console.log('='.repeat(80));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(80));
    console.log('');

    let passedCount = 0;
    let totalCount = 0;

    for (const [tool, passed] of Object.entries(testResults)) {
      totalCount++;
      if (passed) {
        passedCount++;
        console.log(`✅ ${tool}: PASSED`);
      } else {
        console.log(`❌ ${tool}: FAILED`);
      }
    }

    console.log('');
    console.log(`Total: ${passedCount}/${totalCount} tests passed`);
    console.log('');

    const allPassed = passedCount === totalCount;
    if (allPassed) {
      console.log('✅ All new MCP tools are working correctly!');
    } else {
      console.log('⚠️  Some tools did not work as expected.');
    }

    console.log('');
    socket.disconnect();
    process.exit(allPassed ? 0 : 1);
  }

  // Connection error
  socket.on('connect_error', (error: Error) => {
    console.error('\n❌ Connection Error:', error.message);
    process.exit(1);
  });

  // Disconnect
  socket.on('disconnect', (reason: string) => {
    console.log(`\n🔌 Disconnected: ${reason}`);
  });

  // Timeout
  setTimeout(() => {
    console.error('\n⏰ Test timeout (120s)');
    console.error('❌ Test failed: No response received');
    socket.disconnect();
    process.exit(1);
  }, 120000); // 2 minutes
}

// Run test
testNewTools();
