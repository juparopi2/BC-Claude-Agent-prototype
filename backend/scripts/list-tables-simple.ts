import sql from 'mssql';
import dotenv from 'dotenv';
import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential } from '@azure/identity';

dotenv.config();

async function main() {
  const keyVaultUrl = `https://kv-bcagent-dev.vault.azure.net`;
  const credential = new DefaultAzureCredential();
  const client = new SecretClient(keyVaultUrl, credential);
  
  const connStr = (await client.getSecret('SqlDb-ConnectionString')).value;
  if (!connStr) throw new Error('No connection string');
  
  const pool = await sql.connect(connStr);
  const result = await pool.request().query(`
    SELECT TABLE_NAME 
    FROM INFORMATION_SCHEMA.TABLES 
    WHERE TABLE_TYPE='BASE TABLE'
    ORDER BY TABLE_NAME
  `);
  
  console.log('Tables in database:');
  result.recordset.forEach((row: any) => console.log(`  - ${row.TABLE_NAME}`));
  
  await pool.close();
}

main().catch(console.error);
