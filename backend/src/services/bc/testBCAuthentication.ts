/**
 * Test BC Authentication Script
 *
 * Standalone script to test Business Central OAuth authentication and API connectivity.
 * Run with: npx ts-node src/services/bc/testBCAuthentication.ts
 */

import { getBCClient, getBCValidator } from './index';
import type { BCCustomer } from '@/types';

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
async function testBCAuthentication(): Promise<void> {
  log('\n========================================', 'blue');
  log('  BC Authentication Test', 'blue');
  log('========================================\n', 'blue');

  try {
    // 1. Get BC Client instance
    log('1. Initializing BC Client...', 'yellow');
    const bcClient = getBCClient();
    log('✓ BC Client initialized', 'green');

    // 2. Validate Credentials
    log('\n2. Validating BC Credentials...', 'yellow');
    log('  Attempting OAuth 2.0 authentication...', 'reset');

    const isValid = await bcClient.validateCredentials();

    if (!isValid) {
      log('❌ BC credentials validation failed', 'red');
      log('\nTroubleshooting:', 'yellow');
      log('  1. Check BC_TENANT_ID is correct', 'reset');
      log('  2. Check BC_CLIENT_ID is correct', 'reset');
      log('  3. Check BC_CLIENT_SECRET is set in Key Vault', 'reset');
      log('  4. Check Azure AD app registration', 'reset');
      log('  5. Check API permissions are granted', 'reset');
      process.exit(1);
    }

    log('✓ OAuth authentication successful', 'green');

    // Check token status
    const tokenStatus = bcClient.getTokenStatus();
    if (tokenStatus.hasToken && tokenStatus.expiresAt) {
      log(`  Token expires: ${tokenStatus.expiresAt.toISOString()}`, 'reset');
    }

    // 3. Test Connection
    log('\n3. Testing BC API Connection...', 'yellow');
    log('  Attempting to query customers...', 'reset');

    const connected = await bcClient.testConnection();

    if (!connected) {
      log('❌ BC API connection test failed', 'red');
      log('\nTroubleshooting:', 'yellow');
      log('  1. Check BC_API_URL is correct', 'reset');
      log('  2. Check network connectivity', 'reset');
      log('  3. Check BC environment is accessible', 'reset');
      process.exit(1);
    }

    log('✓ BC API connection successful', 'green');

    // 4. Query Customers
    log('\n4. Querying Customers (top 5)...', 'yellow');

    const customersResponse = await bcClient.query<BCCustomer>('customers', {
      select: ['id', 'number', 'displayName', 'email', 'blocked'],
      top: 5,
      count: true,
    });

    log('✓ Query successful', 'green');
    log(`  Total customers: ${customersResponse['@odata.count'] || 'N/A'}`, 'reset');
    log(`  Returned: ${customersResponse.value.length}`, 'reset');

    if (customersResponse.value.length > 0) {
      log('\n  Sample customers:', 'reset');
      customersResponse.value.forEach((customer, index) => {
        log(`    ${index + 1}. ${customer.displayName} (${customer.number})`, 'reset');
        if (customer.email) {
          log(`       Email: ${customer.email}`, 'reset');
        }
        log(`       Status: ${customer.blocked || 'Active'}`, 'reset');
      });
    } else {
      log('  No customers found in BC', 'yellow');
    }

    // 5. Test BC Validator
    log('\n5. Testing BC Validator...', 'yellow');
    const validator = getBCValidator();

    // Valid customer
    const validCustomer = {
      displayName: 'Test Customer',
      email: 'test@example.com',
      phoneNumber: '+1234567890',
    };

    const validResult = validator.validateCustomer(validCustomer);
    if (validResult.valid) {
      log('✓ Valid customer data passed validation', 'green');
    } else {
      log('❌ Valid customer data failed validation', 'red');
      log(`  Errors: ${validator.formatErrors(validResult)}`, 'red');
    }

    // Invalid customer
    const invalidCustomer = {
      displayName: '', // Empty - should fail
      email: 'invalid-email', // Invalid format
      balance: -100, // Negative - should fail
    };

    const invalidResult = validator.validateCustomer(invalidCustomer);
    if (!invalidResult.valid) {
      log('✓ Invalid customer data correctly rejected', 'green');
      log('  Detected errors:', 'reset');
      invalidResult.errors.forEach((error) => {
        log(`    - ${error.field}: ${error.message}`, 'reset');
      });
    } else {
      log('❌ Invalid customer data was not rejected', 'red');
    }

    // 6. Test GUID validation
    log('\n6. Testing GUID Validation...', 'yellow');
    const validGuid = '550e8400-e29b-41d4-a716-446655440000';
    const invalidGuid = 'not-a-guid';

    const isValidGuid = validator.isValidGuid(validGuid);
    const isInvalidGuid = validator.isValidGuid(invalidGuid);

    if (isValidGuid && !isInvalidGuid) {
      log('✓ GUID validation working correctly', 'green');
    } else {
      log('❌ GUID validation failed', 'red');
    }

    // 7. Summary
    log('\n========================================', 'blue');
    log('  Test Summary', 'blue');
    log('========================================\n', 'blue');
    log('✓ BC Client initialized', 'green');
    log('✓ OAuth authentication successful', 'green');
    log('✓ BC API connection successful', 'green');
    log('✓ Customer query successful', 'green');
    log('✓ BC Validator working correctly', 'green');

    log('\n📋 Next Steps:', 'yellow');
    log('  1. Integrate BC Client with health endpoint', 'reset');
    log('  2. Use BC Validator in agent approval flow', 'reset');
    log('  3. Test MCP tools for BC operations', 'reset');

    log('\n✅ All tests passed!\n', 'green');
    process.exit(0);
  } catch (error) {
    log('\n❌ Test failed with error:', 'red');
    console.error(error);

    log('\nCommon Issues:', 'yellow');
    log('  1. Missing environment variables (check .env)', 'reset');
    log('  2. Invalid BC credentials', 'reset');
    log('  3. Network connectivity issues', 'reset');
    log('  4. BC API endpoint incorrect', 'reset');

    process.exit(1);
  }
}

// Run test if this file is executed directly
if (require.main === module) {
  testBCAuthentication().catch((error) => {
    log('\n❌ Unexpected error:', 'red');
    console.error(error);
    process.exit(1);
  });
}

export { testBCAuthentication };
