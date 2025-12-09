import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const noSqlNullComparison = require('./eslint-rules/no-sql-null-comparison.js');

// Create custom plugin object
const customPlugin = {
  rules: {
    'no-sql-null-comparison': noSqlNullComparison,
  },
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '*.config.js',
      'src/__tests__/**',  // Ignore test files (excluded from tsconfig)
    ],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: join(__dirname, 'tsconfig.json'),
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'custom': customPlugin,
    },
    rules: {
      // TypeScript specific rules
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // Custom rules - Database safety
      'custom/no-sql-null-comparison': 'error',

      // General rules
      'no-console': 'off', // We use console for logging in backend
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
];
