/**
 * Quick test script to verify UUID validation in inferSqlType()
 *
 * This tests the enhanced inferSqlType() function to ensure:
 * 1. Valid UUIDs pass through successfully
 * 2. Invalid UUIDs throw descriptive errors
 * 3. Non-string values throw type errors
 */

const { executeQuery } = require('./dist/config/database');

async function testUuidValidation() {
  console.log('🧪 Testing UUID validation in inferSqlType()...\n');

  // Test 1: Valid UUID (should succeed)
  console.log('Test 1: Valid UUID parameter');
  try {
    // This won't actually execute (no DB connection), but will test parameter validation
    await executeQuery(
      'SELECT * FROM users WHERE user_id = @user_id',
      { user_id: '322a1bac-77db-4a15-b1f0-48a51604642b' }
    );
    console.log('❌ FAILED: Should have thrown "Database not connected" error\n');
  } catch (error) {
    if (error.message.includes('Database not connected')) {
      console.log('✅ PASSED: Valid UUID passed validation (DB connection error expected)\n');
    } else {
      console.log('❌ FAILED: Unexpected error:', error.message, '\n');
    }
  }

  // Test 2: Invalid UUID format (should fail with descriptive error)
  console.log('Test 2: Invalid UUID format');
  try {
    await executeQuery(
      'SELECT * FROM users WHERE user_id = @user_id',
      { user_id: 'invalid-uuid-format' }
    );
    console.log('❌ FAILED: Should have thrown UUID format error\n');
  } catch (error) {
    if (error.message.includes('Invalid UUID format')) {
      console.log('✅ PASSED: Invalid UUID rejected with message:', error.message, '\n');
    } else {
      console.log('❌ FAILED: Wrong error message:', error.message, '\n');
    }
  }

  // Test 3: Non-string UUID parameter (should fail with type error)
  console.log('Test 3: Non-string UUID parameter');
  try {
    await executeQuery(
      'SELECT * FROM users WHERE user_id = @user_id',
      { user_id: 12345 }
    );
    console.log('❌ FAILED: Should have thrown type error\n');
  } catch (error) {
    if (error.message.includes('expected string, got number')) {
      console.log('✅ PASSED: Non-string value rejected with message:', error.message, '\n');
    } else {
      console.log('❌ FAILED: Wrong error message:', error.message, '\n');
    }
  }

  // Test 4: Valid UUID in camelCase parameter name (sessionId)
  console.log('Test 4: Valid UUID with camelCase parameter (sessionId)');
  try {
    await executeQuery(
      'SELECT * FROM sessions WHERE session_id = @sessionId',
      { sessionId: '422a1bac-77db-4a15-b1f0-48a51604642b' }
    );
    console.log('❌ FAILED: Should have thrown "Database not connected" error\n');
  } catch (error) {
    if (error.message.includes('Database not connected')) {
      console.log('✅ PASSED: Valid UUID with camelCase name passed validation\n');
    } else {
      console.log('❌ FAILED: Unexpected error:', error.message, '\n');
    }
  }

  // Test 5: Partial UUID (should fail)
  console.log('Test 5: Partial UUID');
  try {
    await executeQuery(
      'SELECT * FROM users WHERE user_id = @user_id',
      { user_id: '322a1bac-77db-4a15' }
    );
    console.log('❌ FAILED: Should have thrown UUID format error\n');
  } catch (error) {
    if (error.message.includes('Invalid UUID format')) {
      console.log('✅ PASSED: Partial UUID rejected with message:', error.message, '\n');
    } else {
      console.log('❌ FAILED: Wrong error message:', error.message, '\n');
    }
  }

  // Test 6: Empty string UUID (should fail)
  console.log('Test 6: Empty string UUID');
  try {
    await executeQuery(
      'SELECT * FROM users WHERE user_id = @user_id',
      { user_id: '' }
    );
    console.log('❌ FAILED: Should have thrown UUID format error\n');
  } catch (error) {
    if (error.message.includes('Invalid UUID format')) {
      console.log('✅ PASSED: Empty string rejected with message:', error.message, '\n');
    } else {
      console.log('❌ FAILED: Wrong error message:', error.message, '\n');
    }
  }

  console.log('🎉 UUID validation tests complete!');
}

// Run tests
testUuidValidation().catch(error => {
  console.error('💥 Test script error:', error);
  process.exit(1);
});
