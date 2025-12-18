/**
 * E2E Test Prerequisites Script
 *
 * Verifies and prepares the environment for E2E tests:
 * 1. Kills processes on test ports (3099, 3001) to prevent EADDRINUSE
 * 2. Verifies Redis is available on port 6399
 * 3. Attempts to start Docker Redis if not available
 * 4. Reports status summary
 *
 * Run: node scripts/e2e-prerequisites.js
 * Or automatically via: npm run test:e2e
 */

const { execSync, spawn } = require('child_process');
const net = require('net');

// Configuration
const TEST_PORTS = [3099, 3001];
const REDIS_PORT = 6399;
const REDIS_CONTAINER_NAME = 'redis-e2e-test';

// ANSI colors for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

function log(color, symbol, message) {
  console.log(`${colors[color]}${symbol}${colors.reset} ${message}`);
}

function logHeader(message) {
  console.log(`\n${colors.bold}${colors.blue}${message}${colors.reset}\n`);
}

/**
 * Kill process on a specific port (Windows)
 */
function killProcessOnPort(port) {
  try {
    const result = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const lines = result.trim().split('\n');
    const pids = new Set();

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && !isNaN(parseInt(pid, 10))) {
        pids.add(pid);
      }
    }

    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid}`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe']
        });
        log('green', '✓', `Killed process ${pid} on port ${port}`);
      } catch (killError) {
        if (!killError.message.includes('not found')) {
          log('yellow', '~', `Process ${pid} already terminated`);
        }
      }
    }

    if (pids.size === 0) {
      log('green', '✓', `Port ${port} is free`);
    }
    return true;
  } catch (error) {
    log('green', '✓', `Port ${port} is free`);
    return true;
  }
}

/**
 * Check if a port is available by attempting to connect
 */
function checkPort(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);

    socket.on('connect', () => {
      socket.destroy();
      resolve(true); // Port is in use (something is listening)
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false); // Port not responding
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false); // Port not in use
    });

    socket.connect(port, 'localhost');
  });
}

/**
 * Check if Redis is available on the test port
 */
async function checkRedis() {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);

    socket.on('connect', () => {
      // Send PING command to verify it's actually Redis
      socket.write('*1\r\n$4\r\nPING\r\n');

      socket.once('data', (data) => {
        socket.destroy();
        const response = data.toString();
        resolve(response.includes('PONG'));
      });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(REDIS_PORT, 'localhost');
  });
}

/**
 * Check if Docker is available
 */
function isDockerAvailable() {
  try {
    execSync('docker --version', { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Start Redis Docker container
 */
function startRedisDocker() {
  try {
    // Check if container already exists
    try {
      const result = execSync(`docker ps -a --filter "name=${REDIS_CONTAINER_NAME}" --format "{{.Names}}"`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      if (result.trim() === REDIS_CONTAINER_NAME) {
        // Container exists, try to start it
        execSync(`docker start ${REDIS_CONTAINER_NAME}`, {
          stdio: ['pipe', 'pipe', 'pipe']
        });
        log('green', '✓', `Started existing Redis container: ${REDIS_CONTAINER_NAME}`);
        return true;
      }
    } catch {
      // Container doesn't exist, create it
    }

    // Create and start new container
    execSync(
      `docker run -d --name ${REDIS_CONTAINER_NAME} -p ${REDIS_PORT}:6379 redis:7-alpine`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    log('green', '✓', `Created and started Redis container: ${REDIS_CONTAINER_NAME}`);
    return true;
  } catch (error) {
    log('red', '✗', `Failed to start Redis Docker: ${error.message}`);
    return false;
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('\n' + '═'.repeat(60));
  logHeader('🔧 E2E Test Prerequisites Check');
  console.log('═'.repeat(60));

  const results = {
    portsCleared: true,
    redisAvailable: false,
  };

  // Step 1: Clear test ports
  logHeader('Step 1: Clearing test ports...');
  for (const port of TEST_PORTS) {
    const success = killProcessOnPort(port);
    if (!success) results.portsCleared = false;
  }

  // Step 2: Check Redis
  logHeader('Step 2: Checking Redis availability...');
  let redisAvailable = await checkRedis();

  if (redisAvailable) {
    log('green', '✓', `Redis is running on port ${REDIS_PORT}`);
    results.redisAvailable = true;
  } else {
    log('yellow', '!', `Redis not available on port ${REDIS_PORT}`);

    // Try to start Redis via Docker
    if (isDockerAvailable()) {
      log('blue', '→', 'Attempting to start Redis via Docker...');
      const started = startRedisDocker();

      if (started) {
        // Wait a moment for Redis to be ready
        await new Promise(resolve => setTimeout(resolve, 2000));
        redisAvailable = await checkRedis();

        if (redisAvailable) {
          log('green', '✓', `Redis is now running on port ${REDIS_PORT}`);
          results.redisAvailable = true;
        } else {
          log('red', '✗', 'Redis container started but not responding');
        }
      }
    } else {
      log('yellow', '!', 'Docker not available - cannot auto-start Redis');
      log('blue', '→', `Manual start: docker run -d --name ${REDIS_CONTAINER_NAME} -p ${REDIS_PORT}:6379 redis:7-alpine`);
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  logHeader('📋 Prerequisites Summary');
  console.log('═'.repeat(60));

  log(results.portsCleared ? 'green' : 'red',
      results.portsCleared ? '✓' : '✗',
      `Test ports (${TEST_PORTS.join(', ')}): ${results.portsCleared ? 'CLEAR' : 'BLOCKED'}`);

  log(results.redisAvailable ? 'green' : 'yellow',
      results.redisAvailable ? '✓' : '!',
      `Redis (port ${REDIS_PORT}): ${results.redisAvailable ? 'AVAILABLE' : 'NOT AVAILABLE'}`);

  console.log('\n' + '─'.repeat(60));

  // Exit code
  if (!results.redisAvailable) {
    log('yellow', '⚠', 'Some tests may be skipped due to missing Redis');
    log('blue', '→', 'E2E tests will still run with available services');
    console.log('');
    process.exit(0); // Don't fail - tests can skip Redis-dependent parts
  }

  if (results.portsCleared && results.redisAvailable) {
    log('green', '✓', 'All prerequisites satisfied! Ready to run E2E tests.');
    console.log('');
    process.exit(0);
  } else {
    log('red', '✗', 'Some prerequisites not met. Check errors above.');
    console.log('');
    process.exit(1);
  }
}

// Run
main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
