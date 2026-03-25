// ============================================================
// MODULE: cognitive
// Deploys Azure OpenAI, Computer Vision, and Document Intelligence
// Scope: app resource group
// ============================================================

@description('Name of the Azure OpenAI account.')
param openAiName string

@description('Region for Azure OpenAI (must be an approved OpenAI region).')
param openAiLocation string = 'eastus'

@description('OpenAI embedding model deployment name (also used as the deployment identifier).')
param openAiEmbeddingModel string = 'text-embedding-3-small'

@description('OpenAI embedding model capacity in thousands of tokens per minute.')
param openAiEmbeddingCapacity int = 120

@description('Name of the Computer Vision account.')
param cvName string

@description('Computer Vision pricing tier.')
param computerVisionSku string = 'S1'

@description('Name of the Document Intelligence account.')
param diName string

@description('Document Intelligence pricing tier.')
param docIntelligenceSku string = 'S0'

@description('Region for Document Intelligence.')
param docIntelligenceLocation string = 'eastus'

@description('Primary Azure region used for Computer Vision (e.g. westeurope).')
param location string

@description('Name of the Azure AI Speech / Audio multi-service account.')
param speechName string

@description('Region for the Speech service (must support AIServices kind).')
param speechLocation string = 'eastus2'

@description('Speech / AI Services pricing tier.')
param speechSku string = 'S0'

@description('Audio transcription model deployment name.')
param audioTranscriptionModel string = 'gpt-4o-mini-transcribe'

@description('Audio transcription model capacity (tokens per minute, in thousands).')
param audioTranscriptionCapacity int = 60

@description('Name for the Cohere Embed v4 AIServices account (leave empty to skip creation)')
param cohereAiServicesName string = ''

@description('Location for Cohere AIServices (westeurope for GDPR in prod)')
param cohereAiServicesLocation string = 'westeurope'

@description('Cohere Embed v4 model deployment name')
param cohereDeploymentName string = 'embed-v-4-0'

@description('Cohere deployment capacity (GlobalStandard SKU)')
param cohereCapacity int = 1

// ============================================================
// RESOURCES
// ============================================================

resource openAi 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: openAiName
  location: openAiLocation
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: openAiName
    publicNetworkAccess: 'Enabled'
  }
  tags: {
    project: 'MyWorkMate'
    module: 'cognitive'
  }
}

resource openAiEmbeddingDeployment 'Microsoft.CognitiveServices/accounts/deployments@2023-05-01' = {
  name: openAiEmbeddingModel
  parent: openAi
  sku: {
    name: 'Standard'
    capacity: openAiEmbeddingCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: openAiEmbeddingModel
      version: '1'
    }
  }
}

resource computerVision 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: cvName
  location: location
  kind: 'ComputerVision'
  sku: {
    name: computerVisionSku
  }
  properties: {
    customSubDomainName: cvName
    publicNetworkAccess: 'Enabled'
  }
  tags: {
    project: 'MyWorkMate'
    module: 'cognitive'
  }
}

resource docIntelligence 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: diName
  location: docIntelligenceLocation
  kind: 'FormRecognizer'
  sku: {
    name: docIntelligenceSku
  }
  properties: {
    customSubDomainName: diName
    publicNetworkAccess: 'Enabled'
  }
  tags: {
    project: 'MyWorkMate'
    module: 'cognitive'
  }
}

resource speech 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: speechName
  location: speechLocation
  kind: 'AIServices'
  sku: {
    name: speechSku
  }
  properties: {
    customSubDomainName: speechName
    publicNetworkAccess: 'Enabled'
  }
  tags: {
    project: 'MyWorkMate'
    module: 'cognitive'
  }
}

resource audioTranscriptionDeployment 'Microsoft.CognitiveServices/accounts/deployments@2023-05-01' = {
  name: audioTranscriptionModel
  parent: speech
  sku: {
    name: 'GlobalStandard'
    capacity: audioTranscriptionCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: audioTranscriptionModel
      version: '2025-03-20'
    }
  }
}

resource cohereAiServices 'Microsoft.CognitiveServices/accounts@2023-05-01' = if (!empty(cohereAiServicesName)) {
  name: cohereAiServicesName
  location: cohereAiServicesLocation
  kind: 'AIServices'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: cohereAiServicesName
    publicNetworkAccess: 'Enabled'
  }
  tags: { project: 'MyWorkMate', module: 'cognitive' }
}

resource cohereEmbedDeployment 'Microsoft.CognitiveServices/accounts/deployments@2023-05-01' = if (!empty(cohereAiServicesName)) {
  name: cohereDeploymentName
  parent: cohereAiServices
  sku: {
    name: 'GlobalStandard'
    capacity: cohereCapacity
  }
  properties: {
    model: {
      format: 'Cohere'
      name: 'embed-v-4-0'
      version: '1'
    }
  }
}

// ============================================================
// OUTPUTS
// ============================================================

@description('Endpoint URL of the Azure OpenAI account.')
output openAiEndpoint string = openAi.properties.endpoint

@description('Primary access key for the Azure OpenAI account.')
output openAiKey string = openAi.listKeys().key1

@description('Name of the OpenAI embedding deployment (equals the model name).')
output openAiEmbeddingDeployment string = openAiEmbeddingModel

@description('Endpoint URL of the Computer Vision account.')
output computerVisionEndpoint string = computerVision.properties.endpoint

@description('Primary access key for the Computer Vision account.')
output computerVisionKey string = computerVision.listKeys().key1

@description('Endpoint URL of the Document Intelligence account.')
output docIntelligenceEndpoint string = docIntelligence.properties.endpoint

@description('Primary access key for the Document Intelligence account.')
output docIntelligenceKey string = docIntelligence.listKeys().key1

@description('Endpoint URL of the Azure AI Speech / Audio account.')
output speechEndpoint string = speech.properties.endpoint

@description('Primary access key for the Azure AI Speech / Audio account.')
output speechKey string = speech.listKeys().key1

@description('Endpoint URL of the Cohere AIServices account.')
output cohereEndpoint string = !empty(cohereAiServicesName) ? cohereAiServices.properties.endpoint : ''

@description('Primary access key for the Cohere AIServices account.')
output cohereKey string = !empty(cohereAiServicesName) ? cohereAiServices.listKeys().key1 : ''
