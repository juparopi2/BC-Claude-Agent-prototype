/**
 * Test Script: Chat Flow
 *
 * Tests basic chat message flow with agent response streaming.
 *
 * Usage:
 *   npx ts-node scripts/test-chat-flow.ts
 */

import { io as ioClient, Socket } from 'socket.io-client';

const SERVER_URL = 'http://localhost:3001';
const TEST_SESSION_ID = `test-session-${Date.now()}`;
const TEST_USER_ID = 'test-user';

async function testChatFlow(): Promise<void> {
  console.log('💬 Testing chat flow...\n');

  const socket: Socket = ioClient(SERVER_URL, {
    transports: ['websocket', 'polling'],
  });

  socket.on('connect', () => {
    console.log('✅ Connected to server');
    console.log(`   Socket ID: ${socket.id}`);
    console.log('');

    // Send a simple message
    console.log('📤 Sending message: "Hello, what can you do?"');
    socket.emit('chat:message', {
      message: 'Hello, what can you do?',
      sessionId: TEST_SESSION_ID,
      userId: TEST_USER_ID,
    });
  });

  // Listen for agent events
  socket.on('agent:thinking', (_data: unknown) => {
    console.log('🤔 Agent is thinking...');
  });

  socket.on('agent:message_chunk', (data: { content: string }) => {
    process.stdout.write(data.content);
  });

  socket.on('agent:message_complete', (data: { role: string; content: string }) => {
    console.log('\n');
    console.log('✅ Agent response complete');
    console.log(`   Role: ${data.role}`);
    console.log(`   Content: ${data.content}`);
    console.log('');
  });

  socket.on('agent:complete', (data: { reason: string }) => {
    console.log('✅ Agent execution completed');
    console.log(`   Reason: ${data.reason}`);
    console.log('');
    console.log('✅ Test completed successfully');

    // Disconnect
    setTimeout(() => {
      socket.disconnect();
      process.exit(0);
    }, 1000);
  });

  socket.on('agent:error', (data: { error: string }) => {
    console.error('❌ Agent error:', data.error);
    socket.disconnect();
    process.exit(1);
  });

  socket.on('connect_error', (error: Error) => {
    console.error('❌ Connection error:', error.message);
    process.exit(1);
  });

  // Timeout after 30 seconds
  setTimeout(() => {
    console.log('⏰ Test timeout - taking too long');
    socket.disconnect();
    process.exit(1);
  }, 30000);
}

// Run test
testChatFlow().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
