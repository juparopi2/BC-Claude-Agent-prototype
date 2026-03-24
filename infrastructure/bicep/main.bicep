targetScope = 'subscription'

// ============================================================
// PARAMETERS — General
// ============================================================

@description('Deployment environment (dev or prod).')
@allowed(['dev', 'prod'])
param environment string = 'dev'

@description('Primary Azure region for most resources.')
param location string = 'westeurope'

@description('Short project token used in resource names.')
param projectName string = 'bcagent'

@description('Prefix for all resource group names.')
param rgPrefix string = 'rg-BCAgentPrototype'

// ============================================================
// PARAMETERS — Data tier
// ============================================================

@description('SQL Server administrator username.')
param sqlAdminUser string

@description('SQL Server administrator password.')
@secure()
param sqlAdminPassword string

@description('Azure SQL Database service objective (SKU).')
param sqlDbServiceObjective string = 'S0'

@description('Azure Cache for Redis SKU family.')
@allowed(['Basic', 'Standard', 'Premium'])
param redisSku string = 'Basic'

@description('Storage account replication SKU.')
param storageSku string = 'Standard_LRS'

// ============================================================
// PARAMETERS — Cognitive / AI
// ============================================================

@description('Region for Azure OpenAI (must be an approved OpenAI region).')
param openAiLocation string = 'eastus'

@description('Region for Document Intelligence.')
param docIntelligenceLocation string = 'eastus'

@description('OpenAI embedding model deployment name.')
param openAiEmbeddingModel string = 'text-embedding-3-small'

@description('OpenAI embedding model capacity (thousands of tokens per minute).')
param openAiEmbeddingCapacity int = 120

@description('Computer Vision pricing tier.')
param computerVisionSku string = 'S1'

@description('Azure AI Search pricing tier.')
param aiSearchSku string = 'basic'

@description('Document Intelligence pricing tier.')
param docIntelligenceSku string = 'S0'

// ============================================================
// PARAMETERS — Monitoring
// ============================================================

@description('Log Analytics workspace retention in days.')
param logRetentionDays int = 365

@description('Application Insights adaptive sampling percentage (0-100).')
@minValue(0)
@maxValue(100)
param samplingPercentage int = 100

// ============================================================
// PARAMETERS — Container
// ============================================================

@description('Azure Container Registry SKU.')
@allowed(['Basic', 'Standard', 'Premium'])
param acrSku string = 'Basic'

// ============================================================
// PARAMETERS — Manual secrets (injected from Key Vault / CI)
// ============================================================

@secure()
param claudeApiKey string

@secure()
param bcTenantId string

@secure()
param bcClientId string

@secure()
param bcClientSecret string

@secure()
param sessionSecret string

@secure()
param encryptionKey string

@secure()
param microsoftClientId string

@secure()
param microsoftClientSecret string

@secure()
param microsoftTenantId string

@description('Endpoint URL of the Cohere embedding service.')
param cohereEndpoint string = ''

@description('Primary access key for the Cohere embedding service.')
@secure()
param cohereApiKey string = ''

// ============================================================
// COMPUTED NAMING VARIABLES
// ============================================================

var rgSec  = '${rgPrefix}-sec-${environment}'
var rgData = '${rgPrefix}-data-${environment}'
var rgApp  = '${rgPrefix}-app-${environment}'

var kvName        = 'kv-${projectName}-${environment}'
var sqlServerName = 'sqlsrv-${projectName}-${environment}'
var sqlDbName     = 'sqldb-${projectName}-${environment}'
var redisName     = 'redis-${projectName}-${environment}'
var storageName   = 'sa${projectName}${environment}'
var acrName       = 'cr${projectName}${environment}'
var caeName       = 'cae-${projectName}-${environment}'
var searchName    = 'search-${projectName}-${environment}'
var openAiName    = 'openai-${projectName}-${environment}'
var cvName        = 'cv-${projectName}-${environment}'
var diName        = 'di-${projectName}-${environment}'
var speechName    = 'speech-${projectName}-${environment}'
var lawName       = 'law-${projectName}-${environment}'
var aiName        = 'ai-${projectName}-${environment}'

// Shared tags applied to every resource group
var commonTags = {
  project: projectName
  environment: environment
}

// ============================================================
// RESOURCE GROUPS
// ============================================================

resource resourceGroupSec 'Microsoft.Resources/resourceGroups@2023-07-01' = {
  name: rgSec
  location: location
  tags: commonTags
}

resource resourceGroupData 'Microsoft.Resources/resourceGroups@2023-07-01' = {
  name: rgData
  location: location
  tags: commonTags
}

resource resourceGroupApp 'Microsoft.Resources/resourceGroups@2023-07-01' = {
  name: rgApp
  location: location
  tags: commonTags
}

// ============================================================
// MODULE: security  (Key Vault)
// ============================================================

module security 'modules/security.bicep' = {
  name: 'security'
  scope: resourceGroupSec
  params: {
    kvName: kvName
    location: location
  }
}

// ============================================================
// MODULE: monitoring  (Log Analytics + Application Insights)
// ============================================================

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  scope: resourceGroupApp
  params: {
    lawName: lawName
    aiName: aiName
    location: location
    logRetentionDays: logRetentionDays
    samplingPercentage: samplingPercentage
  }
}

// ============================================================
// MODULE: data  (SQL, Redis, Storage, AI Search)
// ============================================================

module data 'modules/data.bicep' = {
  name: 'data'
  scope: resourceGroupData
  params: {
    sqlServerName: sqlServerName
    sqlDbName: sqlDbName
    sqlAdminUser: sqlAdminUser
    sqlAdminPassword: sqlAdminPassword
    sqlDbServiceObjective: sqlDbServiceObjective
    redisName: redisName
    redisSku: redisSku
    storageName: storageName
    storageSku: storageSku
    searchName: searchName
    aiSearchSku: aiSearchSku
    location: location
  }
}

// ============================================================
// MODULE: cognitive  (OpenAI, Computer Vision, Doc Intelligence)
// ============================================================

module cognitive 'modules/cognitive.bicep' = {
  name: 'cognitive'
  scope: resourceGroupApp
  params: {
    openAiName: openAiName
    openAiLocation: openAiLocation
    openAiEmbeddingModel: openAiEmbeddingModel
    openAiEmbeddingCapacity: openAiEmbeddingCapacity
    cvName: cvName
    computerVisionSku: computerVisionSku
    diName: diName
    docIntelligenceSku: docIntelligenceSku
    docIntelligenceLocation: docIntelligenceLocation
    speechName: speechName
    location: location
  }
}

// ============================================================
// MODULE: containerEnvironment  (ACR + Container Apps Env)
// ============================================================

module containerEnvironment 'modules/container-environment.bicep' = {
  name: 'containerEnvironment'
  scope: resourceGroupApp
  params: {
    acrName: acrName
    acrSku: acrSku
    caeName: caeName
    location: location
    logAnalyticsWorkspaceId: monitoring.outputs.logAnalyticsWorkspaceId
  }
}

// ============================================================
// MODULE: keyvaultSecrets  (writes all secrets into Key Vault)
// Depends on security (KV must exist), data, cognitive, monitoring
// ============================================================

module keyvaultSecrets 'modules/keyvault-secrets.bicep' = {
  name: 'keyvaultSecrets'
  scope: resourceGroupSec
  params: {
    // Key Vault identity
    kvName: kvName

    // ── Auto-derived: data outputs ─────────────────────────
    sqlConnectionString: data.outputs.sqlConnectionString
    sqlServerFqdn: data.outputs.sqlServerFqdn
    sqlDbName: sqlDbName
    sqlAdminUser: sqlAdminUser
    sqlAdminPassword: sqlAdminPassword
    redisHostName: data.outputs.redisHostName
    redisPrimaryKey: data.outputs.redisPrimaryKey
    storageConnectionString: data.outputs.storageConnectionString
    searchEndpoint: data.outputs.searchEndpoint
    searchAdminKey: data.outputs.searchAdminKey

    // ── Auto-derived: cognitive outputs ───────────────────
    openAiEndpoint: cognitive.outputs.openAiEndpoint
    openAiKey: cognitive.outputs.openAiKey
    openAiEmbeddingModel: openAiEmbeddingModel
    computerVisionEndpoint: cognitive.outputs.computerVisionEndpoint
    computerVisionKey: cognitive.outputs.computerVisionKey
    docIntelligenceEndpoint: cognitive.outputs.docIntelligenceEndpoint
    docIntelligenceKey: cognitive.outputs.docIntelligenceKey

    // ── Auto-derived: monitoring outputs ──────────────────
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    appInsightsInstrumentationKey: monitoring.outputs.appInsightsInstrumentationKey

    // ── Auto-derived: speech outputs ──────────────────────
    speechEndpoint: cognitive.outputs.speechEndpoint
    speechKey: cognitive.outputs.speechKey

    // ── Manual secrets ─────────────────────────────────────
    claudeApiKey: claudeApiKey
    bcTenantId: bcTenantId
    bcClientId: bcClientId
    bcClientSecret: bcClientSecret
    sessionSecret: sessionSecret
    encryptionKey: encryptionKey
    microsoftClientId: microsoftClientId
    microsoftClientSecret: microsoftClientSecret
    microsoftTenantId: microsoftTenantId

    // ── Optional: Cohere embedding service ────────────────
    cohereEndpoint: cohereEndpoint
    cohereApiKey: cohereApiKey
  }
  dependsOn: [
    security
  ]
}

// ============================================================
// OUTPUTS
// ============================================================

@description('Name of the security resource group.')
output securityResourceGroupName string = rgSec

@description('Name of the data resource group.')
output dataResourceGroupName string = rgData

@description('Name of the application resource group.')
output appResourceGroupName string = rgApp

@description('Name of the Key Vault.')
output keyVaultName string = kvName

@description('Fully-qualified domain name of the SQL Server.')
output sqlServerFqdn string = data.outputs.sqlServerFqdn

@description('Hostname of the Redis cache.')
output redisHostName string = data.outputs.redisHostName

@description('Name of the storage account.')
output storageAccountName string = data.outputs.storageAccountName

@description('Login server URL of the Azure Container Registry.')
output acrLoginServer string = containerEnvironment.outputs.acrLoginServer

@description('Name of the Container Apps Environment.')
output containerAppsEnvironmentName string = caeName

@description('Endpoint URL of the Azure OpenAI account.')
output openAiEndpoint string = cognitive.outputs.openAiEndpoint

@description('Endpoint URL of the Azure AI Search service.')
output searchEndpoint string = data.outputs.searchEndpoint

@description('Application Insights connection string.')
output appInsightsConnectionString string = monitoring.outputs.appInsightsConnectionString
