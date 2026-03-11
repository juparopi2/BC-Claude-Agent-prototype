# Infrastructure — Azure Bicep Templates

Declarative infrastructure-as-code for the MyWorkMate platform using [Azure Bicep](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/overview).

## Directory Structure

```
infrastructure/
  bicep/
    main.bicep                              # Subscription-level orchestrator
    environments/
      dev.bicepparam                        # Dev environment parameters
      prod.bicepparam                       # Prod skeleton (adjust before use)
    modules/
      security.bicep                        # Key Vault
      data.bicep                            # SQL + Redis + Storage + AI Search
      cognitive.bicep                       # OpenAI + Vision + Doc Intelligence
      monitoring.bicep                      # Log Analytics + App Insights
      container-environment.bicep           # ACR + Container Apps Environment
      keyvault-secrets.bicep                # All Key Vault secrets (28+)
  scripts/
    deploy.sh                               # Deploy wrapper (what-if + apply)
    setup-storage-cors.sh                   # Post-deploy: CORS rules
    setup-container-app-identity.sh         # Post-deploy: RBAC for MIs
    update-search-index-schema.sh           # Post-deploy: Search index fields
    update-search-semantic-config.sh        # Post-deploy: Semantic config
  diagnostics/                              # Troubleshooting scripts
  blob-lifecycle-policy.json                # Reference (inlined in data.bicep)
```

## Resource Inventory

### Naming Convention

All resource names follow `{type}-{project}-{environment}` with computed variables:

| Variable | Pattern | Dev Example |
|---|---|---|
| Resource Groups | `{rgPrefix}-{area}-{env}` | `rg-BCAgentPrototype-sec-dev` |
| Key Vault | `kv-{project}-{env}` | `kv-bcagent-dev` |
| SQL Server | `sqlsrv-{project}-{env}` | `sqlsrv-bcagent-dev` |
| SQL Database | `sqldb-{project}-{env}` | `sqldb-bcagent-dev` |
| Redis Cache | `redis-{project}-{env}` | `redis-bcagent-dev` |
| Storage Account | `sa{project}{env}` | `sabcagentdev` |
| Container Registry | `cr{project}{env}` | `crbcagentdev` |
| CAE | `cae-{project}-{env}` | `cae-bcagent-dev` |
| AI Search | `search-{project}-{env}` | `search-bcagent-dev` |
| OpenAI | `openai-{project}-{env}` | `openai-bcagent-dev` |
| Computer Vision | `cv-{project}-{env}` | `cv-bcagent-dev` |
| Doc Intelligence | `di-{project}-{env}` | `di-bcagent-dev` |
| Log Analytics | `law-{project}-{env}` | `law-bcagent-dev` |
| App Insights | `ai-{project}-{env}` | `ai-bcagent-dev` |

Changing `environment` from `dev` to `prod` automatically creates an entirely separate set of resources in separate resource groups.

### Resource Groups (3 per environment)

| Group | Purpose | Example Resources |
|---|---|---|
| `rg-...-sec-{env}` | Security | Key Vault |
| `rg-...-data-{env}` | Data | SQL, Redis, Storage, AI Search |
| `rg-...-app-{env}` | Application | ACR, CAE, OpenAI, Vision, Doc Intelligence, Monitoring |

### Key Vault Secrets (28+)

**Auto-derived** (from Bicep outputs — no manual input needed):
- `SqlDb-ConnectionString`, `Redis-ConnectionString`, `Storage-ConnectionString`
- `Database-Server`, `Database-Name`, `Database-User`, `Database-Password`
- `AZURE-OPENAI-ENDPOINT`, `AZURE-OPENAI-KEY`, `AZURE-OPENAI-EMBEDDING-DEPLOYMENT`
- `AZURE-SEARCH-ENDPOINT`, `AZURE-SEARCH-KEY`
- `AZURE-VISION-ENDPOINT`, `AZURE-VISION-KEY`
- `DocumentIntelligence-Endpoint`, `DocumentIntelligence-Key`
- `ApplicationInsights-ConnectionString`, `ApplicationInsights-InstrumentationKey`

**Manual** (provided via environment variables):
- `Claude-ApiKey`, `SESSION-SECRET`, `ENCRYPTION-KEY`
- `BC-TenantId`, `BC-ClientId`, `BC-ClientSecret`
- `Microsoft-ClientId`, `Microsoft-ClientSecret`, `Microsoft-TenantId`
- `AZURE-AUDIO-ENDPOINT`, `AZURE-AUDIO-KEY`

## Deployment

### Prerequisites

- Azure CLI (`az`) installed and logged in
- Contributor role on the target subscription
- All manual secret environment variables exported (see below)

### Required Environment Variables

```bash
export SQL_ADMIN_PASSWORD='...'
export CLAUDE_API_KEY='...'
export BC_TENANT_ID='...'
export BC_CLIENT_ID='...'
export BC_CLIENT_SECRET='...'
export SESSION_SECRET='...'
export ENCRYPTION_KEY='...'
export MICROSOFT_CLIENT_ID='...'
export MICROSOFT_CLIENT_SECRET='...'
export MICROSOFT_TENANT_ID='...'
export AZURE_AUDIO_ENDPOINT='...'
export AZURE_AUDIO_KEY='...'
```

### Deploy

```bash
# Preview changes (safe — no modifications)
ENVIRONMENT=dev bash infrastructure/scripts/deploy.sh --what-if

# Deploy dev environment
ENVIRONMENT=dev bash infrastructure/scripts/deploy.sh

# Deploy prod environment
ENVIRONMENT=prod bash infrastructure/scripts/deploy.sh
```

The deploy script:
1. Validates all required environment variables
2. Runs `az deployment sub what-if` to preview changes
3. Asks for confirmation
4. Runs `az deployment sub create`
5. Prints post-deploy checklist

### Post-Deploy Steps (run once per new environment)

After Bicep deployment completes, and after CI/CD creates the Container Apps:

```bash
# 1. Configure managed identity permissions (ACR + Key Vault)
ENVIRONMENT=dev bash infrastructure/scripts/setup-container-app-identity.sh

# 2. Configure Storage CORS rules
ENVIRONMENT=dev bash infrastructure/scripts/setup-storage-cors.sh

# 3. Create/update AI Search index
bash infrastructure/scripts/update-search-index-schema.sh

# 4. Configure semantic search
bash infrastructure/scripts/update-search-semantic-config.sh
```

### Post-Deploy: Graph Webhook URL (One-Time)

After the backend Container App is deployed for the first time, set the `Graph-WebhookBaseUrl` Key Vault secret so that Microsoft Graph change notification subscriptions (PRD-108) know where to send webhooks.

```bash
# 1. Get the Container App FQDN
FQDN=$(az containerapp show \
  --name app-bcagent-backend-dev \
  --resource-group rg-BCAgentPrototype-app-dev \
  --query 'properties.configuration.ingress.fqdn' -o tsv)

# 2. Set the secret in Key Vault
az keyvault secret set \
  --vault-name kv-bcagent-dev \
  --name Graph-WebhookBaseUrl \
  --value "https://${FQDN}"

# 3. Restart the backend Container App to pick up the new secret
az containerapp revision restart \
  --name app-bcagent-backend-dev \
  --resource-group rg-BCAgentPrototype-app-dev
```

This only needs to be done once per environment. The FQDN is stable across deployments. Without this secret, webhook subscriptions are not created (the system falls back to polling-only sync).

---

## Architecture Decisions

### Why Bicep over Bash Scripts?

- **Declarative**: Define desired state, not imperative steps. Azure handles create-vs-update.
- **Idempotent**: Run multiple times safely — incremental mode only changes what's different.
- **Parameterized**: Single template, environment-specific `.bicepparam` files.
- **What-if**: Preview changes before applying.
- **Dependency management**: Bicep handles resource ordering automatically.

### What's NOT in Bicep

- **Container Apps** — Created by CI/CD workflows (GitHub Actions). Bicep manages the environment but not the apps themselves.
- **CORS rules** — Require the frontend Container App FQDN, which is only known after CI/CD deploys it.
- **Search index schema** — Azure AI Search index definition requires REST API calls, not supported by Bicep.
- **RBAC assignments** — System-assigned managed identities only exist after Container Apps are created.

### Key Technical Choices

| Decision | Rationale |
|---|---|
| Subscription-level deployment | Needed to create resource groups |
| Incremental mode (default) | Safely adopts existing resources |
| `listKeys()` for auto-derived secrets | Eliminates two-step create-then-query |
| `readEnvironmentVariable()` in .bicepparam | No secrets committed to files |
| System-assigned MIs only | Confirmed via `az containerapp show` |
| No user-assigned MIs | `mi-bcagent-*-dev` resources are unused — can be deleted |

## Cost Estimate (Dev)

| Resource | SKU | ~Monthly Cost |
|---|---|---|
| Key Vault | Standard | $0.03/10k ops |
| SQL Database | S0 (10 DTU) | ~$15 |
| Redis Cache | Basic C0 | ~$16 |
| Storage Account | Standard LRS | ~$1 |
| Container Registry | Basic | ~$5 |
| Container Apps | Consumption | ~$0-10 |
| Azure OpenAI | S0 | Pay per token |
| AI Search | Basic | ~$25 |
| Computer Vision | S1 | Pay per call |
| Doc Intelligence | S0 | ~$1.50/1k pages |
| Log Analytics | PerGB | ~$2.76/GB |
| App Insights | Workspace-based | Included in LAW |
| **Total** | | **~$65-80/month** |

## Verification

```bash
# 1. Preview (no changes)
ENVIRONMENT=dev bash infrastructure/scripts/deploy.sh --what-if

# 2. After deploy — verify Key Vault secrets
az keyvault secret list --vault-name kv-bcagent-dev -o table

# 3. Run diagnostics
bash infrastructure/diagnostics/verify-azure-config.sh

# 4. Deploy via CI/CD and test the app
```
