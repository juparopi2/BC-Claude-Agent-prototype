#!/usr/bin/env ts-node

import { io, Socket } from 'socket.io-client';

interface TestResult {
  name: string;
  query: string;
  status: 'PASS' | 'FAIL';
  responseTime: number;
  errorMessage?: string;
  hasStreaming?: boolean;
  hasToolUse?: boolean;
}

const results: TestResult[] = [];

async function runTest(
  socket: Socket,
  testName: string,
  query: string,
  timeoutMs: number = 30000
): Promise<TestResult> {
  const startTime = Date.now();
  let hasStreaming = false;
  let hasToolUse = false;
  let errorMessage: string | undefined;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({
        name: testName,
        query,
        status: 'FAIL',
        responseTime: Date.now() - startTime,
        errorMessage: 'Timeout exceeded',
      });
    }, timeoutMs);

    // Listen for streaming chunks
    socket.on('agent:message_chunk', () => {
      hasStreaming = true;
    });

    // Listen for tool use
    socket.on('agent:tool_use', () => {
      hasToolUse = true;
    });

    // Listen for completion (DirectAgentService emits 'complete', not 'message')
    socket.on('agent:complete', () => {
      clearTimeout(timeout);
      resolve({
        name: testName,
        query,
        status: 'PASS',
        responseTime: Date.now() - startTime,
        hasStreaming,
        hasToolUse,
      });
    });

    // Listen for errors
    socket.on('error', (err: Error) => {
      clearTimeout(timeout);
      errorMessage = err.message;
      resolve({
        name: testName,
        query,
        status: 'FAIL',
        responseTime: Date.now() - startTime,
        errorMessage,
      });
    });

    // Send the test query
    socket.emit('chat:message', {
      sessionId: 'test-session-' + Date.now(),
      message: query,
    });
  });
}

async function main() {
  console.log('\n🧪 E2E Testing Suite: Read-Only Operations\n');
  console.log('='.repeat(60));

  // Connect to backend
  const socket = io('http://localhost:3001', {
    transports: ['websocket'],
    reconnection: false,
  });

  await new Promise<void>((resolve) => {
    socket.on('connect', () => {
      console.log('✅ Connected to backend (Socket ID: ' + socket.id + ')\n');
      resolve();
    });
  });

  // Test 1: List all entities
  console.log('Test 1/6: List all entities...');
  const test1 = await runTest(
    socket,
    'List All Entities',
    'List all available Business Central entities'
  );
  results.push(test1);
  console.log(`  ${test1.status} (${test1.responseTime}ms)`);
  console.log('');

  // Wait a bit between tests
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Test 2: Search for customer operations
  console.log('Test 2/6: Search customer operations...');
  const test2 = await runTest(
    socket,
    'Search Operations',
    'Search for operations related to customers'
  );
  results.push(test2);
  console.log(`  ${test2.status} (${test2.responseTime}ms)`);
  console.log('');

  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Test 3: Get entity details
  console.log('Test 3/6: Get entity details...');
  const test3 = await runTest(
    socket,
    'Get Entity Details',
    'Get details about the customer entity'
  );
  results.push(test3);
  console.log(`  ${test3.status} (${test3.responseTime}ms)`);
  console.log('');

  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Test 4: Get relationships
  console.log('Test 4/6: Get entity relationships...');
  const test4 = await runTest(
    socket,
    'Get Relationships',
    'What are the relationships between customers and sales invoices?'
  );
  results.push(test4);
  console.log(`  ${test4.status} (${test4.responseTime}ms)`);
  console.log('');

  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Test 5: Validate workflow
  console.log('Test 5/6: Validate workflow...');
  const test5 = await runTest(
    socket,
    'Validate Workflow',
    'Validate a workflow for creating a sales order'
  );
  results.push(test5);
  console.log(`  ${test5.status} (${test5.responseTime}ms)`);
  console.log('');

  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Test 6: Multi-turn conversation
  console.log('Test 6/6: Multi-turn conversation...');
  const test6a = await runTest(
    socket,
    'Multi-turn Part 1',
    'Tell me about the item entity'
  );
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const test6b = await runTest(
    socket,
    'Multi-turn Part 2',
    'What operations can I perform on items?'
  );
  results.push(test6a);
  results.push(test6b);
  console.log(`  Part 1: ${test6a.status} (${test6a.responseTime}ms)`);
  console.log(`  Part 2: ${test6b.status} (${test6b.responseTime}ms)`);
  console.log('');

  // Disconnect
  socket.disconnect();

  // Print summary
  console.log('='.repeat(60));
  console.log('\n📊 Test Results Summary\n');

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const avgResponseTime =
    results.reduce((sum, r) => sum + r.responseTime, 0) / results.length;

  console.log(`Total Tests: ${results.length}`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ${failed > 0 ? '❌' : ''}`);
  console.log(`Average Response Time: ${avgResponseTime.toFixed(0)}ms`);
  console.log('');

  // Detailed results
  console.log('Detailed Results:');
  console.log('-'.repeat(60));
  results.forEach((result) => {
    const icon = result.status === 'PASS' ? '✅' : '❌';
    console.log(`${icon} ${result.name}`);
    console.log(`   Query: "${result.query}"`);
    console.log(`   Time: ${result.responseTime}ms`);
    if (result.hasStreaming) console.log(`   Streaming: YES`);
    if (result.hasToolUse) console.log(`   Tool Use: YES`);
    if (result.errorMessage) console.log(`   Error: ${result.errorMessage}`);
    console.log('');
  });

  // Performance assessment
  console.log('Performance Assessment:');
  console.log('-'.repeat(60));
  if (avgResponseTime < 3000) {
    console.log('✅ EXCELLENT: Avg response time < 3s (target met)');
  } else if (avgResponseTime < 5000) {
    console.log('⚠️  ACCEPTABLE: Avg response time 3-5s');
  } else {
    console.log('❌ POOR: Avg response time > 5s (needs optimization)');
  }
  console.log('');

  // Exit code based on results
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('❌ Test suite failed:', error);
  process.exit(1);
});
