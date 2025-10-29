# Security Model - Least Privilege Implementation

## 🔐 Principio de Least Privilege

Este proyecto implementa el principio de **least privilege** para todos los Service Principals y Managed Identities.

**Definición:** Cada identidad recibe solo los permisos mínimos necesarios para realizar su función específica, nada más.

---

## 🎯 Service Principal de GitHub Actions

### Identidad
- **Name:** `sp-bcagent-github-actions`
- **Purpose:** Deployment automático desde GitHub Actions
- **Scope:** Solo recursos necesarios para CI/CD

### Permisos Asignados (Least Privilege)

#### 1. Azure Container Registry - `AcrPush`
**Scope:** `/subscriptions/.../providers/Microsoft.ContainerRegistry/registries/crbcagentdev`

**Permite:**
- ✅ Push de imágenes Docker al registry
- ✅ Tag de imágenes

**NO permite:**
- ❌ Modificar configuración del registry
- ❌ Eliminar imágenes
- ❌ Cambiar políticas de acceso

**Justificación:** GitHub Actions necesita subir las imágenes compiladas al ACR.

#### 2. Container Apps Environment - `Contributor`
**Scope:** `/subscriptions/.../providers/Microsoft.App/managedEnvironments/cae-bcagent-dev`

**Permite:**
- ✅ Crear Container Apps dentro del environment
- ✅ Actualizar Container Apps existentes
- ✅ Leer configuración de Container Apps
- ✅ Configurar variables de entorno
- ✅ Configurar secrets references a Key Vault

**NO permite:**
- ❌ Modificar el environment mismo
- ❌ Modificar otros recursos del Resource Group (SQL, Redis, Storage, etc.)
- ❌ Crear/modificar recursos fuera del environment

**Justificación:** GitHub Actions necesita crear y actualizar los Container Apps durante el deployment.

**⚠️ Alternativa más restrictiva:** Si Azure soportara roles más granulares como `Container Apps Writer`, lo usaríamos. Contributor en el environment es el mínimo disponible actualmente.

#### 3. Key Vault - `Get` y `List` Secrets
**Scope:** `/subscriptions/.../providers/Microsoft.KeyVault/vaults/kv-bcagent-dev`

**Permite:**
- ✅ Leer secrets (para referenciarlos en Container Apps)
- ✅ Listar secrets disponibles

**NO permite:**
- ❌ Crear o modificar secrets
- ❌ Eliminar secrets
- ❌ Cambiar políticas de acceso
- ❌ Modificar configuración del vault

**Justificación:** Container Apps necesita referenciar secrets del Key Vault (ej: connection strings, API keys).

---

## 🚫 Permisos NO Asignados

El Service Principal de GitHub Actions **NO tiene acceso** a:

### ❌ Resource Group Completo
- **NO** tiene `Contributor` en `rg-BCAgentPrototype-app-dev`
- **NO** puede crear/modificar recursos arbitrarios
- **NO** puede modificar networking, security groups, etc.

### ❌ Azure SQL Database
- **NO** puede modificar el SQL Server
- **NO** puede modificar la database
- **NO** puede crear/eliminar databases
- **NO** puede leer datos de las tablas

**Nota:** Las connection strings vienen del Key Vault, pero el SP no tiene acceso directo a SQL.

### ❌ Redis Cache
- **NO** puede modificar configuración de Redis
- **NO** puede leer/escribir datos en Redis
- **NO** puede escalar o modificar el cache

### ❌ Storage Account
- **NO** puede leer/escribir blobs
- **NO** puede modificar configuración del storage
- **NO** puede crear containers

### ❌ Otros Resource Groups
- **NO** tiene acceso a `rg-BCAgentPrototype-data-dev`
- **NO** tiene acceso a `rg-BCAgentPrototype-sec-dev`
- Completamente aislado a su scope específico

---

## 📊 Comparación: Contributor vs Least Privilege

### ❌ Modelo Inseguro (NO usar)
```
Service Principal
  └─ Contributor en Resource Group
       ├─ Puede crear/modificar CUALQUIER recurso
       ├─ Puede eliminar SQL Server, Redis, Storage
       ├─ Puede modificar networking y security
       ├─ Puede escalar recursos (costos)
       └─ Riesgo: Si el SP se compromete, todo el RG está en riesgo
```

### ✅ Modelo Seguro (Implementado)
```
Service Principal
  ├─ AcrPush en Container Registry
  │    └─ Solo puede subir imágenes Docker
  │
  ├─ Contributor en Container Apps Environment
  │    └─ Solo puede crear/actualizar Container Apps
  │
  └─ Get/List en Key Vault
       └─ Solo puede leer secrets (no modificar)

Riesgo reducido: Si el SP se compromete:
  ✅ NO puede acceder a datos en SQL/Redis
  ✅ NO puede modificar infraestructura crítica
  ✅ NO puede eliminar recursos
  ✅ Solo puede modificar Container Apps (no destructivo, fácil rollback)
```

---

## 🏢 Managed Identities (Producción)

En producción, los Container Apps usan **Managed Identities** en lugar del Service Principal:

### Backend Container App
**Identity:** `mi-bcagent-backend-dev`

**Permisos:**
- ✅ `Get` y `List` secrets en Key Vault (para runtime)
- ❌ NO tiene acceso al ACR (no necesario en runtime)
- ❌ NO puede modificar recursos

### Frontend Container App
**Identity:** `mi-bcagent-frontend-dev`

**Permisos:**
- Actualmente ninguno (el frontend es estático, no necesita acceso a Azure resources)

---

## 🔄 Flujo de Deployment Seguro

```
1. Developer → Git Push
   └─ Código sube a GitHub

2. GitHub Actions (usa sp-bcagent-github-actions)
   ├─ Build Docker image
   ├─ Push a ACR (usa AcrPush) ✅
   └─ Deploy Container App (usa Contributor en environment) ✅
       └─ Configura secret references a Key Vault

3. Container App (usa mi-bcagent-backend-dev)
   ├─ Pull image desde ACR (usa ACR managed identity) ✅
   └─ Lee secrets desde Key Vault (usa Get permission) ✅

4. Runtime
   └─ App conecta a SQL/Redis usando secrets del Key Vault
```

**Seguridad en cada capa:**
- GitHub Actions: Solo puede deployar apps, no modificar infraestructura
- Container App: Solo puede leer secrets, no modificarlos
- Secrets: Centralizados en Key Vault, rotación fácil
- Datos: SQL y Redis protegidos, sin acceso directo desde CI/CD

---

## ✅ Best Practices Implementadas

### 1. Separation of Duties
- **CI/CD** (GitHub Actions): Deploy de aplicaciones
- **Infraestructura** (humanos con Owner): Modificación de recursos Azure
- **Runtime** (Managed Identities): Acceso a secrets

### 2. Principle of Least Privilege
- Cada identidad tiene solo los permisos mínimos
- Scopes restringidos (no Resource Group completo)
- Read-only donde sea posible

### 3. Secret Management
- Secrets en Key Vault (nunca en código)
- Acceso a secrets con Managed Identity (sin passwords)
- Container Apps referencian secrets (no los copian)

### 4. Audit Trail
- Todos los cambios en Azure se loguean
- GitHub Actions logs de cada deployment
- Key Vault logs de cada acceso a secrets

### 5. Rollback Capability
- Container Apps soportan revisiones
- Fácil rollback a versión anterior
- Deployment no destructivo

---

## 🔍 Verificación de Seguridad

### Checklist de Permisos

```bash
# 1. Verificar permisos del Service Principal
az role assignment list \
  --assignee 860de439-a0f5-4fef-b696-cf3131d77050 \
  --output table

# Deberías ver:
# - AcrPush en crbcagentdev
# - Contributor en cae-bcagent-dev
# - NO deberías ver Contributor en Resource Group

# 2. Verificar acceso a Key Vault
az keyvault show --name kv-bcagent-dev \
  --query "properties.accessPolicies[?objectId=='8e052582-1146-491e-ac96-ff6aa3c402c5'].permissions"

# Deberías ver solo: secrets: [get, list]

# 3. Verificar que NO tiene acceso a SQL
az sql db show-connection-string \
  --server sqlsrv-bcagent-dev \
  --name sqldb-bcagent-dev

# El SP NO puede ejecutar este comando sobre la DB

# 4. Verificar Managed Identities de Container Apps
az containerapp identity show \
  --name app-bcagent-backend-dev \
  --resource-group rg-BCAgentPrototype-app-dev
```

---

## 📖 Referencias

- [Azure RBAC Best Practices](https://learn.microsoft.com/en-us/azure/role-based-access-control/best-practices)
- [Managed Identities](https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/overview)
- [Key Vault Access Policies](https://learn.microsoft.com/en-us/azure/key-vault/general/security-features)
- [Container Apps Security](https://learn.microsoft.com/en-us/azure/container-apps/security-baseline)

---

## 🎯 Resumen

**✅ Implementado correctamente:**
- Service Principal con permisos mínimos
- Scoped a recursos específicos (no Resource Group)
- Secretos en Key Vault
- Managed Identities para runtime
- Audit logs habilitados

**❌ NO implementado (anti-patterns evitados):**
- Contributor en Resource Group completo
- Secrets en código o environment variables
- Acceso directo a bases de datos desde CI/CD
- Permisos Owner innecesarios
