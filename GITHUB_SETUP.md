# GitHub Secrets Setup - Instrucciones

## 🎯 Estado Actual

✅ **Completado:**
- Service Principal `sp-bcagent-github-actions` ya existe
- Credenciales renovadas
- Permisos de Key Vault configurados

⚠️ **Pendiente (requiere que ejecutes estos comandos):**
- Asignar role Contributor al Resource Group
- Asignar permisos ACR Push al Container Registry

---

## 📋 Comandos a Ejecutar

### Opción 1: Azure Portal (Más fácil)

#### 1. Asignar Role Contributor

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

#### 2. Asignar ACR Push al Container Registry

1. En Azure Portal, navega a **Container registries** → `crbcagentdev`
2. Click en **Access control (IAM)**
3. Click en **+ Add** → **Add role assignment**
4. En la tab **Role**:
   - Selecciona **AcrPush**
   - Click **Next**
5. En la tab **Members**:
   - Click **+ Select members**
   - Busca: `sp-bcagent-github-actions`
   - Selecciona el service principal
   - Click **Select**
   - Click **Next**
6. En la tab **Review + assign**:
   - Click **Review + assign**

---

### Opción 2: PowerShell (En Azure Cloud Shell o PowerShell local)

```powershell
# 1. Asignar Contributor al Resource Group
az role assignment create `
  --assignee 860de439-a0f5-4fef-b696-cf3131d77050 `
  --role Contributor `
  --scope "/subscriptions/5343f6e1-f251-4b50-a592-18ff3e97eaa7/resourceGroups/rg-BCAgentPrototype-app-dev"

# 2. Asignar AcrPush al Container Registry
az role assignment create `
  --assignee 860de439-a0f5-4fef-b696-cf3131d77050 `
  --role AcrPush `
  --scope "/subscriptions/5343f6e1-f251-4b50-a592-18ff3e97eaa7/resourceGroups/rg-BCAgentPrototype-app-dev/providers/Microsoft.ContainerRegistry/registries/crbcagentdev"
```

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
- **Contributor** en scope: `.../resourceGroups/rg-BCAgentPrototype-app-dev`
- **AcrPush** en scope: `.../registries/crbcagentdev`

---

## 🚀 Después de Configurar

Una vez que hayas completado estos pasos, el deployment automático estará listo. Solo necesitas hacer:

```bash
git add .
git commit -m "feat: complete setup and configuration"
git push origin main
```

Los workflows de GitHub Actions se triggerán automáticamente y desplegarán el backend y frontend a Azure Container Apps.

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
- ⚠️ Resource Group: **Contributor** en `rg-BCAgentPrototype-app-dev` (pendiente)
- ⚠️ Container Registry: **AcrPush** en `crbcagentdev` (pendiente)

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
