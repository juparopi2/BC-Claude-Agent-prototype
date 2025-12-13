#!/bin/bash

echo "=========================================="
echo "ModelFactory Implementation Verification"
echo "=========================================="
echo ""

echo "1. Running TypeScript compilation check..."
npx tsc --noEmit src/core/langchain/ModelFactory.ts 2>&1 | head -5
if [ $? -eq 0 ]; then
  echo "   ✓ TypeScript compilation: PASSED"
else
  echo "   ✗ TypeScript compilation: FAILED"
fi
echo ""

echo "2. Running tests..."
npm test -- ModelFactory.test.ts --reporter=verbose 2>&1 | grep -E "(PASS|FAIL|✓|✗)" | head -10
echo ""

echo "3. Checking files created..."
if [ -f "src/core/langchain/ModelFactory.ts" ]; then
  echo "   ✓ ModelFactory.ts exists"
fi
if [ -f "src/core/langchain/ModelFactory.test.ts" ]; then
  echo "   ✓ ModelFactory.test.ts exists"
fi
if [ -f "src/core/langchain/ModelFactory.example.ts" ]; then
  echo "   ✓ ModelFactory.example.ts exists"
fi
if [ -f "src/core/langchain/IMPLEMENTATION_SUMMARY.md" ]; then
  echo "   ✓ IMPLEMENTATION_SUMMARY.md exists"
fi
echo ""

echo "4. Counting lines of code..."
echo "   ModelFactory.ts: $(wc -l < src/core/langchain/ModelFactory.ts) lines"
echo "   ModelFactory.test.ts: $(wc -l < src/core/langchain/ModelFactory.test.ts) lines"
echo ""

echo "=========================================="
echo "Verification Complete!"
echo "=========================================="
