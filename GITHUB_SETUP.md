# GitHub Secrets Setup - Instrucciones

## 📖 Guía Completa de Setup

**⚠️ IMPORTANTE**: Para una guía paso a paso completa del proceso de setup, consulta:

📘 **[CONTAINER_APP_SETUP.md](./CONTAINER_APP_SETUP.md)** - Guía completa de configuración

Este documento contiene:
- Proceso completo de setup inicial (una sola vez)
- Arquitectura de permisos (Service Principal + Managed Identity)
- Troubleshooting detallado
- Checklist de verificación
- Referencias a scripts y comandos

---

## 🎯 Estado Actual

✅ **Completado:**
- Service Principal `sp-bcagent-github-actions` ya existe
- Credenciales renovadas
- Permisos de Key Vault configurados
- ✅ Permisos AcrPush al Container Registry configurados

⚠️ **CRÍTICO - Pendiente:**
- ❌ **Asignar role Contributor al Resource Group completo** (requerido por Microsoft docs)

## 📚 Documentación Oficial

Según [Microsoft Learn - GitHub Actions with Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/github-actions):

> **"The credentials used for the azure/login action must have Contributor access over the resource group containing the container app and container registry."**

El Service Principal **DEBE** tener Contributor en el Resource Group, NO solo en el Container Apps Environment.

---

## 📋 Comando REQUERIDO para Ejecutar

### ⚡ Script Automático (Recomendado)

Ejecuta el script que asigna todos los permisos necesarios:

```bash
# Desde Azure Cloud Shell o local con Azure CLI instalado
bash fix-sp-permissions.sh
```

El script asignará automáticamente el rol **Contributor** al Resource Group `rg-BCAgentPrototype-app-dev`.

---

### Opción Manual: Azure Portal

1. Ve a Azure Portal: https://portal.azure.com
2. Navega a **Resource groups** → `rg-BCAgentPrototype-app-dev`
3. Click en **Access control (IAM)**
4. Click en **+ Add** → **Add role assignment**
5. En la tab **Role**:
   - Selecciona **Contributor**
   - Click **Next**
6. En la tab **Members**:
   - Click **+ Select members**
   - Busca: `sp-bcagent-github-actions`
   - Selecciona el service principal
   - Click **Select**
   - Click **Next**
7. En la tab **Review + assign**:
   - Click **Review + assign**

---

### Opción Manual: Azure CLI

```bash
# Asignar Contributor al Resource Group
az role assignment create \
  --assignee 860de439-a0f5-4fef-b696-cf3131d77050 \
  --role Contributor \
  --scope "/subscriptions/5343f6e1-f251-4b50-a592-18ff3e97eaa7/resourceGroups/rg-BCAgentPrototype-app-dev"
```

**PowerShell:**
```powershell
az role assignment create `
  --assignee 860de439-a0f5-4fef-b696-cf3131d77050 `
  --role Contributor `
  --scope "/subscriptions/5343f6e1-f251-4b50-a592-18ff3e97eaa7/resourceGroups/rg-BCAgentPrototype-app-dev"
```

## 🔍 ¿Por qué Contributor en el Resource Group?

Según Microsoft, el Service Principal necesita:

1. **Microsoft.App/containerApps/write** - Para crear/actualizar Container Apps
2. **Microsoft.Authorization/roleAssignments/write** - Para asignar AcrPull a la managed identity del Container App
3. **Acceso al ACR** - Para push de imágenes

El rol **Contributor** en el Resource Group incluye todos estos permisos y es el estándar recomendado por Microsoft para CI/CD deployments.

---

## 🔐 GitHub Secrets a Configurar

Una vez que hayas asignado los permisos, ve a tu repositorio en GitHub:

**GitHub → Settings → Secrets and variables → Actions → New repository secret**

### 1. `AZURE_CREDENTIALS`

**Primero, obtén el clientSecret:**
```bash
# Renueva las credenciales del Service Principal para obtener un nuevo secret
az ad sp credential reset --id 860de439-a0f5-4fef-b696-cf3131d77050 --query "password" -o tsv
```

**Valor para el secret (reemplaza <CLIENT_SECRET> con el valor obtenido):**
```json
{
  "clientId": "860de439-a0f5-4fef-b696-cf3131d77050",
  "clientSecret": "<CLIENT_SECRET>",
  "subscriptionId": "5343f6e1-f251-4b50-a592-18ff3e97eaa7",
  "tenantId": "1e9a7510-b103-463a-9ade-68951205e7bc"
}
```

**IMPORTANTE:** Copia todo el JSON tal cual (incluye las llaves `{}`).

### 2. `KEY_VAULT_URI`

**Valor:**
```
https://kv-bcagent-dev.vault.azure.net
```

---

## ✅ Verificar Configuración

Una vez configurados los secrets, puedes verificar que todo funciona:

```bash
# Verificar role assignments del Service Principal
az role assignment list \
  --assignee 860de439-a0f5-4fef-b696-cf3131d77050 \
  --query "[].{Role:roleDefinitionName, Scope:scope}" \
  --output table
```

**Deberías ver:**
- **AcrPush** en scope: `.../registries/crbcagentdev`
- **Contributor** en scope: `.../resourceGroups/rg-BCAgentPrototype-app-dev` ✅ **REQUERIDO**

**Nota:** Anteriormente se documentó usar "least privilege" con Contributor solo en el Environment, pero según la [documentación oficial de Microsoft](https://learn.microsoft.com/en-us/azure/container-apps/github-actions), se requiere Contributor en el Resource Group completo.

---

## 🚀 Después de Configurar

Una vez que hayas configurado los permisos del Service Principal, sigue estos pasos:

### 1. Primer Deployment (Crea el Container App)

```bash
git push origin main
```

El workflow creará el Container App con system-assigned managed identity, pero **mostrará una advertencia** indicando que debes configurar los permisos de la managed identity.

### 2. Configurar Managed Identity del Container App

**Después del primer deployment exitoso**, ejecuta:

```bash
bash infrastructure/setup-container-app-identity.sh
```

Este script configura los permisos necesarios para que el Container App pueda:
- ✅ Pull imágenes desde Azure Container Registry (AcrPull)
- ✅ Leer secrets desde Key Vault (Get, List)

### 3. Re-deployment Final

Ejecuta el workflow nuevamente para que use la configuración completa:

```bash
git commit --allow-empty -m "trigger: re-deploy after identity setup"
git push origin main
```

### 4. Verificar Deployment Exitoso

```bash
# Ver status del Container App
az containerapp show \
  --name app-bcagent-backend-dev \
  --resource-group rg-BCAgentPrototype-app-dev \
  --query properties.runningStatus

# Test health endpoint
curl https://app-bcagent-backend-dev.purplemushroom-befedc5f.westeurope.azurecontainerapps.io/health
```

---

📘 **Para una guía detallada paso a paso, consulta [CONTAINER_APP_SETUP.md](./CONTAINER_APP_SETUP.md)**

Los workflows de GitHub Actions subsiguientes serán completamente automáticos.

---

## 📝 Resumen de Credenciales

### Service Principal
- **Name:** sp-bcagent-github-actions
- **App ID (Client ID):** 860de439-a0f5-4fef-b696-cf3131d77050
- **Object ID:** 8e052582-1146-491e-ac96-ff6aa3c402c5
- **Client Secret:** *(Obtener con: `az ad sp credential reset --id 860de439-a0f5-4fef-b696-cf3131d77050`)*
- **Tenant ID:** 1e9a7510-b103-463a-9ade-68951205e7bc

### Permisos Configurados
- ✅ Key Vault: **Get, List** secrets en `kv-bcagent-dev`
- ✅ Container Registry: **AcrPush** en `crbcagentdev`
- ❌ **Resource Group: Contributor en `rg-BCAgentPrototype-app-dev`** ← **PENDIENTE - CRÍTICO**

**Nota:** Según [Microsoft docs](https://learn.microsoft.com/en-us/azure/container-apps/github-actions), se requiere Contributor en el Resource Group completo para deployment de Container Apps via GitHub Actions.

---

## 🆘 Troubleshooting

### "Role assignment already exists"
Si ves este error, significa que el permiso ya está configurado. Puedes ignorarlo.

### "Cannot find service principal"
Verifica que estás logueado en Azure CLI:
```bash
az account show
```

### "Insufficient privileges"
Asegúrate de que tu cuenta de Azure tiene permisos de **Owner** o **User Access Administrator** en el subscription o resource group.
