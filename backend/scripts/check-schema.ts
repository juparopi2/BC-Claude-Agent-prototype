#!/usr/bin/env ts-node

import * as sql from 'mssql';
import { getDatabaseConfig } from '../src/config/database';

async function checkSchema() {
  const config = getDatabaseConfig();
  const pool = await sql.connect(config);

  const result = await pool.request().query(`
    SELECT
      COLUMN_NAME,
      DATA_TYPE,
      IS_NULLABLE,
      COLUMN_DEFAULT
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'approvals'
    ORDER BY ORDINAL_POSITION
  `);

  console.log('\nApprovals table schema:\n');
  console.table(result.recordset);

  await pool.close();
}

checkSchema().catch(console.error);
