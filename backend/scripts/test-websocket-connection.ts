/**
 * Test Script: WebSocket Connection
 *
 * Tests basic Socket.IO connection and disconnection.
 *
 * Usage:
 *   npx ts-node scripts/test-websocket-connection.ts
 */

import { io as ioClient, Socket } from 'socket.io-client';

const SERVER_URL = 'http://localhost:3001';

async function testConnection(): Promise<void> {
  console.log('🔌 Testing WebSocket connection...\n');

  const socket: Socket = ioClient(SERVER_URL, {
    transports: ['websocket', 'polling'],
  });

  // Handle connection
  socket.on('connect', () => {
    console.log('✅ Connected to server');
    console.log(`   Socket ID: ${socket.id}`);
    console.log('');

    // Disconnect after 2 seconds
    setTimeout(() => {
      console.log('👋 Disconnecting...');
      socket.disconnect();
    }, 2000);
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('❌ Disconnected from server');
    console.log('');
    console.log('✅ Test completed successfully');
    process.exit(0);
  });

  // Handle connection error
  socket.on('connect_error', (error: Error) => {
    console.error('❌ Connection error:', error.message);
    console.log('');
    console.log('Make sure the backend server is running on port 3001');
    process.exit(1);
  });

  // Handle general errors
  socket.on('error', (error: Error) => {
    console.error('❌ Socket error:', error);
  });
}

// Run test
testConnection().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
