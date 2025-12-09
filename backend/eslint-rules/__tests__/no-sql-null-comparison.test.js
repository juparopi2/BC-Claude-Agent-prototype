const { RuleTester } = require('eslint');
const rule = require('../no-sql-null-comparison');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    sourceType: 'module'
  },
});

ruleTester.run('no-sql-null-comparison', rule, {
  valid: [
    // Using QueryBuilder (safe)
    {
      code: `
        const { whereClause, params } = createWhereClause()
          .addNullableCondition('parent_folder_id', folderId)
          .build();
      `,
    },

    // Correct IS NULL handling
    {
      code: `
        if (folderId === null) {
          whereClause += ' AND parent_folder_id IS NULL';
        } else {
          whereClause += ' AND parent_folder_id = @parent_folder_id';
          params.parent_folder_id = folderId;
        }
      `,
    },

    // Parameter without || null
    {
      code: `
        whereClause += ' AND parent_folder_id = @parent_folder_id';
        params.parent_folder_id = folderId;
      `,
    },
  ],

  invalid: [
    // Anti-pattern: params.foo = value || null
    {
      code: `
        whereClause += ' AND parent_folder_id = @parent_folder_id';
        params.parent_folder_id = folderId || null;
      `,
      errors: [{
        messageId: 'sqlNullComparison',
        data: { param: 'parent_folder_id' },
      }],
    },

    // Anti-pattern: params.foo = null
    {
      code: `
        whereClause += ' AND status = @status';
        params.status = null;
      `,
      errors: [{
        messageId: 'sqlNullComparison',
        data: { param: 'status' },
      }],
    },

    // Anti-pattern: params.foo = value ?? null
    {
      code: `
        whereClause += ' AND created_by = @created_by';
        params.created_by = userId ?? null;
      `,
      errors: [{
        messageId: 'sqlNullComparison',
        data: { param: 'created_by' },
      }],
    },
  ],
});

console.log('All ESLint rule tests passed!');
