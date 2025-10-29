# Deployment Guide - BC Claude Agent

Este documento describe cómo configurar CI/CD y desplegar la aplicación en Azure Container Apps.

## 📋 Resumen de Recursos Azure

### Recursos Existentes ✅

Todos los recursos de infraestructura ya están creados:

**Resource Groups:**
- `rg-BCAgentPrototype-app-dev` - Aplicaciones y Container Apps
- `rg-BCAgentPrototype-data-dev` - Bases de datos y almacenamiento
- `rg-BCAgentPrototype-sec-dev` - Seguridad (Key Vault, Managed Identities)

**Recursos de Aplicación:**
- `crbcagentdev` - Azure Container Registry
- `cae-bcagent-dev` - Container Apps Environment
- `mi-bcagent-backend-dev` - Managed Identity para Backend
- `mi-bcagent-frontend-dev` - Managed Identity para Frontend

**Recursos de Datos:**
- `sqlsrv-bcagent-dev` - Azure SQL Server
- `sqldb-bcagent-dev` - Azure SQL Database
- `redis-bcagent-dev` - Azure Redis Cache
- `sabcagentdev` - Azure Storage Account

**Recursos de Seguridad:**
- `kv-bcagent-dev` - Azure Key Vault (con todos los secrets ya configurados)

### Container Apps (Pendientes de crear)

Los Container Apps se crearán automáticamente en el primer deployment via GitHub Actions:
- `app-bcagent-backend-dev` - Backend (Express + Socket.IO)
- `app-bcagent-frontend-dev` - Frontend (Next.js)

---

## 🔐 Configuración de GitHub Secrets

Para que CI/CD funcione, necesitas configurar los siguientes secrets en GitHub.

### 1. Crear Service Principal para GitHub Actions

```bash
# Crear Service Principal con permisos de Contributor
az ad sp create-for-rbac \
  --name "sp-bcagent-github-actions" \
  --role contributor \
  --scopes /subscriptions/5343f6e1-f251-4b50-a592-18ff3e97eaa7/resourceGroups/rg-BCAgentPrototype-app-dev \
  --sdk-auth
```

**Importante:** Copia todo el JSON que devuelve este comando. Lo necesitarás para el secret `AZURE_CREDENTIALS`.

### 2. Dar permisos al Service Principal para Key Vault

```bash
# Obtener el Object ID del Service Principal
SP_OBJECT_ID=$(az ad sp list --display-name "sp-bcagent-github-actions" --query "[0].id" -o tsv)

# Dar permisos de lectura de secrets en Key Vault
az keyvault set-policy \
  --name kv-bcagent-dev \
  --object-id $SP_OBJECT_ID \
  --secret-permissions get list
```

### 3. Dar permisos para ACR

```bash
# Obtener el Application ID del Service Principal
SP_APP_ID=$(az ad sp list --display-name "sp-bcagent-github-actions" --query "[0].appId" -o tsv)

# Dar permisos de push a Container Registry
az role assignment create \
  --assignee $SP_APP_ID \
  --role AcrPush \
  --scope /subscriptions/5343f6e1-f251-4b50-a592-18ff3e97eaa7/resourceGroups/rg-BCAgentPrototype-app-dev/providers/Microsoft.ContainerRegistry/registries/crbcagentdev
```

### 4. Configurar GitHub Secrets

Ve a tu repositorio en GitHub: **Settings → Secrets and variables → Actions → New repository secret**

Agrega los siguientes secrets:

#### `AZURE_CREDENTIALS` (Requerido)
El JSON completo que obtuviste en el paso 1. Debería verse así:
```json
{
  "clientId": "...",
  "clientSecret": "...",
  "subscriptionId": "5343f6e1-f251-4b50-a592-18ff3e97eaa7",
  "tenantId": "...",
  "activeDirectoryEndpointUrl": "https://login.microsoftonline.com",
  "resourceManagerEndpointUrl": "https://management.azure.com/",
  "activeDirectoryGraphResourceId": "https://graph.windows.net/",
  "sqlManagementEndpointUrl": "https://management.core.windows.net:8443/",
  "galleryEndpointUrl": "https://gallery.azure.com/",
  "managementEndpointUrl": "https://management.core.windows.net/"
}
```

#### `KEY_VAULT_URI` (Requerido)
```
https://kv-bcagent-dev.vault.azure.net
```

---

## 🚀 Deployment

### Opción 1: Deployment Automático (Recomendado)

Una vez configurados los GitHub Secrets, el deployment es automático:

1. **Backend**: Cualquier push a `main` que modifique archivos en `backend/` triggerea el workflow
2. **Frontend**: Cualquier push a `main` que modifique archivos en `frontend/` triggerea el workflow

```bash
# Hacer commit y push
git add .
git commit -m "feat: initial deployment"
git push origin main
```

Los workflows:
- Construyen las imágenes Docker
- Las suben al Azure Container Registry
- Crean o actualizan los Container Apps
- Configuran las variables de entorno
- Hacen health checks

### Opción 2: Deployment Manual

Puedes triggear manualmente los workflows desde GitHub:

1. Ve a **Actions** en tu repositorio
2. Selecciona el workflow (Backend o Frontend)
3. Click en **Run workflow**
4. Selecciona la branch `main`
5. Click en **Run workflow**

---

## 🔍 Verificar Deployment

### Verificar que los Container Apps se crearon

```bash
# Listar Container Apps
az containerapp list \
  --resource-group rg-BCAgentPrototype-app-dev \
  --query "[].{Name:name, Fqdn:properties.configuration.ingress.fqdn, Status:properties.runningStatus}" \
  --output table
```

### Obtener URLs de los Container Apps

```bash
# Backend URL
az containerapp show \
  --name app-bcagent-backend-dev \
  --resource-group rg-BCAgentPrototype-app-dev \
  --query properties.configuration.ingress.fqdn \
  --output tsv

# Frontend URL
az containerapp show \
  --name app-bcagent-frontend-dev \
  --resource-group rg-BCAgentPrototype-app-dev \
  --query properties.configuration.ingress.fqdn \
  --output tsv
```

### Health Checks

```bash
# Backend health
curl https://[backend-url]/health

# Frontend health
curl https://[frontend-url]/
```

---

## 📝 Variables de Entorno

### Backend Container App

Las siguientes variables de entorno se configuran automáticamente en el Container App del backend:

**Desde Key Vault (Secrets):**
- `DATABASE_CONNECTION_STRING` → Key Vault: `SqlDb-ConnectionString`
- `REDIS_CONNECTION_STRING` → Key Vault: `Redis-ConnectionString`
- `ANTHROPIC_API_KEY` → Key Vault: `Claude-ApiKey`
- `BC_TENANT_ID` → Key Vault: `BC-TenantId`
- `BC_CLIENT_ID` → Key Vault: `BC-ClientId`
- `BC_CLIENT_SECRET` → Key Vault: `BC-ClientSecret`
- `JWT_SECRET` → Key Vault: `JWT-Secret`
- `STORAGE_CONNECTION_STRING` → Key Vault: `Storage-ConnectionString`

**Variables Normales:**
- `NODE_ENV=production`
- `PORT=3001`
- `BC_API_URL=https://api.businesscentral.dynamics.com/v2.0`
- `BC_ENVIRONMENT=production`
- `MCP_SERVER_URL=https://app-erptools-mcp-dev.purplemushroom-befedc5f.westeurope.azurecontainerapps.io/mcp`
- `LOG_LEVEL=info`
- `ENABLE_PROMPT_CACHING=true`
- `ENABLE_EXTENDED_THINKING=true`

### Frontend Container App

- `NEXT_PUBLIC_API_URL` → URL del backend Container App
- `NEXT_PUBLIC_WS_URL` → WebSocket URL del backend
- `NEXT_PUBLIC_ENV=production`

---

## 🔧 Actualizar Variables de Entorno

Si necesitas actualizar variables de entorno después del deployment:

```bash
# Backend
az containerapp update \
  --name app-bcagent-backend-dev \
  --resource-group rg-BCAgentPrototype-app-dev \
  --set-env-vars LOG_LEVEL=debug

# Frontend
az containerapp update \
  --name app-bcagent-frontend-dev \
  --resource-group rg-BCAgentPrototype-app-dev \
  --set-env-vars NEXT_PUBLIC_API_URL=https://nueva-url.com
```

---

## 📊 Monitoreo y Logs

### Ver logs en tiempo real

```bash
# Backend logs
az containerapp logs show \
  --name app-bcagent-backend-dev \
  --resource-group rg-BCAgentPrototype-app-dev \
  --follow

# Frontend logs
az containerapp logs show \
  --name app-bcagent-frontend-dev \
  --resource-group rg-BCAgentPrototype-app-dev \
  --follow
```

### Ver métricas

```bash
# Backend metrics
az monitor metrics list \
  --resource /subscriptions/5343f6e1-f251-4b50-a592-18ff3e97eaa7/resourceGroups/rg-BCAgentPrototype-app-dev/providers/Microsoft.App/containerApps/app-bcagent-backend-dev \
  --metric Requests \
  --output table
```

---

## 🐛 Troubleshooting

### El Container App no arranca

1. **Verificar logs:**
   ```bash
   az containerapp logs show --name app-bcagent-backend-dev --resource-group rg-BCAgentPrototype-app-dev --tail 100
   ```

2. **Verificar secretos de Key Vault:**
   ```bash
   az keyvault secret list --vault-name kv-bcagent-dev --query "[].name" -o table
   ```

3. **Verificar permisos del Managed Identity:**
   ```bash
   az keyvault show --name kv-bcagent-dev --query properties.accessPolicies
   ```

### La imagen no se puede descargar del ACR

1. **Verificar que ACR tiene la imagen:**
   ```bash
   az acr repository list --name crbcagentdev
   az acr repository show-tags --name crbcagentdev --repository bcagent-backend
   ```

2. **Verificar permisos del Container App para ACR:**
   ```bash
   az containerapp show --name app-bcagent-backend-dev --resource-group rg-BCAgentPrototype-app-dev --query properties.configuration.registries
   ```

### Error "Failed to pull image"

El Container App necesita autenticarse con ACR. Esto se configura automáticamente, pero puedes verificar:

```bash
az containerapp registry show \
  --name app-bcagent-backend-dev \
  --resource-group rg-BCAgentPrototype-app-dev \
  --server crbcagentdev.azurecr.io
```

---

## 🔄 Rollback

Si algo sale mal, puedes hacer rollback a una versión anterior:

```bash
# Listar revisiones
az containerapp revision list \
  --name app-bcagent-backend-dev \
  --resource-group rg-BCAgentPrototype-app-dev \
  --output table

# Activar una revisión específica
az containerapp revision activate \
  --name app-bcagent-backend-dev \
  --resource-group rg-BCAgentPrototype-app-dev \
  --revision [revision-name]
```

---

## ✅ Checklist de Deployment

- [ ] Service Principal creado y con permisos
- [ ] GitHub Secrets configurados (`AZURE_CREDENTIALS`, `KEY_VAULT_URI`)
- [ ] Backend workflow ejecutado exitosamente
- [ ] Frontend workflow ejecutado exitosamente
- [ ] Container Apps creados y running
- [ ] Health checks pasando
- [ ] URLs de backend y frontend funcionando
- [ ] Base de datos inicializada con `init-db.sql`
- [ ] (Opcional) Datos de prueba cargados con `seed-data.sql`

---

## 📚 Recursos Adicionales

- [Azure Container Apps Documentation](https://learn.microsoft.com/en-us/azure/container-apps/)
- [GitHub Actions for Azure](https://github.com/Azure/actions)
- [Azure Key Vault with Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets)
