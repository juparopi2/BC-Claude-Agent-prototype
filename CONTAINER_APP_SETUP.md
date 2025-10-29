# Azure Container App - Setup Guide

## 🎯 Overview

Este documento describe el proceso de configuración de permisos para Azure Container Apps en este proyecto. La configuración se divide en dos partes:

1. **Configuración de permisos (una sola vez)** - Manual
2. **Deployment automatizado (cada push)** - GitHub Actions

## 📋 Arquitectura de Permisos

### Service Principal: `sp-bcagent-github-actions`
**Propósito**: Ejecutar GitHub Actions workflows

**Permisos necesarios**:
- ✅ **Contributor** en Resource Group `rg-BCAgentPrototype-app-dev`
- ✅ **AcrPush** en Container Registry `crbcagentdev`
- ✅ **Key Vault Secrets User** en `kv-bcagent-dev`

**Puede hacer**:
- Crear y actualizar Container Apps
- Push de imágenes Docker a ACR
- Leer secrets del Key Vault

**NO puede hacer**:
- Asignar roles a managed identities (requiere User Access Administrator)
- Modificar IAM de otros recursos

### Container App Managed Identity
**Propósito**: Permitir que el Container App acceda a recursos Azure

**Permisos necesarios**:
- ✅ **AcrPull** en Container Registry `crbcagentdev`
- ✅ **Get, List** secrets en Key Vault `kv-bcagent-dev`

**Puede hacer**:
- Pull de imágenes Docker desde ACR
- Leer secrets del Key Vault en runtime

---

## 🚀 Proceso de Setup (Primera vez)

### Paso 1: Configurar Service Principal

**¿Cuándo?**: Antes del primer deployment

**Script**: `fix-sp-permissions.sh`

```bash
# Desde Azure Cloud Shell o local con Azure CLI
bash fix-sp-permissions.sh
```

**Este script asigna**:
- Role **Contributor** al Resource Group

**Verificación**:
```bash
az role assignment list \
  --assignee 860de439-a0f5-4fef-b696-cf3131d77050 \
  --all \
  --output table
```

Deberías ver:
- AcrPush en `crbcagentdev`
- Contributor en `rg-BCAgentPrototype-app-dev`

---

### Paso 2: Primer Deployment

**¿Cuándo?**: Después de ejecutar fix-sp-permissions.sh

**Método**: Push a main o workflow_dispatch en GitHub Actions

```bash
git push origin main
```

**¿Qué hace?**:
1. Build de la imagen Docker
2. Push a Azure Container Registry
3. **Crea el Container App** con:
   - System-assigned managed identity
   - Imagen placeholder inicial
4. **Muestra mensaje de advertencia** con el Principal ID

**Resultado esperado**:
- ✅ Container App creado
- ⚠️ Mensaje: "Debe ejecutar setup-container-app-identity.sh"
- ❌ Container App NO funcional todavía (no tiene permisos)

---

### Paso 3: Configurar Managed Identity

**¿Cuándo?**: Inmediatamente después del primer deployment exitoso

**Script**: `infrastructure/setup-container-app-identity.sh`

```bash
# Desde Azure Cloud Shell o local con Azure CLI
bash infrastructure/setup-container-app-identity.sh
```

**Este script**:
1. Obtiene el Principal ID del Container App
2. Asigna **AcrPull** role al ACR
3. Asigna permisos **Get, List** en Key Vault
4. Verifica las asignaciones

**Verificación**:
```bash
# Obtener el Principal ID del Container App
PRINCIPAL_ID=$(az containerapp show \
  --name app-bcagent-backend-dev \
  --resource-group rg-BCAgentPrototype-app-dev \
  --query identity.principalId -o tsv)

# Ver sus permisos
az role assignment list \
  --assignee $PRINCIPAL_ID \
  --all \
  --output table
```

Deberías ver:
- AcrPull en `crbcagentdev`

**Key Vault**:
```bash
az keyvault show \
  --name kv-bcagent-dev \
  --query "properties.accessPolicies[?objectId=='$PRINCIPAL_ID'].{ObjectId:objectId, Permissions:permissions.secrets}" \
  --output table
```

Deberías ver:
- Permissions: ['get', 'list']

---

### Paso 4: Re-deployment Final

**¿Cuándo?**: Después de ejecutar setup-container-app-identity.sh

**Método**: Re-run del workflow en GitHub Actions

```bash
# Opción 1: Trigger automático (push)
git commit --allow-empty -m "trigger: re-deploy after identity setup"
git push origin main

# Opción 2: Manual desde GitHub UI
# GitHub → Actions → Backend - Build and Deploy → Run workflow
```

**¿Qué hace?**:
1. Build y push de la imagen
2. **Actualiza el Container App existente** (no lo crea de nuevo)
3. Configura registry con managed identity
4. Configura secrets desde Key Vault
5. Actualiza a la imagen real del backend
6. Configura variables de entorno
7. Health check

**Resultado esperado**:
- ✅ Container App completamente funcional
- ✅ Puede pull imágenes de ACR
- ✅ Puede leer secrets del Key Vault
- ✅ Health check pasa

---

## 🔄 Deployments Subsiguientes

Una vez completado el setup inicial, los deployments son completamente automáticos:

```bash
# Modificar código en backend/
git add backend/
git commit -m "feat: nueva funcionalidad"
git push origin main
```

**El workflow automáticamente**:
1. Detecta que Container App existe
2. Build nueva imagen
3. Push a ACR
4. Actualiza Container App con nueva imagen
5. Health check

**NO necesita volver a ejecutar los scripts de setup** - los permisos persisten.

---

## 🔍 Troubleshooting

### Error: "does not have authorization to perform action 'Microsoft.App/containerApps/write'"

**Causa**: Service Principal no tiene Contributor en Resource Group

**Solución**:
```bash
bash fix-sp-permissions.sh
```

Verifica que el rol esté asignado:
```bash
az role assignment list \
  --assignee 860de439-a0f5-4fef-b696-cf3131d77050 \
  --scope "/subscriptions/5343f6e1-f251-4b50-a592-18ff3e97eaa7/resourceGroups/rg-BCAgentPrototype-app-dev" \
  --output table
```

---

### Error: "Failed to retrieve credentials for container registry"

**Causa**: Container App managed identity no tiene AcrPull

**Solución**:
```bash
bash infrastructure/setup-container-app-identity.sh
```

Verifica que el Principal ID del Container App tenga AcrPull:
```bash
PRINCIPAL_ID=$(az containerapp show \
  --name app-bcagent-backend-dev \
  --resource-group rg-BCAgentPrototype-app-dev \
  --query identity.principalId -o tsv)

az role assignment list --assignee $PRINCIPAL_ID --all --output table
```

---

### Error: "Container App health check failed"

**Posibles causas**:
1. No puede leer secrets del Key Vault
2. Variables de entorno mal configuradas
3. Puerto incorrecto

**Verificación de Key Vault**:
```bash
# Obtener Principal ID
PRINCIPAL_ID=$(az containerapp show \
  --name app-bcagent-backend-dev \
  --resource-group rg-BCAgentPrototype-app-dev \
  --query identity.principalId -o tsv)

# Verificar access policy
az keyvault show \
  --name kv-bcagent-dev \
  --query "properties.accessPolicies[?objectId=='$PRINCIPAL_ID']" \
  --output json
```

**Ver logs del Container App**:
```bash
az containerapp logs show \
  --name app-bcagent-backend-dev \
  --resource-group rg-BCAgentPrototype-app-dev \
  --follow
```

---

### Error: "System-assigned identity not enabled"

**Causa**: Container App no tiene managed identity habilitada

**Solución**:
```bash
az containerapp identity assign \
  --name app-bcagent-backend-dev \
  --resource-group rg-BCAgentPrototype-app-dev \
  --system-assigned
```

Luego ejecutar:
```bash
bash infrastructure/setup-container-app-identity.sh
```

---

## 📊 Checklist de Setup Completo

### Configuración Inicial (Una vez)

- [ ] **1. Service Principal Permissions**
  ```bash
  bash fix-sp-permissions.sh
  ```
  - [ ] Contributor en Resource Group
  - [ ] Verificado con `az role assignment list`

- [ ] **2. GitHub Secrets Configurados**
  - [ ] `AZURE_CREDENTIALS` con Service Principal credentials
  - [ ] `KEY_VAULT_URI` con URL del Key Vault

- [ ] **3. Primer Deployment**
  ```bash
  git push origin main
  ```
  - [ ] Workflow ejecuta sin errores de autorización
  - [ ] Container App creado con managed identity
  - [ ] Workflow muestra mensaje con setup instructions

- [ ] **4. Managed Identity Setup**
  ```bash
  bash infrastructure/setup-container-app-identity.sh
  ```
  - [ ] AcrPull asignado a Container App
  - [ ] Key Vault access policy configurado
  - [ ] Verificado con `az role assignment list`

- [ ] **5. Re-deployment Final**
  ```bash
  git commit --allow-empty -m "trigger: re-deploy"
  git push origin main
  ```
  - [ ] Container App actualizado con imagen real
  - [ ] Health check pasa
  - [ ] Logs muestran aplicación ejecutándose

### Verificación Final

- [ ] **Container App Status**
  ```bash
  az containerapp show \
    --name app-bcagent-backend-dev \
    --resource-group rg-BCAgentPrototype-app-dev \
    --query properties.runningStatus
  ```
  Resultado esperado: `"Running"`

- [ ] **Health Endpoint**
  ```bash
  curl https://app-bcagent-backend-dev.purplemushroom-befedc5f.westeurope.azurecontainerapps.io/health
  ```
  Resultado esperado: `{"status":"ok"}`

- [ ] **Managed Identity Permissions**
  ```bash
  PRINCIPAL_ID=$(az containerapp show \
    --name app-bcagent-backend-dev \
    --resource-group rg-BCAgentPrototype-app-dev \
    --query identity.principalId -o tsv)

  az role assignment list --assignee $PRINCIPAL_ID --all
  ```
  Resultado esperado: AcrPull en ACR

---

## 📚 Referencias

### Documentación del Proyecto
- [GITHUB_SETUP.md](./GITHUB_SETUP.md) - Configuración de GitHub Secrets
- [PERMISSIONS_FIX_REQUIRED.md](./PERMISSIONS_FIX_REQUIRED.md) - Explicación detallada del problema de permisos
- [TODO.md](./TODO.md) - Estado general del proyecto

### Scripts
- `fix-sp-permissions.sh` - Asigna Contributor al Service Principal
- `infrastructure/setup-container-app-identity.sh` - Configura managed identity del Container App
- `.github/workflows/backend-deploy.yml` - Workflow de deployment automatizado

### Microsoft Learn
- [Azure Container Apps - GitHub Actions](https://learn.microsoft.com/en-us/azure/container-apps/github-actions)
- [Azure Container Apps - Managed Identities](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity)
- [Azure Container Registry - Authentication](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-authentication-managed-identity)
- [Azure RBAC - Built-in Roles](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles)

---

## ⚙️ Resumen de IDs y Nombres

### Service Principal
- **Name**: `sp-bcagent-github-actions`
- **App ID (Client ID)**: `860de439-a0f5-4fef-b696-cf3131d77050`
- **Object ID**: `8e052582-1146-491e-ac96-ff6aa3c402c5`
- **Tenant ID**: `1e9a7510-b103-463a-9ade-68951205e7bc`

### Azure Resources
- **Subscription ID**: `5343f6e1-f251-4b50-a592-18ff3e97eaa7`
- **Resource Group**: `rg-BCAgentPrototype-app-dev`
- **Container App**: `app-bcagent-backend-dev`
- **Container Registry**: `crbcagentdev`
- **Key Vault**: `kv-bcagent-dev`
- **Environment**: `cae-bcagent-dev`

### Container App Managed Identity
- **Principal ID**: *(Obtener después de crear Container App)*
  ```bash
  az containerapp show \
    --name app-bcagent-backend-dev \
    --resource-group rg-BCAgentPrototype-app-dev \
    --query identity.principalId -o tsv
  ```

---

**Última actualización**: 2025-10-28
**Autor**: Claude Code
**Versión**: 1.0
