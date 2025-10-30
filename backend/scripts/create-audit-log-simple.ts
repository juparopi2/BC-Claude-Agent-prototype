import sql from 'mssql';
import dotenv from 'dotenv';
import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential } from '@azure/identity';

dotenv.config();

async function main() {
  const keyVaultUrl = `https://kv-bcagent-dev.vault.azure.net`;
  const credential = new DefaultAzureCredential();
  const client = new SecretClient(keyVaultUrl, credential);
  
  const secret = await client.getSecret('SqlDb-ConnectionString');
  const connStr = secret.value;
  if (!connStr) throw new Error('No connection string');
  
  const pool = await sql.connect(connStr);
  
  try {
    console.log('Creating audit_log table (no FK)...');
    await pool.request().query(`
      CREATE TABLE audit_log (
          id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
          user_id UNIQUEIDENTIFIER NULL,
          session_id UNIQUEIDENTIFIER NULL,
          action NVARCHAR(100) NOT NULL,
          entity_type NVARCHAR(100) NULL,
          entity_id UNIQUEIDENTIFIER NULL,
          details NVARCHAR(MAX) NULL,
          ip_address NVARCHAR(50) NULL,
          user_agent NVARCHAR(500) NULL,
          created_at DATETIME2(7) NOT NULL DEFAULT GETUTCDATE()
      )`);
    console.log('✅ Table created');
    
    console.log('Creating indexes...');
    await pool.request().query('CREATE INDEX idx_audit_user_id ON audit_log(user_id)');
    await pool.request().query('CREATE INDEX idx_audit_session_id ON audit_log(session_id)');
    await pool.request().query('CREATE INDEX idx_audit_action ON audit_log(action)');
    await pool.request().query('CREATE INDEX idx_audit_created_at ON audit_log(created_at)');
    await pool.request().query('CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id)');
    console.log('✅ Indexes created');
    
    console.log('Adding foreign keys...');
    await pool.request().query('ALTER TABLE audit_log ADD CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL');
    await pool.request().query('ALTER TABLE audit_log ADD CONSTRAINT fk_audit_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL');
    console.log('✅ Foreign keys added');
  } catch (error: any) {
    console.error('Error:', error.message);
  }
  
  await pool.close();
}

main().catch(console.error);
