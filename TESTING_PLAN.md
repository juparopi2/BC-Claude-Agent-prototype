# BC-Claude-Agent - Plan de Pruebas

**Fecha**: 2025-11-10
**Estado del proyecto**: Phase 2 - Week 7 (En Progreso)
**Referencia**: TODO.md (Phase 1 ✅ completada, Phase 2 Week 4-6 ✅ completada)

Este documento describe todas las pruebas que puedes ejecutar para verificar que tu proyecto esté funcionando correctamente, tanto en local como en Azure.

---

## 📋 Índice

1. [Pruebas en Local](#pruebas-en-local)
   - [Backend Health Checks](#1-backend-health-checks)
   - [Autenticación](#2-autenticación)
   - [Agent SDK & MCP](#3-agent-sdk--mcp)
   - [WebSocket & Real-time](#4-websocket--real-time)
   - [Frontend UI](#5-frontend-ui)
2. [Pruebas en Azure](#pruebas-en-azure)
   - [Infraestructura](#1-infraestructura)
   - [Base de Datos](#2-base-de-datos)
   - [Conectividad](#3-conectividad)
   - [Secrets & Key Vault](#4-secrets--key-vault)
3. [Pruebas End-to-End](#pruebas-end-to-end)
4. [Troubleshooting](#troubleshooting)

---

## 🏠 Pruebas en Local

### Pre-requisitos

```bash
# Backend
cd backend
npm install
npm run type-check  # Verificar TypeScript
npm run lint        # Verificar linting

# Frontend
cd frontend
npm install
npm run build       # Verificar build
npm run lint        # Verificar linting
```

---

### 1. Backend Health Checks

#### 1.1 Iniciar el Servidor

```bash
cd backend
npm run dev
```

**Resultado esperado**:
```
[Server] Starting server...
[Config] Loading environment configuration...
[Config] ✅ Environment loaded successfully
[KeyVault] ✅ Secrets loaded from Azure Key Vault
[DB] ✅ Connected to Azure SQL Database
[Redis] ✅ Connected to Redis Cache
[Server] 🚀 Server listening on port 3001
[Server] 📊 WebSocket server ready
```

#### 1.2 Health Endpoint

```bash
curl http://localhost:3001/health
```

**Resultado esperado**:
```json
{
  "status": "healthy",
  "timestamp": "2025-11-10T...",
  "services": {
    "database": "up",
    "redis": "up"
  }
}
```

**Posibles problemas**:
- `database: "down"` → Verifica firewall de Azure SQL (ver sección Azure)
- `redis: "down"` → Verifica firewall de Azure Redis (ver sección Azure)

#### 1.3 API Status Endpoints

```bash
# Auth status
curl http://localhost:3001/api/auth/status

# Agent status
curl http://localhost:3001/api/agent/status

# MCP config (verifica configuración del MCP server)
curl http://localhost:3001/api/mcp/config
```

**Resultado esperado** (`/api/agent/status`):
```json
{
  "status": "configured",
  "agentSdk": {
    "installed": true,
    "version": "0.1.29"
  },
  "mcp": {
    "configured": true,
    "serverUrl": "https://app-erptools-mcp-dev..."
  },
  "subagents": {
    "enabled": true,
    "routing": "automatic",
    "agents": ["bc-query", "bc-write", "bc-validation", "bc-analysis"]
  }
}
```

---

### 2. Autenticación

#### 2.1 Test Scripts Automatizados

```bash
cd backend

# Test completo de autenticación (register + login + me + refresh + logout)
npx ts-node scripts/test-auth-flow.ts
```

**Nota**: Este script no existe aún, pero puedes crear uno o usar los comandos curl de abajo.

#### 2.2 Manual Testing con curl

**2.2.1 Registrar nuevo usuario**:
```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test1234",
    "name": "Test User"
  }'
```

**Resultado esperado**:
```json
{
  "user": {
    "id": "...",
    "email": "test@example.com",
    "name": "Test User",
    "role": "viewer"
  },
  "tokens": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 86400
  }
}
```

**Guarda el `accessToken` para las siguientes pruebas**.

**2.2.2 Login**:
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test1234"
  }'
```

**2.2.3 Get Current User** (requiere token):
```bash
curl http://localhost:3001/api/auth/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Resultado esperado**:
```json
{
  "user": {
    "id": "...",
    "email": "test@example.com",
    "name": "Test User",
    "role": "viewer",
    "createdAt": "..."
  }
}
```

**2.2.4 Refresh Token**:
```bash
curl -X POST http://localhost:3001/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "YOUR_REFRESH_TOKEN"}'
```

**2.2.5 Logout**:
```bash
curl -X POST http://localhost:3001/api/auth/logout \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "YOUR_REFRESH_TOKEN"}'
```

#### 2.3 Test de Roles y Permisos

**Crear usuario admin** (primero en la BD):
```sql
-- Conectarse a Azure SQL
-- Ver sección "Azure" para connection string
UPDATE users SET role = 'admin' WHERE email = 'test@example.com';
```

**Probar endpoint protegido**:
```bash
# Sin token - debe devolver 401
curl http://localhost:3001/api/agent/query

# Con token válido - debe devolver 200
curl http://localhost:3001/api/agent/query \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello"}'
```

---

### 3. Agent SDK & MCP

#### 3.1 Verificar Configuración

```bash
# Verificar que MCP server esté configurado
curl http://localhost:3001/api/mcp/config
```

**Resultado esperado**:
```json
{
  "mcpServers": {
    "erptools": {
      "url": "https://app-erptools-mcp-dev.purplemushroom-befedc5f.westeurope.azurecontainerapps.io/mcp",
      "headers": {
        "Accept": "application/json, text/event-stream"
      }
    }
  }
}
```

#### 3.2 Test de Conectividad con BC

**Nota**: El MCP server funciona en local vía stdio transport. Este test verifica la autenticación OAuth con Business Central.

```bash
# Test de autenticación con Business Central
curl http://localhost:3001/api/bc/test \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Resultado esperado**:
```json
{
  "status": "success",
  "message": "Successfully connected to Business Central",
  "tenant": "1e9a7510-b103-463a-9ade-68951205e7bc"
}
```

**Si falla con error de network**: Verifica que el MCP server esté indexado correctamente:
```bash
cd backend/mcp-server && npm run index
```

#### 3.3 Test de Query Básico (Local)

```bash
curl -X POST http://localhost:3001/api/agent/query \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test-session-1",
    "message": "What can you do?"
  }'
```

**Resultado esperado**:
```json
{
  "success": true,
  "sessionId": "test-session-1",
  "message": "Query started - check WebSocket for real-time updates"
}
```

**Nota**: La respuesta real del agente se envía por WebSocket (ver siguiente sección).

---

### 4. WebSocket & Real-time

#### 4.1 Test Scripts Automatizados

Existen 5 scripts de testing en `backend/scripts/`:

```bash
cd backend

# 1. Test de conexión WebSocket
npx ts-node scripts/test-websocket-connection.ts

# 2. Test de flujo de chat básico
npx ts-node scripts/test-chat-flow.ts

# 3. Test de aprobación (accept)
npx ts-node scripts/test-approval-flow.ts

# 4. Test de aprobación (reject)
npx ts-node scripts/test-approval-rejection.ts

# 5. Test de tracking de todos
npx ts-node scripts/test-todo-tracking.ts
```

**Resultado esperado** (ejemplo de `test-websocket-connection.ts`):
```
✅ WebSocket connected
✅ Connection acknowledged: {connectionId: "..."}
✅ Disconnected successfully
```

#### 4.2 Test Manual con wscat

```bash
# Instalar wscat si no lo tienes
npm install -g wscat

# Conectarse al WebSocket server
wscat -c ws://localhost:3001

# Una vez conectado, enviar:
{"type":"session:join","sessionId":"test-session-1"}

# Enviar mensaje:
{"type":"chat:message","sessionId":"test-session-1","message":"Hello"}

# Deberías recibir eventos como:
# {"type":"agent:thinking"}
# {"type":"agent:message_chunk","content":"Hello..."}
# {"type":"agent:message_complete"}
```

---

### 5. Frontend UI

#### 5.1 Iniciar Dev Server

```bash
cd frontend
npm run dev
```

**Resultado esperado**:
```
▲ Next.js 16.0.0
- Local:        http://localhost:3000
- Ready in 2.3s
```

#### 5.2 Verificar UI Components

Abre http://localhost:3000 en tu navegador y verifica:

**Layout Components**:
- [ ] Header visible con logo "BC-Claude-Agent"
- [ ] Sidebar colapsable (botón de toggle funciona)
- [ ] Chat interface en el centro
- [ ] Source panel a la derecha (colapsable)
- [ ] Context bar en la parte inferior

**Chat Interface**:
- [ ] Input de texto visible
- [ ] Botón "Send" habilitado cuando hay texto
- [ ] Placeholder: "Type your message..."
- [ ] Empty state: "Start a new conversation..."

**Sidebar**:
- [ ] Botón "New Chat" visible
- [ ] Lista de sesiones (vacía inicialmente)
- [ ] Todo List section (collapsible)

**Header**:
- [ ] User menu (dropdown) funcional
- [ ] Dark mode toggle funcional
- [ ] Approval badge (0 pending inicialmente)

#### 5.3 Test de Responsive Design

Redimensiona el navegador y verifica:

**Desktop (>1920px)**:
- [ ] 3 columnas: sidebar (280px) + chat (flex) + panels (320px)
- [ ] Todo visible simultáneamente

**Tablet (768px - 1920px)**:
- [ ] Sidebar colapsable pero visible por defecto
- [ ] Chat interface responsivo
- [ ] Panels colapsables

**Mobile (<768px)**:
- [ ] Sidebar oculto por defecto (solo toggle button)
- [ ] Chat fullscreen
- [ ] Panels ocultos (accesibles por toggle)

#### 5.4 Test de Dark Mode

- [ ] Click en toggle de dark mode
- [ ] Todos los componentes se ven correctos en dark mode
- [ ] Buen contraste de colores
- [ ] No hay elementos ilegibles

#### 5.5 Test de WebSocket (Frontend)

**Nota**: Requiere backend corriendo en `localhost:3001`.

1. Abre DevTools (F12) → Console
2. Deberías ver:
   ```
   [Socket] Connecting to ws://localhost:3001
   [Socket] Connected successfully
   ```
3. Si ves errores de conexión:
   - Verifica que el backend esté corriendo
   - Verifica `.env.local`: `NEXT_PUBLIC_WS_URL=ws://localhost:3001`

---

## ☁️ Pruebas en Azure

### 1. Infraestructura

#### 1.1 Verificar Resource Groups

```bash
az group list --output table
```

**Resultado esperado**:
```
Name                           Location    Status
-----------------------------  ----------  ---------
rg-BCAgentPrototype-app-dev    westeurope  Succeeded
rg-BCAgentPrototype-data-dev   westeurope  Succeeded
rg-BCAgentPrototype-sec-dev    westeurope  Succeeded
```

#### 1.2 Listar Todos los Recursos

```bash
# Recursos de aplicación
az resource list --resource-group rg-BCAgentPrototype-app-dev --output table

# Recursos de datos
az resource list --resource-group rg-BCAgentPrototype-data-dev --output table

# Recursos de seguridad
az resource list --resource-group rg-BCAgentPrototype-sec-dev --output table
```

**Recursos esperados**:

**rg-BCAgentPrototype-sec-dev**:
- `kv-bcagent-dev` - Key Vault
- `mi-bcagent-backend-dev` - Managed Identity (backend)
- `mi-bcagent-frontend-dev` - Managed Identity (frontend)

**rg-BCAgentPrototype-data-dev**:
- `sqlsrv-bcagent-dev` - SQL Server
- `sqldb-bcagent-dev` - SQL Database
- `redis-bcagent-dev` - Redis Cache
- `sabcagentdev` - Storage Account

**rg-BCAgentPrototype-app-dev**:
- `crbcagentdev` - Container Registry
- `cae-bcagent-dev` - Container Apps Environment

---

### 2. Base de Datos

#### 2.1 Verificar Firewall de SQL Server

**⚠️ IMPORTANTE**: Si no puedes conectarte a Azure SQL desde local, es porque tu IP no está en el firewall.

```bash
# Obtener tu IP pública actual
curl https://api.ipify.org

# Listar reglas de firewall actuales
az sql server firewall-rule list \
  --server sqlsrv-bcagent-dev \
  --resource-group rg-BCAgentPrototype-data-dev \
  --output table
```

**Agregar tu IP al firewall**:
```bash
# Reemplaza YOUR_IP con el resultado de api.ipify.org
az sql server firewall-rule create \
  --resource-group rg-BCAgentPrototype-data-dev \
  --server sqlsrv-bcagent-dev \
  --name AllowMyIP \
  --start-ip-address YOUR_IP \
  --end-ip-address YOUR_IP
```

#### 2.2 Conectarse a Azure SQL

**Opción 1: Azure Portal Query Editor**
1. Ve a Azure Portal → SQL Database → `sqldb-bcagent-dev`
2. Click en "Query editor (preview)"
3. Ingresa credenciales (usuario: `bcagent-admin`)
4. Ejecuta query de prueba:
   ```sql
   SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
   WHERE TABLE_SCHEMA = 'dbo'
   ORDER BY TABLE_NAME;
   ```

**Opción 2: sqlcmd (CLI)**
```bash
# Obtener connection string del Key Vault (ver siguiente sección)
# Luego conectarse:
sqlcmd -S sqlsrv-bcagent-dev.database.windows.net \
  -d sqldb-bcagent-dev \
  -U bcagent-admin \
  -P YOUR_PASSWORD \
  -Q "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo'"
```

**Opción 3: Azure Data Studio**
1. Descargar Azure Data Studio: https://aka.ms/azuredatastudio
2. Conectarse con:
   - Server: `sqlsrv-bcagent-dev.database.windows.net`
   - Database: `sqldb-bcagent-dev`
   - Authentication: SQL Login
   - Username: `bcagent-admin`
   - Password: (obtener del Key Vault)

#### 2.3 Verificar Tablas Creadas

```sql
-- Listar todas las tablas
SELECT TABLE_NAME
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = 'dbo'
ORDER BY TABLE_NAME;
```

**Resultado esperado** (11 tablas):
```
agent_executions
approvals
audit_log
checkpoints
messages
permission_presets
refresh_tokens
sessions
tool_permissions
todos
users
```

#### 2.4 Verificar Usuarios de Prueba

```sql
-- Listar usuarios
SELECT id, email, name, role, created_at
FROM users
ORDER BY created_at;
```

**Resultado esperado** (3 usuarios):
```
id  | email             | name         | role   | created_at
----|-------------------|--------------|--------|------------------
... | admin@example.com | Admin User   | admin  | 2025-10-...
... | john@example.com  | John Doe     | editor | 2025-10-...
... | jane@example.com  | Jane Smith   | editor | 2025-10-...
```

#### 2.5 Verificar Índices

```sql
-- Listar índices por tabla
SELECT
    t.name AS TableName,
    i.name AS IndexName,
    i.type_desc AS IndexType
FROM sys.indexes i
INNER JOIN sys.tables t ON i.object_id = t.object_id
WHERE t.name IN ('users', 'sessions', 'messages', 'approvals', 'todos')
ORDER BY t.name, i.name;
```

---

### 3. Conectividad

#### 3.1 Verificar Redis Cache

**Verificar configuración**:
```bash
az redis show \
  --name redis-bcagent-dev \
  --resource-group rg-BCAgentPrototype-data-dev \
  --output table
```

**Obtener access keys**:
```bash
az redis list-keys \
  --name redis-bcagent-dev \
  --resource-group rg-BCAgentPrototype-data-dev
```

**Test de conexión con redis-cli**:
```bash
# Si tienes redis-cli instalado localmente
redis-cli -h redis-bcagent-dev.redis.cache.windows.net \
  -p 6380 \
  --tls \
  -a YOUR_PRIMARY_KEY \
  ping
```

**Resultado esperado**: `PONG`

**Si falla con ECONNRESET**:
- Verifica firewall rules de Redis
- Verifica que `publicNetworkAccess` esté `Enabled`

```bash
# Verificar public access
az redis show \
  --name redis-bcagent-dev \
  --resource-group rg-BCAgentPrototype-data-dev \
  --query publicNetworkAccess

# Si es "Disabled", habilitar:
az redis update \
  --name redis-bcagent-dev \
  --resource-group rg-BCAgentPrototype-data-dev \
  --set publicNetworkAccess=Enabled
```

#### 3.2 Verificar MCP Server

El MCP server funciona en local vía stdio transport (datos vendoreados en `backend/mcp-server/data/`):

**Nota**: Los datos del MCP server están vendoreados (no requiere build ni git submodule)

```bash
# Verificar que existan los archivos de datos
ls -la backend/mcp-server/data/v1.0/bc_index.json
ls -la backend/mcp-server/bcoas1.0.yaml

# Verificar contenido del índice
cat backend/mcp-server/data/v1.0/bc_index.json | head -20
```

**El MCP server vendoreado incluye**:
- ✅ bc_index.json con 324 endpoints indexados
- ✅ 52 entidades en data/v1.0/entities/ (customers, items, vendors, etc.)
- ✅ 57 schemas JSON en data/v1.0/schemas/
- ✅ bcoas1.0.yaml - OpenAPI spec completo (552KB)
- ✅ Total: ~1.4MB (sin dependencias npm, sin build step)

**Para verificar desde Azure**: El backend en Container Apps usará estos datos vendoreados (copiados en el Docker image durante build)

---

### 4. Secrets & Key Vault

#### 4.1 Listar Secrets en Key Vault

```bash
az keyvault secret list \
  --vault-name kv-bcagent-dev \
  --output table
```

**Secrets esperados** (8 secrets):
```
Name                        Enabled
--------------------------  -------
BC-TenantId                 True
BC-ClientId                 True
BC-ClientSecret             True
Claude-ApiKey               True
JWT-Secret                  True
SqlDb-ConnectionString      True
Redis-ConnectionString      True
Storage-ConnectionString    True
```

#### 4.2 Obtener un Secret

```bash
# Ejemplo: Obtener connection string de SQL
az keyvault secret show \
  --vault-name kv-bcagent-dev \
  --name SqlDb-ConnectionString \
  --query value \
  --output tsv
```

**Resultado esperado**:
```
Server=tcp:sqlsrv-bcagent-dev.database.windows.net,1433;Initial Catalog=sqldb-bcagent-dev;...
```

**Nota**: Tu identidad (Azure AD user) debe tener permisos de "Key Vault Secrets User" en el Key Vault.

#### 4.3 Verificar Managed Identities

```bash
# Listar managed identities
az identity list \
  --resource-group rg-BCAgentPrototype-sec-dev \
  --output table
```

**Resultado esperado**:
```
Name                       ResourceGroup                Location
-------------------------  ---------------------------  ----------
mi-bcagent-backend-dev     rg-BCAgentPrototype-sec-dev  westeurope
mi-bcagent-frontend-dev    rg-BCAgentPrototype-sec-dev  westeurope
```

#### 4.4 Verificar Access Policies del Key Vault

```bash
# Ver quién tiene acceso al Key Vault
az keyvault show \
  --name kv-bcagent-dev \
  --query properties.accessPolicies \
  --output json
```

Deberías ver:
- Tu usuario de Azure AD (todos los permisos)
- `mi-bcagent-backend-dev` (Get secrets)
- `mi-bcagent-frontend-dev` (Get secrets - si aplica)

---

## 🔗 Pruebas End-to-End

### Escenario 1: Create New Session & Send Message

**Pre-requisitos**:
- Backend corriendo en `localhost:3001`
- Frontend corriendo en `localhost:3000`
- Usuario registrado con token válido

**Pasos**:
1. Abrir http://localhost:3000
2. Click en "New Chat" en sidebar
3. Escribir mensaje: "What can you do?"
4. Click "Send"

**Resultado esperado**:
- [ ] Mensaje del usuario aparece en el chat
- [ ] Thinking indicator aparece ("Claude is thinking...")
- [ ] Respuesta del agente comienza a aparecer (streaming)
- [ ] Respuesta completa se muestra después de 3-5 segundos
- [ ] Nueva sesión aparece en sidebar

### Escenario 2: Query Business Central (Requires Azure Deployment)

**Nota**: Este test solo funciona si:
- Backend está desplegado en Azure Container Apps
- MCP server es accesible desde backend

**Pasos**:
1. Enviar mensaje: "List all customers in Business Central"
2. Esperar respuesta del agente

**Resultado esperado**:
- [ ] Agent usa el subagent `bc-query`
- [ ] Tool call a MCP: `bc_list_customers` (via stdio transport)
- [ ] Respuesta con lista de customers desde Business Central API
- [ ] Si hay error, mensaje descriptivo

### Escenario 3: Create Entity with Approval

**Pasos**:
1. Enviar mensaje: "Create a new customer called 'Acme Corp' with email acme@example.com"
2. Esperar approval dialog

**Resultado esperado**:
- [ ] Agent pausa y solicita aprobación
- [ ] Dialog automático aparece con:
  - Change summary: "Create Customer: Acme Corp"
  - Preview de datos a enviar
  - Botones: Approve / Reject
  - Countdown timer (30 segundos)
- [ ] Si apruebas: Customer se crea en BC
- [ ] Si rechazas: Operación se cancela

### Escenario 4: Todo List Tracking

**Pasos**:
1. Enviar mensaje complejo: "Create a customer named Test Corp, then find all items with price over $100"
2. Observar sidebar (Todo List section)

**Resultado esperado**:
- [ ] Agent genera plan automáticamente
- [ ] Todos aparecen en sidebar:
  - [ ] "Create customer Test Corp" (in_progress)
  - [ ] "Query items with price > $100" (pending)
- [ ] Cuando completa primer todo, marca como ✅ completed
- [ ] Segundo todo pasa a in_progress
- [ ] Progress bar actualiza en tiempo real

---

## 🔧 Troubleshooting

### Backend no inicia

**Error**: `Cannot connect to Azure SQL`

**Solución**:
1. Verifica firewall de SQL Server (ver sección 2.1)
2. Verifica connection string en `.env`:
   ```bash
   # Obtener del Key Vault
   az keyvault secret show --vault-name kv-bcagent-dev --name SqlDb-ConnectionString
   ```
3. Verifica que el password no tenga caracteres especiales sin escapar

**Error**: `Redis ECONNRESET`

**Solución**:
1. Verifica que Redis permita acceso público:
   ```bash
   az redis update --name redis-bcagent-dev --resource-group rg-BCAgentPrototype-data-dev --set publicNetworkAccess=Enabled
   ```
2. Verifica que tu IP esté en firewall rules
3. Verifica que uses puerto 6380 (SSL) en lugar de 6379

**Error**: `Key Vault access denied`

**Solución**:
1. Verifica que tu usuario tenga permisos:
   ```bash
   az keyvault set-policy \
     --name kv-bcagent-dev \
     --upn YOUR_EMAIL@yourdomain.com \
     --secret-permissions get list
   ```
2. O login con Azure CLI:
   ```bash
   az login
   ```

### Frontend no conecta al backend

**Error**: `WebSocket connection failed`

**Solución**:
1. Verifica que backend esté corriendo en puerto 3001
2. Verifica `.env.local`:
   ```env
   NEXT_PUBLIC_API_URL=http://localhost:3001
   NEXT_PUBLIC_WS_URL=ws://localhost:3001
   ```
3. Verifica CORS en backend (`server.ts`):
   ```typescript
   const io = new Server(server, {
     cors: {
       origin: "http://localhost:3000",
       credentials: true,
     },
   });
   ```

### Agent no responde

**Error**: `Claude API key invalid`

**Solución**:
1. Verifica que tienes API key en Key Vault:
   ```bash
   az keyvault secret show --vault-name kv-bcagent-dev --name Claude-ApiKey
   ```
2. Si no existe, créala:
   ```bash
   az keyvault secret set \
     --vault-name kv-bcagent-dev \
     --name Claude-ApiKey \
     --value "sk-ant-..."
   ```
3. Restart backend

**Error**: `MCP server not accessible` o `Master index not found`

**Solución**: Verificar que los datos vendoreados estén presentes:
```bash
# Verificar que exista el índice
ls -la backend/mcp-server/data/v1.0/bc_index.json

# Si no existe, los datos no se copiaron correctamente
# En desarrollo local, verificar que el directorio exista
ls -la backend/mcp-server/

# En Docker, verificar que el Dockerfile incluya:
# COPY mcp-server/data ./mcp-server/data
# COPY mcp-server/bcoas1.0.yaml ./mcp-server/bcoas1.0.yaml
```

**Nota**: Ya no se requiere `npm run index` porque bc_index.json está vendoreado (pre-generado).

---

## 📊 Checklist de Pruebas Completo

### Local - Backend
- [ ] Backend inicia sin errores
- [ ] `/health` retorna 200 OK
- [ ] `/api/auth/status` retorna configuración
- [ ] `/api/agent/status` retorna subagents configurados
- [ ] Register nuevo usuario funciona
- [ ] Login retorna tokens
- [ ] `/api/auth/me` retorna usuario autenticado
- [ ] Refresh token rotation funciona
- [ ] Logout revoca refresh token
- [ ] Protected endpoint sin token retorna 401
- [ ] Protected endpoint con token válido retorna 200

### Local - Frontend
- [ ] Frontend inicia en puerto 3000
- [ ] Build completa sin errores (`npm run build`)
- [ ] Lint pasa sin errores (`npm run lint`)
- [ ] Todos los componentes UI se renderizan correctamente
- [ ] WebSocket conecta al backend
- [ ] Dark mode funciona
- [ ] Responsive design funciona (desktop/tablet/mobile)
- [ ] Chat input funciona
- [ ] Sidebar colapsable funciona

### Local - WebSocket
- [ ] Test `test-websocket-connection.ts` pasa
- [ ] Test `test-chat-flow.ts` pasa
- [ ] Test `test-approval-flow.ts` pasa
- [ ] Test `test-approval-rejection.ts` pasa
- [ ] Test `test-todo-tracking.ts` pasa

### Azure - Infraestructura
- [ ] 3 Resource Groups existen
- [ ] Key Vault existe con 8 secrets
- [ ] SQL Server existe
- [ ] SQL Database existe con 11 tablas
- [ ] Redis Cache existe
- [ ] Storage Account existe
- [ ] Container Registry existe
- [ ] Container Apps Environment existe
- [ ] 2 Managed Identities existen

### Azure - Conectividad
- [ ] Puedes conectarte a Azure SQL desde local (firewall configurado)
- [ ] Redis responde a PING desde local
- [ ] Key Vault secrets son accesibles con `az keyvault secret show`
- [ ] Tu IP está en firewall de SQL Server

### Azure - Database
- [ ] 11 tablas existen en `sqldb-bcagent-dev`
- [ ] 3 usuarios de prueba existen
- [ ] Índices están creados correctamente
- [ ] Foreign keys funcionan (excepto las 4 tablas de observabilidad faltantes)

---

## 🚀 Next Steps

Una vez que todas las pruebas locales pasen:

1. **Week 7 - Task 7.1**: Complete end-to-end integration
   - Conectar todos los componentes
   - Error handling en toda la cadena

2. **Deploy to Azure** (Week 7-8):
   - Build Docker images
   - Push a Container Registry
   - Deploy Container Apps
   - Configure environment variables
   - Test desde Azure

3. **Phase 3** (Weeks 8-9):
   - Unit tests
   - Integration tests
   - E2E tests con Playwright
   - Performance optimization

---

**Última actualización**: 2025-11-10
**Autor**: Claude Code
**Versión**: 1.0
