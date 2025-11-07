/**
 * Test Script: Approval Rejection
 *
 * Tests approval rejection flow for write operations.
 * Sends a create request, waits for approval request, rejects it, and verifies cancellation.
 *
 * Usage:
 *   npx ts-node scripts/test-approval-rejection.ts
 */

import { io as ioClient, Socket } from 'socket.io-client';

const SERVER_URL = 'http://localhost:3001';
const TEST_SESSION_ID = `test-session-${Date.now()}`;
const TEST_USER_ID = 'test-user';

async function testApprovalRejection(): Promise<void> {
  console.log('❌ Testing approval rejection...\n');

  const socket: Socket = ioClient(SERVER_URL, {
    transports: ['websocket', 'polling'],
  });

  socket.on('connect', () => {
    console.log('✅ Connected to server');
    console.log(`   Socket ID: ${socket.id}`);
    console.log('');

    // Send a create customer message (requires approval)
    console.log('📤 Sending message: "Create a customer named Test Corp"');
    socket.emit('chat:message', {
      message: 'Create a customer named Test Corp with email test@example.com',
      sessionId: TEST_SESSION_ID,
      userId: TEST_USER_ID,
    });
  });

  // Listen for approval request
  socket.on('approval:requested', (data: { approvalId: string; toolName: string; summary: { title: string } }) => {
    console.log('');
    console.log('📋 Approval requested:');
    console.log(`   Approval ID: ${data.approvalId}`);
    console.log(`   Tool: ${data.toolName}`);
    console.log(`   Summary: ${data.summary.title}`);
    console.log('');

    // Reject after 2 seconds
    setTimeout(() => {
      console.log('❌ Rejecting operation...');
      socket.emit('approval:response', {
        approvalId: data.approvalId,
        decision: 'rejected',
        userId: TEST_USER_ID,
        reason: 'Testing rejection flow',
      });
    }, 2000);
  });

  // Listen for approval resolution
  socket.on('approval:resolved', (data: { approvalId: string; decision: string }) => {
    console.log('✅ Approval resolved');
    console.log(`   Approval ID: ${data.approvalId}`);
    console.log(`   Decision: ${data.decision}`);
    console.log('');
  });

  // Listen for agent error (expected when rejection happens)
  socket.on('agent:error', (data: { error: string }) => {
    console.log('✅ Agent error received (expected):');
    console.log(`   Error: ${data.error}`);
    console.log('');

    if (data.error.includes('rejected') || data.error.includes('Operation rejected')) {
      console.log('✅ Approval rejection flow test completed successfully');
      console.log('   Operation was cancelled as expected');

      // Disconnect
      setTimeout(() => {
        socket.disconnect();
        process.exit(0);
      }, 1000);
    } else {
      console.error('❌ Unexpected error:', data.error);
      socket.disconnect();
      process.exit(1);
    }
  });

  // Listen for tool use (should NOT happen if rejection works)
  socket.on('agent:tool_use', (data: { toolName: string }) => {
    console.error('❌ Tool was executed despite rejection!');
    console.error(`   Tool: ${data.toolName}`);
    socket.disconnect();
    process.exit(1);
  });

  // Connection error
  socket.on('connect_error', (error: Error) => {
    console.error('❌ Connection error:', error.message);
    process.exit(1);
  });

  // Timeout after 60 seconds
  setTimeout(() => {
    console.log('⏰ Test timeout - taking too long');
    socket.disconnect();
    process.exit(1);
  }, 60000);
}

// Run test
testApprovalRejection().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
