/**
 * Test MCP Connection Script
 *
 * Standalone script to test connectivity to the MCP server using Agent SDK.
 * Run with: npx ts-node src/services/mcp/testMCPConnection.ts
 */

import { getMCPService } from './MCPService';

/**
 * Colors for console output
 */
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
};

/**
 * Log with color
 */
function log(message: string, color: keyof typeof colors = 'reset'): void {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Main test function
 */
async function testMCPConnection(): Promise<void> {
  log('\n========================================', 'blue');
  log('  MCP Connection Test', 'blue');
  log('========================================\n', 'blue');

  try {
    // 1. Get MCP Service instance
    log('1. Initializing MCP Service...', 'yellow');
    const mcpService = getMCPService();

    if (!mcpService.isConfigured()) {
      log('❌ ERROR: MCP_SERVER_URL is not configured', 'red');
      log(
        'Please set MCP_SERVER_URL in your .env file or Key Vault',
        'yellow'
      );
      process.exit(1);
    }

    log(`✓ MCP Service initialized`, 'green');
    log(`  Server URL: ${mcpService.getMCPServerUrl()}`, 'reset');
    log(`  Server Name: ${mcpService.getMCPServerName()}`, 'reset');

    // 2. Get MCP Server Config
    log('\n2. Getting MCP Server Configuration...', 'yellow');
    const config = mcpService.getMCPServerConfig();
    log(`✓ Configuration retrieved`, 'green');
    log(`  Type: ${config.type}`, 'reset');
    log(`  URL: ${config.url}`, 'reset');
    log(`  Name: ${config.name}`, 'reset');

    // 3. Validate MCP Connection
    log('\n3. Validating MCP Connection...', 'yellow');
    const health = await mcpService.validateMCPConnection();

    if (health.connected) {
      log('✓ MCP server is reachable', 'green');
      if (health.lastConnected) {
        log(`  Last connected: ${health.lastConnected.toISOString()}`, 'reset');
      }
    } else {
      log('❌ MCP connection failed', 'red');
      log(`  Error: ${health.error}`, 'red');
      log(
        '\nTroubleshooting:',
        'yellow'
      );
      log('  1. Check MCP_SERVER_URL is correct', 'reset');
      log('  2. Check network connectivity', 'reset');
      log('  3. Check MCP server is running', 'reset');
      log('  4. Check firewall rules', 'reset');
      process.exit(1);
    }

    // 4. Summary
    log('\n========================================', 'blue');
    log('  Test Summary', 'blue');
    log('========================================\n', 'blue');
    log('✓ MCP Service initialized', 'green');
    log('✓ Configuration loaded', 'green');
    log('✓ MCP server reachable', 'green');

    log('\n📋 Next Steps:', 'yellow');
    log('  1. Integrate MCP config with Agent SDK', 'reset');
    log('  2. Test tool discovery with Agent SDK', 'reset');
    log('  3. Test tool calling (bc_query_entity)', 'reset');

    log('\n✅ All tests passed!\n', 'green');
    process.exit(0);
  } catch (error) {
    log('\n❌ Test failed with error:', 'red');
    console.error(error);
    process.exit(1);
  }
}

// Run test if this file is executed directly
if (require.main === module) {
  testMCPConnection().catch((error) => {
    log('\n❌ Unexpected error:', 'red');
    console.error(error);
    process.exit(1);
  });
}

export { testMCPConnection };
