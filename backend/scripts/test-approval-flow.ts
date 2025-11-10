/**
 * Test Script: Approval Flow
 *
 * Tests complete approval flow for write operations.
 * Sends a create request, waits for approval request, approves it, and verifies execution.
 *
 * Usage:
 *   npx ts-node scripts/test-approval-flow.ts
 */

import { io as ioClient, Socket } from 'socket.io-client';
import crypto from 'crypto';

const SERVER_URL = 'http://localhost:3001';
const TEST_SESSION_ID = crypto.randomUUID(); // Use GUID for session ID
const TEST_USER_ID = crypto.randomUUID(); // Use GUID for user ID

async function testApprovalFlow(): Promise<void> {
  console.log('✅ Testing approval flow...\n');

  const socket: Socket = ioClient(SERVER_URL, {
    transports: ['websocket', 'polling'],
  });

  socket.on('connect', () => {
    console.log('✅ Connected to server');
    console.log(`   Socket ID: ${socket.id}`);
    console.log('');

    // Send a create customer message (requires approval)
    console.log('📤 Sending message: "Create a customer named Acme Corp"');
    socket.emit('chat:message', {
      message: 'Create a customer named Acme Corp with email acme@example.com',
      sessionId: TEST_SESSION_ID,
      userId: TEST_USER_ID,
    });
  });

  // Listen for approval request
  socket.on('approval:requested', (data: { approvalId: string; toolName: string; summary: { title: string }; priority: string }) => {
    console.log('');
    console.log('📋 Approval requested:');
    console.log(`   Approval ID: ${data.approvalId}`);
    console.log(`   Tool: ${data.toolName}`);
    console.log(`   Summary: ${data.summary.title}`);
    console.log(`   Priority: ${data.priority}`);
    console.log('');

    // Approve after 2 seconds
    setTimeout(() => {
      console.log('✅ Approving operation...');
      socket.emit('approval:response', {
        approvalId: data.approvalId,
        decision: 'approved',
        userId: TEST_USER_ID,
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

  // Listen for tool use
  socket.on('agent:tool_use', (data: { toolName: string }) => {
    console.log('🔧 Tool being called:');
    console.log(`   Tool: ${data.toolName}`);
    console.log('');
  });

  // Listen for tool result
  socket.on('agent:tool_result', (data: { toolName: string; success: boolean }) => {
    console.log('✅ Tool execution completed');
    console.log(`   Tool: ${data.toolName}`);
    console.log(`   Success: ${data.success}`);
    console.log('');
  });

  // Listen for agent completion
  socket.on('agent:complete', (_data: unknown) => {
    console.log('✅ Agent execution completed');
    console.log('');
    console.log('✅ Approval flow test completed successfully');

    // Disconnect
    setTimeout(() => {
      socket.disconnect();
      process.exit(0);
    }, 1000);
  });

  // Error handlers
  socket.on('agent:error', (data: { error: string }) => {
    console.error('❌ Agent error:', data.error);
    socket.disconnect();
    process.exit(1);
  });

  socket.on('approval:error', (data: { error: string }) => {
    console.error('❌ Approval error:', data.error);
    socket.disconnect();
    process.exit(1);
  });

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
testApprovalFlow().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
