using '../main.bicep'

// ============================================================
// ENVIRONMENT: dev
// ============================================================

param environment = 'dev'
param location = 'westeurope'
param projectName = 'bcagent'
param rgPrefix = 'rg-BCAgentPrototype'

// ── Data tier (dev = minimal cost) ──────────────────────────

param sqlAdminUser = 'bcagentadmin'
param sqlAdminPassword = readEnvironmentVariable('SQL_ADMIN_PASSWORD')
param sqlDbServiceObjective = 'S0'
param redisSku = 'Basic'
param storageSku = 'Standard_LRS'

// ── Cognitive / AI ──────────────────────────────────────────

param openAiLocation = 'eastus'
param docIntelligenceLocation = 'eastus'
param openAiEmbeddingModel = 'text-embedding-3-small'
param openAiEmbeddingCapacity = 120
param computerVisionSku = 'S1'
param aiSearchSku = 'basic'
param docIntelligenceSku = 'S0'

// ── Monitoring ──────────────────────────────────────────────

param logRetentionDays = 365
param samplingPercentage = 100

// ── Container ───────────────────────────────────────────────

param acrSku = 'Basic'

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
