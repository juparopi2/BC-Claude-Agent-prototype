// ============================================================
// MODULE: data
// Provisions all data-tier resources:
//   - Azure SQL Server + Firewall Rule + Database
//   - Azure Cache for Redis
//   - Storage Account + Blob Service + Container + Lifecycle Policy
//   - Azure AI Search
// ============================================================

// ── SQL ────────────────────────────────────────────────────

@description('Name of the Azure SQL logical server.')
param sqlServerName string

@description('Name of the SQL database.')
param sqlDbName string

@description('SQL Server administrator login username.')
param sqlAdminUser string

@description('SQL Server administrator login password.')
@secure()
param sqlAdminPassword string

@description('Azure SQL Database service objective (SKU name), e.g. S0, S1.')
param sqlDbServiceObjective string = 'S0'

// ── Redis ──────────────────────────────────────────────────

@description('Name of the Azure Cache for Redis resource.')
param redisName string

@description('Redis SKU tier: Basic, Standard, or Premium.')
@allowed(['Basic', 'Standard', 'Premium'])
param redisSku string = 'Basic'

@description('Redis SKU family: C for Basic/Standard, P for Premium.')
param redisFamily string = 'C'

@description('Redis cache capacity (0-6 for C family, 1-5 for P family).')
param redisCapacity int = 0

// ── Storage ────────────────────────────────────────────────

@description('Name of the storage account (must be globally unique, lowercase, 3-24 chars).')
param storageName string

@description('Storage account replication SKU, e.g. Standard_LRS.')
param storageSku string = 'Standard_LRS'

// ── AI Search ──────────────────────────────────────────────

@description('Name of the Azure AI Search service.')
param searchName string

@description('Azure AI Search pricing tier.')
param aiSearchSku string = 'basic'

// ── General ────────────────────────────────────────────────

@description('Azure region for all data-tier resources.')
param location string

// ============================================================
// RESOURCES — SQL
// ============================================================

resource sqlServer 'Microsoft.Sql/servers@2023-05-01-preview' = {
  name: sqlServerName
  location: location
  tags: {
    project: 'MyWorkMate'
    module: 'data'
  }
  properties: {
    administratorLogin: sqlAdminUser
    administratorLoginPassword: sqlAdminPassword
    version: '12.0'
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

resource sqlFirewallRule 'Microsoft.Sql/servers/firewallRules@2023-05-01-preview' = {
  name: 'AllowAzureServices'
  parent: sqlServer
  properties: {
    // Setting both IP addresses to 0.0.0.0 enables the "Allow Azure services" rule
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-05-01-preview' = {
  name: sqlDbName
  location: location
  parent: sqlServer
  tags: {
    project: 'MyWorkMate'
    module: 'data'
  }
  sku: {
    name: sqlDbServiceObjective
    tier: 'Standard'
  }
  properties: {
    collation: 'SQL_Latin1_General_CP1_CI_AS'
    maxSizeBytes: 268435456000 // 250 GB
    requestedBackupStorageRedundancy: 'Local'
  }
}

// ============================================================
// RESOURCES — Redis
// ============================================================

resource redisCache 'Microsoft.Cache/redis@2023-08-01' = {
  name: redisName
  location: location
  tags: {
    project: 'MyWorkMate'
    module: 'data'
  }
  properties: {
    sku: {
      name: redisSku
      family: redisFamily
      capacity: redisCapacity
    }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
  }
}

// ============================================================
// RESOURCES — Storage
// ============================================================

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  kind: 'StorageV2'
  tags: {
    project: 'MyWorkMate'
    module: 'data'
  }
  sku: {
    name: storageSku
  }
  properties: {
    accessTier: 'Hot'
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  name: 'default'
  parent: storageAccount
}

resource userFilesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  name: 'user-files'
  parent: blobService
  properties: {
    publicAccess: 'None'
  }
}

resource lifecyclePolicy 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  name: 'default'
  parent: storageAccount
  properties: {
    policy: {
      rules: [
        {
          enabled: true
          name: 'optimize-file-storage-costs'
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: [
                'blockBlob'
              ]
              prefixMatch: [
                'users/'
              ]
            }
            actions: {
              baseBlob: {
                tierToCool: {
                  daysAfterModificationGreaterThan: 30
                }
                tierToArchive: {
                  daysAfterModificationGreaterThan: 90
                }
                delete: {
                  daysAfterModificationGreaterThan: 730
                }
              }
            }
          }
        }
      ]
    }
  }
}

// ============================================================
// RESOURCES — AI Search
// ============================================================

resource searchService 'Microsoft.Search/searchServices@2023-11-01' = {
  name: searchName
  location: location
  tags: {
    project: 'MyWorkMate'
    module: 'data'
  }
  sku: {
    name: aiSearchSku
  }
  properties: {
    replicaCount: 1
    partitionCount: 1
    hostingMode: 'default'
  }
}

// ============================================================
// OUTPUTS
// ============================================================

@description('Fully-qualified domain name of the SQL logical server.')
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName

@description('ADO.NET connection string for the SQL database.')
output sqlConnectionString string = 'Server=tcp:${sqlServer.properties.fullyQualifiedDomainName},1433;Initial Catalog=${sqlDatabase.name};Persist Security Info=False;User ID=${sqlAdminUser};Password=${sqlAdminPassword};MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;'

@description('Hostname of the Redis cache (without port).')
output redisHostName string = redisCache.properties.hostName

@description('Primary access key for the Redis cache.')
output redisPrimaryKey string = redisCache.listKeys().primaryKey

@description('StackExchange.Redis compatible connection string (SSL).')
output redisConnectionString string = '${redisCache.properties.hostName}:${redisCache.properties.sslPort},password=${redisCache.listKeys().primaryKey},ssl=True,abortConnect=False'

@description('Name of the storage account.')
output storageAccountName string = storageAccount.name

@description('Full connection string for the storage account.')
output storageConnectionString string = 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'

@description('HTTPS endpoint for the Azure AI Search service.')
output searchEndpoint string = 'https://${searchService.name}.search.windows.net'

@description('Primary admin key for the Azure AI Search service.')
output searchAdminKey string = searchService.listAdminKeys().primaryKey

@description('Fully-qualified domain name of the SQL logical server (alias for sqlServerFqdn).')
output databaseServer string = sqlServer.properties.fullyQualifiedDomainName

@description('Name of the SQL database.')
output databaseName string = sqlDatabase.name

@description('SQL administrator login username.')
output databaseUser string = sqlAdminUser

@description('SQL administrator login password (propagated to Key Vault within the same deployment).')
output databasePassword string = sqlAdminPassword
