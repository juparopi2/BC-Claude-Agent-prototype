module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Prevent SQL NULL comparison anti-pattern (column = NULL)',
      category: 'Database',
      recommended: true,
    },
    messages: {
      sqlNullComparison:
        'Possible SQL NULL comparison error: Using "= @{{param}}" with potentially null parameter. ' +
        'SQL: column = NULL always returns FALSE. ' +
        'Use QueryBuilder.addNullableCondition() or explicit IS NULL check.',
    },
    schema: [], // No options
  },

  create(context) {
    // Track: params.paramName = value || null
    const potentiallyNullParams = new Map();

    // Track: whereClause += ' AND column = @param'
    const whereClauses = [];

    return {
      // Detect assignments like: params.foo = bar || null
      AssignmentExpression(node) {
        // Check if it's assigning to params object
        if (
          node.left.type === 'MemberExpression' &&
          node.left.object.name === 'params'
        ) {
          const paramName = node.left.property.name || node.left.property.value;

          // Check if right side can be null
          if (canBeNull(node.right)) {
            potentiallyNullParams.set(paramName, node);
          }
        }

        // Check for WHERE clause concatenation
        if (
          node.operator === '+=' &&
          node.left.type === 'Identifier' &&
          (node.left.name === 'whereClause' || node.left.name.includes('where'))
        ) {
          if (node.right.type === 'Literal' && typeof node.right.value === 'string') {
            whereClauses.push({
              node,
              queryString: node.right.value,
            });
          } else if (node.right.type === 'TemplateLiteral') {
            // Handle template literals
            const queryString = node.right.quasis.map(q => q.value.raw).join('');
            whereClauses.push({
              node,
              queryString,
            });
          }
        }
      },

      // Cross-check at end of program
      'Program:exit'() {
        checkWhereClauses();
      },
    };

    function checkWhereClauses() {
      // Track already reported to avoid duplicates
      const reported = new Set();

      for (const { node, queryString } of whereClauses) {
        const paramNames = extractParamNames(queryString);

        for (const paramName of paramNames) {
          if (potentiallyNullParams.has(paramName)) {
            // Check if query uses = operator with this param
            if (usesEqualOperator(queryString, paramName) && !hasIsNullCheck(queryString)) {
              // Create unique key to avoid duplicate reports
              const key = `${node.loc.start.line}:${node.loc.start.column}:${paramName}`;

              if (!reported.has(key)) {
                context.report({
                  node,
                  messageId: 'sqlNullComparison',
                  data: { param: paramName },
                });
                reported.add(key);
              }
            }
          }
        }
      }
    }

    function canBeNull(node) {
      // Check for: value || null
      if (node.type === 'LogicalExpression' && node.operator === '||') {
        if (node.right.type === 'Literal' && node.right.value === null) {
          return true;
        }
      }

      // Check for: value ?? null
      if (node.type === 'LogicalExpression' && node.operator === '??') {
        if (node.right.type === 'Literal' && node.right.value === null) {
          return true;
        }
      }

      // Check for: null
      if (node.type === 'Literal' && node.value === null) {
        return true;
      }

      return false;
    }

    function extractParamNames(queryString) {
      const paramPattern = /@(\w+)/g;
      const matches = queryString.matchAll(paramPattern);
      const params = [];

      for (const match of matches) {
        if (match[1]) {
          params.push(match[1]);
        }
      }

      return params;
    }

    function usesEqualOperator(queryString, paramName) {
      const pattern = new RegExp(`=\\s*@${paramName}\\b`, 'i');
      return pattern.test(queryString);
    }

    function hasIsNullCheck(queryString) {
      return /IS\s+NULL/i.test(queryString);
    }
  },
};
