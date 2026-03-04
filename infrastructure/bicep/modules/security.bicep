// ============================================================
// MODULE: security
// Provisions Azure Key Vault in the security resource group.
// Access policies are intentionally empty — managed post-deploy
// by identity scripts (setup-container-app-identity.sh, etc.)
// ============================================================

@description('Name of the Key Vault resource.')
param kvName string

@description('Azure region for the Key Vault.')
param location string

// ============================================================
// RESOURCES
// ============================================================

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: kvName
  location: location
  tags: {
    project: 'MyWorkMate'
    module: 'security'
  }
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enabledForDeployment: true
    enabledForTemplateDeployment: true
    enabledForDiskEncryption: false
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    accessPolicies: []
  }
}

// ============================================================
// OUTPUTS
// ============================================================

@description('Name of the provisioned Key Vault.')
output keyVaultName string = keyVault.name

@description('URI of the provisioned Key Vault (used by apps and secret modules).')
output keyVaultUri string = keyVault.properties.vaultUri
