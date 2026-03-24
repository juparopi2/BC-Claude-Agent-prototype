// ============================================================
// MODULE: keyvault-secrets
// Writes all application secrets into the existing Key Vault.
// Scope: sec resource group (Key Vault must already exist).
// Depends on: security, data, cognitive, monitoring modules.
// ============================================================

// ============================================================
// PARAMETERS — Key Vault identity
// ============================================================

@description('Name of the existing Key Vault to write secrets into.')
param kvName string

// ============================================================
// PARAMETERS — Data tier outputs
// ============================================================

@description('ADO.NET connection string for the SQL database.')
@secure()
param sqlConnectionString string

@description('Fully-qualified domain name of the SQL Server.')
param sqlServerFqdn string

@description('Name of the SQL database.')
param sqlDbName string

@description('SQL Server administrator login username.')
param sqlAdminUser string

@description('SQL Server administrator login password.')
@secure()
param sqlAdminPassword string

@description('Hostname of the Azure Cache for Redis instance.')
param redisHostName string

@description('Primary access key for the Redis cache.')
@secure()
param redisPrimaryKey string

@description('Full connection string for the Azure Storage account.')
@secure()
param storageConnectionString string

@description('Endpoint URL of the Azure AI Search service.')
param searchEndpoint string

@description('Admin key for the Azure AI Search service.')
@secure()
param searchAdminKey string

// ============================================================
// PARAMETERS — Cognitive / AI outputs
// ============================================================

@description('Endpoint URL of the Azure OpenAI account.')
param openAiEndpoint string

@description('Primary access key for the Azure OpenAI account.')
@secure()
param openAiKey string

@description('Name of the OpenAI embedding model deployment.')
param openAiEmbeddingModel string

@description('Endpoint URL of the Computer Vision account.')
param computerVisionEndpoint string

@description('Primary access key for the Computer Vision account.')
@secure()
param computerVisionKey string

@description('Endpoint URL of the Document Intelligence account.')
param docIntelligenceEndpoint string

@description('Primary access key for the Document Intelligence account.')
@secure()
param docIntelligenceKey string

// ============================================================
// PARAMETERS — Monitoring outputs
// ============================================================

@description('Connection string for Application Insights.')
param appInsightsConnectionString string

@description('Instrumentation key for Application Insights.')
param appInsightsInstrumentationKey string

// ============================================================
// PARAMETERS — Manual secrets (injected from CI / Key Vault)
// ============================================================

@description('Anthropic Claude API key.')
@secure()
param claudeApiKey string

@description('Business Central tenant ID.')
@secure()
param bcTenantId string

@description('Business Central client (app) ID.')
@secure()
param bcClientId string

@description('Business Central client secret.')
@secure()
param bcClientSecret string

@description('Express session signing secret.')
@secure()
param sessionSecret string

@description('AES encryption key for sensitive data at rest.')
@secure()
param encryptionKey string

@description('Microsoft Entra app client ID (for OAuth).')
@secure()
param microsoftClientId string

@description('Microsoft Entra app client secret (for OAuth).')
@secure()
param microsoftClientSecret string

@description('Microsoft Entra tenant ID (for OAuth).')
@secure()
param microsoftTenantId string

@description('Endpoint URL of the Azure AI Speech account (auto-derived from cognitive module).')
param speechEndpoint string

@description('Primary access key of the Azure AI Speech account (auto-derived from cognitive module).')
@secure()
param speechKey string

@description('Public base URL for Graph webhook notifications (e.g. Container App FQDN). Set after first Container App deployment.')
param graphWebhookBaseUrl string = ''

@description('Endpoint URL of the Cohere embedding service.')
param cohereEndpoint string = ''

@description('Primary access key for the Cohere embedding service.')
@secure()
param cohereApiKey string = ''

// ============================================================
// COMPUTED VALUES
// ============================================================

// Build the Redis connection string in StackExchange.Redis format.
var redisConnectionString = '${redisHostName}:6380,password=${redisPrimaryKey},ssl=True,abortConnect=False'

// ============================================================
// EXISTING KEY VAULT REFERENCE
// ============================================================

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: kvName
}

// ============================================================
// SECRETS — Data tier
// ============================================================

resource secretSqlConnectionString 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'SqlDb-ConnectionString'
  properties: {
    value: sqlConnectionString
  }
}

resource secretRedisConnectionString 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'Redis-ConnectionString'
  properties: {
    value: redisConnectionString
  }
}

resource secretStorageConnectionString 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'Storage-ConnectionString'
  properties: {
    value: storageConnectionString
  }
}

resource secretDatabaseServer 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'Database-Server'
  properties: {
    value: sqlServerFqdn
  }
}

resource secretDatabaseName 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'Database-Name'
  properties: {
    value: sqlDbName
  }
}

resource secretDatabaseUser 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'Database-User'
  properties: {
    value: sqlAdminUser
  }
}

resource secretDatabasePassword 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'Database-Password'
  properties: {
    value: sqlAdminPassword
  }
}

resource secretSearchEndpoint 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'AZURE-SEARCH-ENDPOINT'
  properties: {
    value: searchEndpoint
  }
}

resource secretSearchAdminKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'AZURE-SEARCH-KEY'
  properties: {
    value: searchAdminKey
  }
}

// ============================================================
// SECRETS — Cognitive / AI
// ============================================================

resource secretOpenAiEndpoint 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'AZURE-OPENAI-ENDPOINT'
  properties: {
    value: openAiEndpoint
  }
}

resource secretOpenAiKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'AZURE-OPENAI-KEY'
  properties: {
    value: openAiKey
  }
}

resource secretOpenAiEmbeddingDeployment 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'AZURE-OPENAI-EMBEDDING-DEPLOYMENT'
  properties: {
    value: openAiEmbeddingModel
  }
}

resource secretComputerVisionEndpoint 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'AZURE-VISION-ENDPOINT'
  properties: {
    value: computerVisionEndpoint
  }
}

resource secretComputerVisionKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'AZURE-VISION-KEY'
  properties: {
    value: computerVisionKey
  }
}

resource secretDocIntelligenceEndpoint 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'DocumentIntelligence-Endpoint'
  properties: {
    value: docIntelligenceEndpoint
  }
}

resource secretDocIntelligenceKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'DocumentIntelligence-Key'
  properties: {
    value: docIntelligenceKey
  }
}

// ============================================================
// SECRETS — Monitoring
// ============================================================

resource secretAppInsightsConnectionString 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'ApplicationInsights-ConnectionString'
  properties: {
    value: appInsightsConnectionString
  }
}

resource secretAppInsightsInstrumentationKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'ApplicationInsights-InstrumentationKey'
  properties: {
    value: appInsightsInstrumentationKey
  }
}

// ============================================================
// SECRETS — Manual (injected from CI / external Key Vault)
// ============================================================

resource secretClaudeApiKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'Claude-ApiKey'
  properties: {
    value: claudeApiKey
  }
}

resource secretBcTenantId 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'BC-TenantId'
  properties: {
    value: bcTenantId
  }
}

resource secretBcClientId 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'BC-ClientId'
  properties: {
    value: bcClientId
  }
}

resource secretBcClientSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'BC-ClientSecret'
  properties: {
    value: bcClientSecret
  }
}

resource secretSessionSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'SESSION-SECRET'
  properties: {
    value: sessionSecret
  }
}

resource secretEncryptionKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'ENCRYPTION-KEY'
  properties: {
    value: encryptionKey
  }
}

resource secretMicrosoftClientId 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'Microsoft-ClientId'
  properties: {
    value: microsoftClientId
  }
}

resource secretMicrosoftClientSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'Microsoft-ClientSecret'
  properties: {
    value: microsoftClientSecret
  }
}

resource secretMicrosoftTenantId 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'Microsoft-TenantId'
  properties: {
    value: microsoftTenantId
  }
}

resource secretAzureAudioEndpoint 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'AZURE-AUDIO-ENDPOINT'
  properties: {
    value: speechEndpoint
  }
}

resource secretAzureAudioKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'AZURE-AUDIO-KEY'
  properties: {
    value: speechKey
  }
}

resource secretGraphWebhookBaseUrl 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(graphWebhookBaseUrl)) {
  parent: keyVault
  name: 'Graph-WebhookBaseUrl'
  properties: {
    value: graphWebhookBaseUrl
  }
}

resource secretCohereEndpoint 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(cohereEndpoint)) {
  parent: keyVault
  name: 'COHERE-ENDPOINT'
  properties: {
    value: cohereEndpoint
  }
}

resource secretCohereApiKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(cohereApiKey)) {
  parent: keyVault
  name: 'COHERE-API-KEY'
  properties: {
    value: cohereApiKey
  }
}

// ============================================================
// OUTPUTS
// ============================================================

@description('Name of the Cohere endpoint secret (empty string when not deployed).')
output cohereEndpointSecretName string = !empty(cohereEndpoint) ? secretCohereEndpoint.name : ''

@description('Name of the Cohere API key secret (empty string when not deployed).')
output cohereApiKeySecretName string = !empty(cohereApiKey) ? secretCohereApiKey.name : ''
