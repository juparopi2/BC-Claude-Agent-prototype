#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';

const MIGRATION_FILE = path.join(__dirname, 'migrations', '004_fix_approvals_constraints.sql');

console.log('Reading SQL file:', MIGRATION_FILE);
const sqlContent = fs.readFileSync(MIGRATION_FILE, 'utf-8');

console.log('\nTotal file length:', sqlContent.length, 'characters\n');

// Split by GO statement (case-insensitive)
const batches = sqlContent
  .split(/^\s*GO\s*$/gim)
  .map(batch => batch.trim())
  .filter(batch => batch.length > 0);

console.log('Number of batches found:', batches.length);
console.log('\n' + '='.repeat(80));

batches.forEach((batch, i) => {
  console.log(`\nBATCH ${i + 1}:`);
  console.log('-'.repeat(80));
  console.log(batch.substring(0, 300));
  if (batch.length > 300) {
    console.log(`... (${batch.length - 300} more characters)`);
  }
  console.log('-'.repeat(80));
});
