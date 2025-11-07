/**
 * Test Script: Todo Tracking
 *
 * Tests automatic todo list generation and real-time tracking.
 * Sends a multi-step request and verifies todos are created and updated.
 *
 * Usage:
 *   npx ts-node scripts/test-todo-tracking.ts
 */

import { io as ioClient, Socket } from 'socket.io-client';

const SERVER_URL = 'http://localhost:3001';
const TEST_SESSION_ID = `test-session-${Date.now()}`;
const TEST_USER_ID = 'test-user';

async function testTodoTracking(): Promise<void> {
  console.log('📝 Testing todo tracking...\n');

  const socket: Socket = ioClient(SERVER_URL, {
    transports: ['websocket', 'polling'],
  });

  let todosCreated = false;
  const todoUpdates: string[] = [];

  socket.on('connect', () => {
    console.log('✅ Connected to server');
    console.log(`   Socket ID: ${socket.id}`);
    console.log('');

    // Send a multi-step message
    console.log('📤 Sending message: "Create 3 customers: Acme Corp, Beta Inc, Gamma LLC"');
    socket.emit('chat:message', {
      message: 'Create 3 customers: Acme Corp, Beta Inc, Gamma LLC',
      sessionId: TEST_SESSION_ID,
      userId: TEST_USER_ID,
    });
  });

  // Listen for todo creation
  socket.on('todo:created', (data: { sessionId: string; todos: Array<{ status: string; content: string }> }) => {
    console.log('');
    console.log('✅ Todos created:');
    console.log(`   Session: ${data.sessionId}`);
    console.log(`   Count: ${data.todos.length}`);

    data.todos.forEach((todo: { status: string; content: string }, idx: number) => {
      console.log(`   ${idx + 1}. [${todo.status}] ${todo.content}`);
    });

    console.log('');
    todosCreated = true;
  });

  // Listen for todo updates
  socket.on('todo:updated', (data: { todoId: string; status: string }) => {
    console.log(`📝 Todo updated: ${data.todoId} → ${data.status}`);
    todoUpdates.push(data.status);
  });

  // Listen for todo completion
  socket.on('todo:completed', (data: { todoId: string; status: string }) => {
    console.log(`✅ Todo completed: ${data.todoId} → ${data.status}`);
    todoUpdates.push(data.status);
  });

  // Listen for approval requests (expected for creates)
  socket.on('approval:requested', (data: { approvalId: string; toolName: string }) => {
    console.log('');
    console.log(`📋 Approval requested for: ${data.toolName}`);

    // Auto-approve
    setTimeout(() => {
      console.log('✅ Auto-approving...');
      socket.emit('approval:response', {
        approvalId: data.approvalId,
        decision: 'approved',
        userId: TEST_USER_ID,
      });
    }, 1000);
  });

  // Listen for agent completion
  socket.on('agent:complete', (_data: unknown) => {
    console.log('');
    console.log('✅ Agent execution completed');
    console.log('');
    console.log('📊 Test Results:');
    console.log(`   Todos created: ${todosCreated ? 'Yes' : 'No'}`);
    console.log(`   Todo updates: ${todoUpdates.length}`);

    if (todosCreated && todoUpdates.length > 0) {
      console.log('');
      console.log('✅ Todo tracking test completed successfully');
    } else {
      console.log('');
      console.error('❌ Test failed: todos not tracked properly');
    }

    // Disconnect
    setTimeout(() => {
      socket.disconnect();
      process.exit(todosCreated && todoUpdates.length > 0 ? 0 : 1);
    }, 1000);
  });

  // Error handlers
  socket.on('agent:error', (data: { error: string }) => {
    console.error('❌ Agent error:', data.error);
    socket.disconnect();
    process.exit(1);
  });

  socket.on('connect_error', (error: Error) => {
    console.error('❌ Connection error:', error.message);
    process.exit(1);
  });

  // Timeout after 2 minutes
  setTimeout(() => {
    console.log('⏰ Test timeout - taking too long');
    socket.disconnect();
    process.exit(1);
  }, 120000);
}

// Run test
testTodoTracking().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
