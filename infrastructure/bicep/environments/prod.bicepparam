using '../main.bicep'

// ============================================================
// ENVIRONMENT: prod (Production environment)
// ============================================================

param environment = 'prod'
param location = 'westeurope'
param projectName = 'myworkmate'
param rgPrefix = 'rg-myworkmate'

// ── Data tier (prod = higher SKUs) ──────────────────────────

param sqlAdminUser = 'bcagentadmin'
param sqlAdminPassword = readEnvironmentVariable('SQL_ADMIN_PASSWORD')
param sqlDbServiceObjective = 'S1'
param redisSku = 'Standard'
param storageSku = 'Standard_GRS'             // Geo-redundant for prod

// ── Cognitive / AI ──────────────────────────────────────────

param openAiLocation = 'eastus'
param docIntelligenceLocation = 'eastus'
param openAiEmbeddingModel = 'text-embedding-3-small'
param openAiEmbeddingCapacity = 200        // Quota limit: 350 total, 120 used by dev
param computerVisionSku = 'S1'
param aiSearchSku = 'basic'
param docIntelligenceSku = 'S0'

// ── Monitoring ──────────────────────────────────────────────

param logRetentionDays = 365
param samplingPercentage = 50                 // Reduce sampling in high-volume prod

// ── Container ───────────────────────────────────────────────

param acrSku = 'Standard'                     // Higher throughput for prod

// ── Manual secrets (from environment variables) ─────────────

param claudeApiKey = readEnvironmentVariable('CLAUDE_API_KEY')
param bcTenantId = readEnvironmentVariable('BC_TENANT_ID')
param bcClientId = readEnvironmentVariable('BC_CLIENT_ID')
param bcClientSecret = readEnvironmentVariable('BC_CLIENT_SECRET')
param sessionSecret = readEnvironmentVariable('SESSION_SECRET')
param encryptionKey = readEnvironmentVariable('ENCRYPTION_KEY')
param microsoftClientId = readEnvironmentVariable('MICROSOFT_CLIENT_ID')
param microsoftClientSecret = readEnvironmentVariable('MICROSOFT_CLIENT_SECRET')
param microsoftTenantId = readEnvironmentVariable('MICROSOFT_TENANT_ID')
