// ============================================================
// MODULE: monitoring
// Deploys Log Analytics Workspace and Application Insights
// Scope: app resource group
// ============================================================

@description('Name of the Log Analytics workspace.')
param lawName string

@description('Name of the Application Insights component.')
param aiName string

@description('Azure region for both monitoring resources.')
param location string

@description('Log Analytics workspace data retention in days.')
param logRetentionDays int = 365

@description('Application Insights adaptive sampling percentage (0-100).')
@minValue(0)
@maxValue(100)
param samplingPercentage int = 100

// ============================================================
// RESOURCES
// ============================================================

resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: lawName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: logRetentionDays
  }
  tags: {
    project: 'MyWorkMate'
    module: 'monitoring'
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: aiName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalyticsWorkspace.id
    SamplingPercentage: samplingPercentage
  }
  tags: {
    project: 'MyWorkMate'
    module: 'monitoring'
  }
}

// ============================================================
// OUTPUTS
// ============================================================

@description('Resource ID of the Log Analytics workspace (consumed by Container Apps Environment).')
output logAnalyticsWorkspaceId string = logAnalyticsWorkspace.id

@description('Application Insights connection string.')
output appInsightsConnectionString string = appInsights.properties.ConnectionString

@description('Application Insights instrumentation key.')
output appInsightsInstrumentationKey string = appInsights.properties.InstrumentationKey
