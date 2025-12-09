// Manual test to verify rule works on our actual test file

const { RuleTester } = require('eslint');
const rule = require('../no-sql-null-comparison');
const fs = require('fs');
const path = require('path');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    sourceType: 'module'
  },
});

// Read the test file
const testFilePath = path.join(__dirname, '../../src/test-sql-null-pattern.js');
const testFileContent = fs.readFileSync(testFilePath, 'utf8');

console.log('Testing against actual test file content...\n');

try {
  ruleTester.run('no-sql-null-comparison', rule, {
    valid: [],
    invalid: [
      {
        code: testFileContent,
        errors: [{ messageId: 'sqlNullComparison' }],
      },
    ],
  });
  console.log('✓ Rule correctly detects anti-pattern in test file!');
} catch (error) {
  console.error('✗ Rule did not detect anti-pattern:');
  console.error(error.message);
}
