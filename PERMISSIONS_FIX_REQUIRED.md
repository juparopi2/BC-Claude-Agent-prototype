# ⚠️ ACCIÓN REQUERIDA: Permisos de Service Principal

## 🚨 Problema Identificado

El pipeline de GitHub Actions está fallando con el siguiente error:

```
ERROR: (AuthorizationFailed) The client with object id '8e052582-1146-491e-ac96-ff6aa3c402c5'
does not have authorization to perform action 'Microsoft.App/containerApps/write'
```

## 🔍 Causa Raíz

El Service Principal `sp-bcagent-github-actions` **NO tiene permisos suficientes** para crear Container Apps.

### Permisos Actuales (Insuficientes):
- ✅ AcrPush en Container Registry `crbcagentdev`
- ✅ Contributor en Container Apps Environment `cae-bcagent-dev`
- ❌ **FALTA: Contributor en Resource Group `rg-BCAgentPrototype-app-dev`**

## 📚 Documentación Oficial de Microsoft

Según [Microsoft Learn - Azure Container Apps con GitHub Actions](https://learn.microsoft.com/en-us/azure/container-apps/github-actions):

> **"The credentials used for the azure/login action must have Contributor access over the resource group containing the container app and container registry."**

### Permisos Específicos Requeridos:

1. `Microsoft.App/containerApps/write` - Crear/actualizar Container Apps
2. `Microsoft.Authorization/roleAssignments/write` - Asignar roles a managed identities
3. Acceso al ACR - Para push/pull de imágenes

Todos estos permisos están incluidos en el rol **Contributor** a nivel de Resource Group.

## ✅ Solución

### Opción 1: Script Automático (Recomendado)

```bash
# Ejecutar desde Azure Cloud Shell o local
bash fix-sp-permissions.sh
```

### Opción 2: Azure Portal (Manual)

1. Ir a https://portal.azure.com
2. Navegar a **Resource groups** → `rg-BCAgentPrototype-app-dev`
3. Click en **Access control (IAM)**
4. Click en **+ Add** → **Add role assignment**
5. Seleccionar rol **Contributor**
6. Buscar y seleccionar: `sp-bcagent-github-actions`
7. **Review + assign**

### Opción 3: Azure CLI

```bash
az role assignment create \
  --assignee 860de439-a0f5-4fef-b696-cf3131d77050 \
  --role Contributor \
  --scope "/subscriptions/5343f6e1-f251-4b50-a592-18ff3e97eaa7/resourceGroups/rg-BCAgentPrototype-app-dev"
```

## 🔐 Consideraciones de Seguridad

### ¿Por qué Contributor y no un rol más restrictivo?

Según el [GitHub Issue de Microsoft](https://github.com/microsoft/azure-container-apps/issues/35):

- **No existe un rol built-in "Container Apps Contributor"** específico
- Microsoft recomienda usar **Contributor** en el Resource Group para CI/CD
- Alternativa: Crear un **custom role** con permisos específicos (más complejo)

### Permisos que otorga Contributor en el RG:

✅ **Permitido:**
- Crear/actualizar Container Apps
- Configurar ACR integration
- Asignar roles a managed identities
- Gestionar Container Apps Environment

❌ **NO permitido:**
- Asignar roles fuera del Resource Group
- Modificar IAM del subscription
- Acceder a otros Resource Groups

## 📝 Próximos Pasos

1. **Ejecutar uno de los comandos arriba** para asignar el rol Contributor
2. **Verificar permisos**:
   ```bash
   az role assignment list \
     --assignee 860de439-a0f5-4fef-b696-cf3131d77050 \
     --all \
     --output table
   ```
3. **Re-ejecutar el GitHub Actions workflow**
4. **Verificar que el deployment sea exitoso**

## 🔗 Referencias

- [Microsoft Learn: Publish revisions with GitHub Actions](https://learn.microsoft.com/en-us/azure/container-apps/github-actions)
- [GitHub Issue: Required permissions for Container Apps](https://github.com/microsoft/azure-container-apps/issues/35)
- [Azure RBAC: Container roles](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/containers)

## 📊 Estado de Permisos

### Antes (Enfoque "Least Privilege" - Insuficiente):
```
sp-bcagent-github-actions
├── AcrPush on crbcagentdev ✅
└── Contributor on cae-bcagent-dev ✅ (pero insuficiente)
```

### Después (Microsoft Standard - Requerido):
```
sp-bcagent-github-actions
├── AcrPush on crbcagentdev ✅
└── Contributor on rg-BCAgentPrototype-app-dev ✅ (incluye Container Apps Environment)
```

---

**Última actualización:** 2025-10-29
**Autor:** Claude Code
**Basado en:** Documentación oficial de Microsoft Learn
