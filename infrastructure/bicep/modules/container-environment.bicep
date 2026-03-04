// ============================================================
// MODULE: container-environment
// Deploys Azure Container Registry and Container Apps Environment.
// Scope: app resource group
// ============================================================

@description('Name of the Azure Container Registry.')
param acrName string

@description('Azure Container Registry SKU.')
@allowed(['Basic', 'Standard', 'Premium'])
param acrSku string = 'Basic'

@description('Name of the Container Apps Environment.')
param caeName string

@description('Azure region for all resources in this module.')
param location string

@description('Resource ID of the Log Analytics workspace for container log routing.')
param logAnalyticsWorkspaceId string

// ============================================================
// COMPUTED VALUES
// ============================================================

// Parse the Log Analytics workspace name from its resource ID so we can
// reference it as an existing resource within the same resource group.
// Resource ID format:
//   /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.OperationalInsights/workspaces/{name}
var lawResourceIdSegments = split(logAnalyticsWorkspaceId, '/')
var lawResourceName = lawResourceIdSegments[8]

// ============================================================
// EXISTING RESOURCES
// ============================================================

resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: lawResourceName
}

// ============================================================
// RESOURCES
// ============================================================

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: {
    name: acrSku
  }
  properties: {
    adminUserEnabled: true
  }
  tags: {
    project: 'MyWorkMate'
    module: 'container'
  }
}

resource managedEnvironment 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: caeName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsWorkspace.properties.customerId
        sharedKey: logAnalyticsWorkspace.listKeys().primarySharedKey
      }
    }
  }
  tags: {
    project: 'MyWorkMate'
    module: 'container'
  }
}

// ============================================================
// OUTPUTS
// ============================================================

@description('Login server URL of the Azure Container Registry.')
output acrLoginServer string = containerRegistry.properties.loginServer

@description('Name of the provisioned Azure Container Registry.')
output acrName string = containerRegistry.name

@description('Name of the provisioned Container Apps Environment.')
output caeName string = managedEnvironment.name

@description('Resource ID of the provisioned Container Apps Environment.')
output caeId string = managedEnvironment.id
