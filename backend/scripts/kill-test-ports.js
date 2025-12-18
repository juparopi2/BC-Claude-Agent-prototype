/**
 * Kill processes using E2E test ports before running tests.
 * This prevents EADDRINUSE errors when re-running tests.
 *
 * Ports killed:
 * - 3099: E2E test server
 * - 3001: Alternative test server port
 */

const { execSync } = require('child_process');

const TEST_PORTS = [3099, 3001];

function killProcessOnPort(port) {
  try {
    // Get PID using netstat (Windows)
    const result = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Parse PIDs from netstat output
    const lines = result.trim().split('\n');
    const pids = new Set();

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && !isNaN(parseInt(pid, 10))) {
        pids.add(pid);
      }
    }

    // Kill each PID
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid}`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe']
        });
        console.log(`✓ Killed process ${pid} on port ${port}`);
      } catch (killError) {
        // Process may have already exited
        if (!killError.message.includes('not found')) {
          console.log(`  Process ${pid} already terminated`);
        }
      }
    }

    if (pids.size === 0) {
      console.log(`✓ Port ${port} is free`);
    }
  } catch (error) {
    // No process found on port (expected case)
    console.log(`✓ Port ${port} is free`);
  }
}

console.log('🔪 Killing processes on test ports...\n');

for (const port of TEST_PORTS) {
  killProcessOnPort(port);
}

console.log('\n✅ Test ports cleared\n');
