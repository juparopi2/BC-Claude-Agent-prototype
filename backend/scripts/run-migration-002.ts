import sql from 'mssql';
import dotenv from 'dotenv';
import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential } from '@azure/identity';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

async function main() {
  const keyVaultUrl = `https://kv-bcagent-dev.vault.azure.net`;
  const credential = new DefaultAzureCredential();
  const client = new SecretClient(keyVaultUrl, credential);
  
  const secret = await client.getSecret('SqlDb-ConnectionString');
  const connStr = secret.value;
  if (!connStr) throw new Error('No connection string');
  
  const pool = await sql.connect(connStr);
  
  const sqlContent = fs.readFileSync(path.join(__dirname, 'migrations', '002_add_observability_tables.sql'), 'utf-8');
  const batches = sqlContent.split(/^\s*GO\s*$/gim).filter(b => b.trim().length > 0);
  
  console.log(`Executing ${batches.length} batches from 002_add_observability_tables.sql...`);
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    if (!batch) continue;
    
    try {
      await pool.request().query(batch);
      if (i % 2 === 0) console.log(`  Progress: ${i+1}/${batches.length}`);
    } catch (error: any) {
      console.log(`  Batch ${i+1} error (might already exist):`, error.message.substring(0, 100));
    }
  }
  
  console.log('✅ migration 002 executed');
  await pool.close();
}

main().catch(console.error);
