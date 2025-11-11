/**
 * Test Script: WebSocket End-to-End
 *
 * Tests the complete flow:
 * 1. WebSocket connection
 * 2. Send chat message
 * 3. Receive streaming events from DirectAgentService
 * 4. Verify response
 *
 * Usage:
 *   npm install socket.io-client (if not installed)
 *   npx ts-node scripts/test-websocket.ts
 */

import { io, Socket } from 'socket.io-client';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';
const TEST_USER_ID = 'test-user-ws';
const TEST_SESSION_ID = 'test-session-ws-' + Date.now();

interface ChatMessageData {
  message: string;
  sessionId: string;
  userId: string;
}

async function testWebSocket(): Promise<void> {
  console.log('🧪 Testing WebSocket End-to-End...\\n');
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

  // Connection event
  socket.on('connect', () => {
    console.log(`✅ Connected to WebSocket: ${socket.id}\\n`);

    // Join session
    console.log(`📥 Joining session: ${TEST_SESSION_ID}`);
    socket.emit('session:join', { sessionId: TEST_SESSION_ID });
  });

  // Session joined event
  socket.on('session:joined', (data: { sessionId: string }) => {
    console.log(`✅ Joined session: ${data.sessionId}\\n`);

    // Send chat message
    const testMessage = 'Lista todas las entidades disponibles en Business Central';
    console.log(`💬 Sending chat message: "${testMessage}"\\n`);

    const chatData: ChatMessageData = {
      message: testMessage,
      sessionId: TEST_SESSION_ID,
      userId: TEST_USER_ID,
    };

    socket.emit('chat:message', chatData);
  });

  // Agent events
  let eventCount = 0;
  let thinkingReceived = false;
  let toolUseReceived = false;
  let toolResultReceived = false;
  let messageChunkReceived = false;
  let completeReceived = false;

  socket.on('agent:thinking', (data: { content?: string }) => {
    eventCount++;
    thinkingReceived = true;
    console.log(`[Event ${eventCount}] agent:thinking`);
    if (data.content) {
      console.log(`   Content: ${data.content.substring(0, 100)}...`);
    }
  });

  socket.on('agent:tool_use', (data: { toolName: string; args: unknown }) => {
    eventCount++;
    toolUseReceived = true;
    console.log(`[Event ${eventCount}] agent:tool_use`);
    console.log(`   Tool: ${data.toolName}`);
    if (data.args) {
      const argsStr = JSON.stringify(data.args);
      console.log(`   Args: ${argsStr.substring(0, 100)}${argsStr.length > 100 ? '...' : ''}`);
    }
  });

  socket.on('agent:tool_result', (resultData: { toolName: string; success: boolean; result: unknown }) => {
    eventCount++;
    toolResultReceived = true;
    console.log(`[Event ${eventCount}] agent:tool_result`);
    console.log(`   Tool: ${resultData.toolName}`);
    console.log(`   Success: ${resultData.success}`);
    if (resultData.result && typeof resultData.result === 'string') {
      console.log(`   Result length: ${resultData.result.length} chars`);
    }
  });

  socket.on('agent:message_chunk', (_data: { content: string }) => {
    if (!messageChunkReceived) {
      eventCount++;
      messageChunkReceived = true;
      console.log(`[Event ${eventCount}] agent:message_chunk (streaming...)`);
    }
    process.stdout.write('.');
  });

  socket.on('agent:complete', (data: { reason: string }) => {
    eventCount++;
    completeReceived = true;
    console.log('\\n');
    console.log(`[Event ${eventCount}] agent:complete`);
    console.log(`   Reason: ${data.reason}\\n`);

    // Print summary
    console.log('='.repeat(80));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(80));
    console.log('');
    console.log(`Total Events: ${eventCount}`);
    console.log(`Thinking Event: ${thinkingReceived ? '✅' : '❌'}`);
    console.log(`Tool Use Event: ${toolUseReceived ? '✅' : '❌'}`);
    console.log(`Tool Result Event: ${toolResultReceived ? '✅' : '❌'}`);
    console.log(`Message Chunk Event: ${messageChunkReceived ? '✅' : '❌'}`);
    console.log(`Complete Event: ${completeReceived ? '✅' : '❌'}`);
    console.log('');

    const allEventsReceived =
      thinkingReceived &&
      toolUseReceived &&
      toolResultReceived &&
      messageChunkReceived &&
      completeReceived;

    if (allEventsReceived) {
      console.log('✅ All expected events received!');
      console.log('✅ WebSocket End-to-End Test PASSED!');
      console.log('✅ DirectAgentService is working via WebSocket!');
    } else {
      console.log('⚠️  Some events were not received.');
      console.log('❌ Test incomplete.');
    }

    console.log('');
    socket.disconnect();
    process.exit(allEventsReceived ? 0 : 1);
  });

  socket.on('agent:error', (data: { error: string }) => {
    console.error('\\n❌ Agent Error:', data.error);
    socket.disconnect();
    process.exit(1);
  });

  // Connection error
  socket.on('connect_error', (error: Error) => {
    console.error('\\n❌ Connection Error:', error.message);
    process.exit(1);
  });

  // Disconnect
  socket.on('disconnect', (reason: string) => {
    console.log(`\\n🔌 Disconnected: ${reason}`);
  });

  // Timeout
  setTimeout(() => {
    console.error('\\n⏰ Test timeout (120s)');
    console.error('❌ Test failed: No response received');
    socket.disconnect();
    process.exit(1);
  }, 120000); // 2 minutes
}

// Run test
testWebSocket();
