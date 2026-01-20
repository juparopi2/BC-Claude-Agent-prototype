# Análisis del Sistema de Autenticación

## Resumen Ejecutivo

El sistema utiliza **Microsoft OAuth 2.0 (MSAL) con sesiones server-side** almacenadas en Redis. Aunque la arquitectura base es sólida y segura, existen problemas críticos en el manejo de expiración de tokens y la comunicación de estado al usuario.

---

## 0. Principios Arquitectónicos de Implementación

Este documento y el plan de mejoras siguen estrictamente los siguientes principios:

### 0.1 Screaming Architecture
- La estructura de carpetas debe "gritar" lo que hace el sistema
- Nuevos módulos en `domains/auth/` para lógica de negocio
- Servicios de infraestructura en `services/` o `infrastructure/`

### 0.2 Single Responsibility Principle (SRP)
- Cada archivo/clase/función tiene UNA sola responsabilidad
- **Evitar Godfiles**: `server.ts` (1314 líneas) debe ser refactorizado
- Extraer lógica de WebSocket auth a módulo dedicado

### 0.3 Tipado Estricto
- **NO `any`** - Usar `unknown` con validación Zod si es necesario
- Interfaces explícitas para todos los contratos
- Types compartidos en `@bc-agent/shared`

### 0.4 Constantes y No Magic Strings
```typescript
// ❌ MAL
if (status === 'expiring') { ... }
const interval = 60000;

// ✅ BIEN
import { AUTH_STATUS, AUTH_CONSTANTS } from './constants';
if (status === AUTH_STATUS.EXPIRING) { ... }
const interval = AUTH_CONSTANTS.HEALTH_POLL_INTERVAL_MS;
```

### 0.5 Test-Driven Development (TDD)
1. **RED**: Escribir test que falla
2. **GREEN**: Implementar código mínimo para pasar
3. **REFACTOR**: Limpiar sin romper tests

### 0.6 Modularización
- Funciones pequeñas y enfocadas
- Composición sobre herencia
- Dependency Injection donde sea posible

---

## 1. Estado Actual del Sistema

### 1.1 Arquitectura de Autenticación

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FLUJO DE LOGIN                                  │
└─────────────────────────────────────────────────────────────────────────────┘

  Browser                    Frontend                   Backend                  Microsoft
     │                          │                          │                        │
     │  Click "Login"           │                          │                        │
     │────────────────────────►│                          │                        │
     │                          │  redirect /api/auth/login│                        │
     │                          │─────────────────────────►│                        │
     │                          │                          │  Generate CSRF state   │
     │                          │                          │  Save to Redis session │
     │                          │                          │                        │
     │◄─────────────────────────────────────────────────────  302 Redirect         │
     │                                                                              │
     │  GET login.microsoftonline.com                                              │
     │─────────────────────────────────────────────────────────────────────────────►│
     │                                                                              │
     │◄───────────────────────────────────────────  302 + code + state             │
     │                                                                              │
     │  GET /api/auth/callback?code=xxx&state=yyy                                  │
     │──────────────────────────────────────────────►│                             │
     │                                               │  Validate CSRF state        │
     │                                               │  Exchange code → tokens     │
     │                                               │──────────────────────────────►
     │                                               │◄─ Access + Refresh tokens ──│
     │                                               │                             │
     │                                               │  Create/update user in DB   │
     │                                               │  Store session in Redis     │
     │                                               │  Set HTTP-only cookie       │
     │◄──────────────────────────────────────────────  302 → /new                 │
     │                                                                              │


┌─────────────────────────────────────────────────────────────────────────────┐
│                         ALMACENAMIENTO DE TOKENS                             │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌───────────────────────────────────────────────────────────────────────────┐
  │                              REDIS (Sessions)                              │
  │  ┌─────────────────────────────────────────────────────────────────────┐  │
  │  │  sess:{sessionId}                                                    │  │
  │  │  ├── microsoftOAuth.userId          → "A1B2C3D4-..."                │  │
  │  │  ├── microsoftOAuth.accessToken     → "eyJ0eXAi..."  (MS Graph)     │  │
  │  │  ├── microsoftOAuth.refreshToken    → "0.AXIA..."                   │  │
  │  │  ├── microsoftOAuth.tokenExpiresAt  → "2026-01-19T15:30:00Z"        │  │
  │  │  ├── microsoftOAuth.email           → "user@company.com"            │  │
  │  │  └── microsoftOAuth.displayName     → "John Doe"                    │  │
  │  └─────────────────────────────────────────────────────────────────────┘  │
  │                                                                            │
  │  TTL: 24 horas (configurable via SESSION_MAX_AGE)                         │
  └───────────────────────────────────────────────────────────────────────────┘

  ┌───────────────────────────────────────────────────────────────────────────┐
  │                           SQL Server (Users)                               │
  │  ┌─────────────────────────────────────────────────────────────────────┐  │
  │  │  users table                                                         │  │
  │  │  ├── bc_access_token_encrypted      → AES-256-GCM (BC API token)    │  │
  │  │  ├── bc_refresh_token_encrypted     → AES-256-GCM                   │  │
  │  │  └── bc_token_expires_at            → DateTime                      │  │
  │  └─────────────────────────────────────────────────────────────────────┘  │
  └───────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                     FLUJO DE REQUEST AUTENTICADO                             │
└─────────────────────────────────────────────────────────────────────────────┘

  Browser                    Backend Middleware                    MSAL
     │                              │                                │
     │  GET /api/protected          │                                │
     │  Cookie: connect.sid=xxx     │                                │
     │─────────────────────────────►│                                │
     │                              │                                │
     │                              │  Read session from Redis       │
     │                              │  Check tokenExpiresAt          │
     │                              │                                │
     │                    ┌─────────┴─────────┐                      │
     │                    │ Token expired?    │                      │
     │                    └─────────┬─────────┘                      │
     │                     YES      │       NO                       │
     │                    ┌─────────▼─────────┐                      │
     │                    │ Has refreshToken? │                      │
     │                    └─────────┬─────────┘                      │
     │                     YES      │       NO                       │
     │                              │  ──────────────────────────►   │
     │                              │  acquireTokenByRefreshToken    │
     │                              │  ◄──────────────────────────   │
     │                              │  New access + refresh tokens   │
     │                              │                                │
     │                              │  Update session in Redis       │
     │                              │  Continue to handler           │
     │                              │                                │
     │◄─────────────────────────────  Response                       │
     │                              │                                │


┌─────────────────────────────────────────────────────────────────────────────┐
│                       WEBSOCKET AUTHENTICATION                               │
└─────────────────────────────────────────────────────────────────────────────┘

  Browser                    Socket.IO Server                    Redis
     │                              │                              │
     │  WS Upgrade Request          │                              │
     │  Cookie: connect.sid=xxx     │                              │
     │─────────────────────────────►│                              │
     │                              │  Read session from Redis     │
     │                              │─────────────────────────────►│
     │                              │◄─────────────────────────────│
     │                              │                              │
     │                              │  Validate:                   │
     │                              │  - Session exists?           │
     │                              │  - Has userId?               │
     │                              │  - Token not expired?        │
     │                              │                              │
     │                    ┌─────────┴─────────┐                    │
     │                    │   Valid?          │                    │
     │                    └─────────┬─────────┘                    │
     │                     YES      │       NO                     │
     │                              │                              │
     │◄─────  WS Connected          │    WS Error: "Auth required" │
     │        socket.userId = xxx   │                              │
```

### 1.2 Componentes Clave

| Archivo | Propósito |
|---------|-----------|
| `backend/src/domains/auth/oauth/MicrosoftOAuthService.ts` | Cliente MSAL, refresh de tokens |
| `backend/src/domains/auth/auth-oauth.ts` | Rutas OAuth (login/callback/logout) |
| `backend/src/domains/auth/middleware/auth-oauth.ts` | Middleware de autenticación |
| `backend/src/services/auth/BCTokenManager.ts` | Encriptación y refresh de tokens BC |
| `backend/src/server.ts` | Configuración de sesión y auth de WebSocket |
| `frontend/src/domains/auth/stores/authStore.ts` | Estado de auth en Zustand |
| `frontend/src/infrastructure/api/httpClient.ts` | Cliente HTTP con credentials |
| `frontend/src/infrastructure/socket/SocketClient.ts` | Cliente WebSocket |

---

## 2. Problemas Identificados

### 2.1 🔴 CRÍTICO: Sin Feedback Visual de Expiración

**Problema**: El frontend NO sabe cuándo expira el token.

```typescript
// authStore.ts - Solo guarda user y isAuthenticated
checkAuth: async () => {
  const result = await api.checkAuth();
  set({
    isAuthenticated: authenticated,
    user: user || null,
    // ❌ NO HAY tokenExpiresAt
  });
}
```

**Impacto**:
- Usuario piensa que está logueado cuando el token ya expiró
- Operaciones fallan silenciosamente
- No hay advertencia "Tu sesión expira en 5 minutos"

### 2.2 ✅ RESUELTO: 401 Ahora Se Distingue Como Error

**Problema Original**: El frontend trataba 401 como éxito con `authenticated: false`.

**Solución Implementada** (`httpClient.ts`):
```typescript
// 401 = not authenticated - return as error with code from backend
if (response.status === 401) {
  const errorData = await response.json().catch(() => ({}));

  if (isApiErrorResponse(errorData)) {
    return { success: false, error: errorData };
  }

  return {
    success: false,
    error: {
      error: 'Unauthorized',
      message: 'Authentication required',
      code: ErrorCode.UNAUTHORIZED,
    },
  };
}
```

**AuthStore** ahora incluye `authFailureReason`:
```typescript
type AuthFailureReason = 'session_expired' | 'not_authenticated' | 'network_error' | null;

// checkAuth() determina la razón basándose en error.code:
// - SESSION_EXPIRED → 'session_expired'
// - UNAUTHORIZED → 'not_authenticated'
// - SERVICE_UNAVAILABLE → 'network_error'
```

**Login Page** muestra mensajes contextuales:
- Sesión expirada: Banner amber con "Tu sesión ha expirado"
- Error de red: Banner rojo con "No se pudo conectar al servidor"

### 2.3 🔴 CRÍTICO: WebSocket No Refresca Tokens

**Problema**: El middleware de WebSocket verifica expiración pero NO intenta refresh.

```typescript
// server.ts - WebSocket auth
if (oauthSession.tokenExpiresAt && new Date(oauthSession.tokenExpiresAt) <= new Date()) {
  return next(new Error('Session expired'));  // ❌ No intenta refresh
}
```

**Impacto**:
- WebSocket se desconecta cuando el token expira
- Operaciones en progreso (como chat) fallan
- Usuario debe recargar la página

### 2.4 🟠 ALTO: Token BC No Se Auto-Refresca

**Problema**: El middleware `requireBCAccess` NO intenta refresh de tokens BC.

```typescript
// auth-oauth.ts
if (expiresAt <= now) {
  logger.warn('Business Central token expired', { userId });
  sendError(res, ErrorCode.SESSION_EXPIRED, 'Your BC token has expired...');
  return;  // ❌ No intenta refresh
}
```

**Impacto**:
- Usuario debe re-consentir manualmente para BC
- Experiencia asimétrica (MS tokens se refrescan, BC no)

### 2.5 🟠 ALTO: Operaciones Background Sin Revalidación de Auth

**Problema**: Jobs de BullMQ (file processing, etc.) usan `userId` sin verificar si la sesión sigue activa.

```typescript
// BulkUploadProcessor.ts
async process(job: BulkUploadJobData): Promise<BulkUploadProcessorResult> {
  const { userId, files } = job.data;
  // ❌ Directamente usa userId sin verificar sesión
}
```

**Impacto**:
- Archivos pueden procesarse después de que el usuario cerró sesión
- Potencial problema de seguridad/compliance

### 2.6 🟠 ALTO: Fallos Silenciosos en Fire-and-Forget

**Problema**: Operaciones asíncronas (tracking, file processing) fallan silenciosamente.

```typescript
// files.ts
usageTrackingService.trackFileUpload(userId, fileId, file.size, {...})
  .catch((err) => {
    logger.warn({ err }, 'Failed to track file upload');  // Solo log
  });
```

**Impacto**:
- Usuario ve "processing" eternamente
- No hay manera de saber que algo falló

### 2.7 🟡 MEDIO: Race Condition en Refresh de Token

**Problema**: Múltiples requests concurrentes pueden disparar refresh simultáneos.

```typescript
// auth-oauth.ts middleware
// Si llegan 5 requests al mismo tiempo con token expirado,
// los 5 pueden intentar refresh antes de que el primero guarde la sesión
```

**Impacto**:
- Tokens podrían sobreescribirse
- Potencial inconsistencia de sesión

### 2.8 🟡 MEDIO: Ventana de Refresh Muy Ajustada

**Problema**: Tokens BC se refrescan solo cuando expiran (no antes).

```typescript
// BCTokenManager.ts
const shouldRefresh = !expiresAt || expiresAt <= now ||
  expiresAt.getTime() - now.getTime() < 5 * 60 * 1000;  // 5 min buffer
```

**Impacto**:
- Si request toma >5 minutos, token puede expirar mid-request
- Debería ser 10-15 minutos

---

## 3. Mapa del Servicio Actual vs Recomendado

### 3.1 Estado Actual

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PROBLEMAS ACTUALES                                    │
└─────────────────────────────────────────────────────────────────────────────┘

  Frontend                                          Backend
  ┌────────────────────────────┐                   ┌────────────────────────┐
  │  AuthStore                 │                   │  Auth Middleware       │
  │  ├── user                  │                   │  ├── Auto-refresh ✅   │
  │  ├── isAuthenticated       │                   │  └── Save session ✅   │
  │  └── ❌ NO tokenExpiresAt  │                   └────────────────────────┘
  │                            │
  │  ❌ No warnings de         │                   ┌────────────────────────┐
  │     expiración             │                   │  WebSocket Auth        │
  │  ❌ 401 = "no logged in"   │                   │  ├── Check expiry ✅   │
  │     (no "session expired") │                   │  └── ❌ NO auto-refresh│
  └────────────────────────────┘                   └────────────────────────┘
         │
         │  HTTP Request                           ┌────────────────────────┐
         │  (cookie automático)                    │  BC Token Manager      │
         ▼                                         │  ├── Encrypt ✅        │
  ┌────────────────────────────┐                   │  ├── Dedupe refresh ✅ │
  │  HttpClient                │                   │  └── ❌ 5min buffer    │
  │  ├── credentials:include ✅│                   │      (debería ser 15)  │
  │  └── ❌ No retry on 401    │                   └────────────────────────┘
  └────────────────────────────┘
                                                   ┌────────────────────────┐
  ┌────────────────────────────┐                   │  Background Jobs       │
  │  SocketClient              │                   │  ├── ❌ No auth check  │
  │  ├── withCredentials ✅    │                   │  └── ❌ Silent failures│
  │  ├── reconnection ✅       │                   └────────────────────────┘
  │  └── ❌ No re-auth on      │
  │        reconnect           │
  └────────────────────────────┘
```

### 3.2 Estado Recomendado

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ARQUITECTURA MEJORADA                                 │
└─────────────────────────────────────────────────────────────────────────────┘

  Frontend                                          Backend
  ┌────────────────────────────┐                   ┌────────────────────────┐
  │  AuthStore                 │                   │  Auth Middleware       │
  │  ├── user                  │                   │  ├── Auto-refresh ✅   │
  │  ├── isAuthenticated       │                   │  ├── Mutex para refresh│
  │  ├── ✅ tokenExpiresAt     │◄──────────────────│  │   (prevent race)    │
  │  ├── ✅ sessionExpiresAt   │                   │  └── Return tokenExpiry│
  │  └── ✅ refreshBuffer (5m) │                   └────────────────────────┘
  │                            │
  │  ✅ Proactive refresh      │                   ┌────────────────────────┐
  │  ✅ Warning banners        │                   │  WebSocket Auth        │
  │  ✅ Session timeout modal  │                   │  ├── Check expiry ✅   │
  └────────────────────────────┘                   │  ├── ✅ Auto-refresh   │
         │                                         │  └── ✅ Emit auth:expir│
         │  HTTP Request                           └────────────────────────┘
         ▼
  ┌────────────────────────────┐                   ┌────────────────────────┐
  │  HttpClient                │                   │  BC Token Manager      │
  │  ├── credentials:include ✅│                   │  ├── Encrypt ✅        │
  │  ├── ✅ Interceptor 401    │                   │  ├── Dedupe refresh ✅ │
  │  │     → proactive refresh │                   │  ├── ✅ 15min buffer   │
  │  └── ✅ Retry with backoff │                   │  └── ✅ Auto-refresh   │
  └────────────────────────────┘                   │      in middleware     │
                                                   └────────────────────────┘
  ┌────────────────────────────┐
  │  SocketClient              │                   ┌────────────────────────┐
  │  ├── withCredentials ✅    │                   │  Background Jobs       │
  │  ├── reconnection ✅       │                   │  ├── ✅ Auth checkpoint│
  │  ├── ✅ Listen auth:expire │                   │  ├── ✅ Fail loudly    │
  │  └── ✅ Re-auth on         │                   │  └── ✅ Notify user    │
  │        reconnect           │                   └────────────────────────┘
  └────────────────────────────┘

  ┌────────────────────────────────────────────────────────────────────────────┐
  │                           NUEVO: Session Health Monitor                     │
  │  ┌──────────────────────────────────────────────────────────────────────┐  │
  │  │  Frontend (useSessionHealth hook)                                     │  │
  │  │  ├── Poll /api/auth/health cada 60s                                  │  │
  │  │  ├── Mostrar banner "Tu sesión expira en X minutos"                  │  │
  │  │  ├── Intentar refresh proactivo 5min antes de expirar                │  │
  │  │  └── Mostrar modal "Sesión expirada" con botón de re-login           │  │
  │  └──────────────────────────────────────────────────────────────────────┘  │
  └────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Plan de Mejoras Recomendado

### Fase 1: Quick Wins (Esfuerzo Bajo, Alto Impacto)

#### 1.1 Exponer `tokenExpiresAt` al Frontend ✅ COMPLETADO

**Cambios Backend** (`auth-oauth.ts`):
```typescript
// GET /api/auth/me - Incluir expiry
router.get('/me', authenticateMicrosoft, (req, res) => {
  res.json({
    authenticated: true,
    user: {
      id: req.session.microsoftOAuth.userId,
      email: req.session.microsoftOAuth.email,
      displayName: req.session.microsoftOAuth.displayName,
    },
    tokenExpiresAt: req.session.microsoftOAuth.tokenExpiresAt,  // ✅ NUEVO
    sessionExpiresAt: new Date(Date.now() + SESSION_MAX_AGE).toISOString(),  // ✅ NUEVO
  });
});
```

**Cambios Frontend** (`authStore.ts`):
```typescript
interface AuthState {
  user: UserProfile | null;
  isAuthenticated: boolean;
  tokenExpiresAt: string | null;      // ✅ NUEVO
  sessionExpiresAt: string | null;    // ✅ NUEVO
}
```

**Esfuerzo**: ~2-4 horas

#### 1.2 Distinguir 401 vs "No Autenticado" ✅ COMPLETADO

**Cambios Implementados**:

1. **`httpClient.ts`** - `checkAuth()` ahora retorna `success: false` para 401:
   ```typescript
   if (response.status === 401) {
     const errorData = await response.json().catch(() => ({}));
     if (isApiErrorResponse(errorData)) {
       return { success: false, error: errorData };
     }
     return {
       success: false,
       error: { error: 'Unauthorized', message: 'Authentication required', code: ErrorCode.UNAUTHORIZED },
     };
   }
   ```

2. **`authStore.ts`** - Nuevo campo `authFailureReason`:
   ```typescript
   export type AuthFailureReason = 'session_expired' | 'not_authenticated' | 'network_error' | null;

   // En checkAuth(), se determina la razón:
   if (result.error.code === ErrorCode.SESSION_EXPIRED) authFailureReason = 'session_expired';
   else if (result.error.code === ErrorCode.SERVICE_UNAVAILABLE) authFailureReason = 'network_error';
   else authFailureReason = 'not_authenticated';
   ```

3. **`login/page.tsx`** - Mensajes contextuales con iconos:
   - `session_expired`: Banner amber "Sesión Expirada - Tu sesión ha expirado..."
   - `network_error`: Banner rojo "Error de Conexión - No se pudo conectar..."

**Esfuerzo**: ~1-2 horas

#### 1.3 Banner de Advertencia de Expiración ✅ COMPLETADO

**Implementado en** `frontend/components/auth/SessionExpiryBanner.tsx`:
```tsx
export function SessionExpiryBanner() {
  const { tokenExpiresAt } = useAuthStore();
  const [minutesLeft, setMinutesLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!tokenExpiresAt) return;

    const interval = setInterval(() => {
      const diff = new Date(tokenExpiresAt).getTime() - Date.now();
      setMinutesLeft(Math.max(0, Math.floor(diff / 60000)));
    }, 30000);

    return () => clearInterval(interval);
  }, [tokenExpiresAt]);

  if (!minutesLeft || minutesLeft > 5) return null;

  return (
    <div className="bg-yellow-100 border-yellow-400 text-yellow-700 p-2 text-center">
      Tu sesión expira en {minutesLeft} minutos.
      <button onClick={refreshSession} className="underline ml-2">
        Extender sesión
      </button>
    </div>
  );
}
```

**Esfuerzo**: ~4-6 horas

### Fase 2: Mejoras de Robustez (Esfuerzo Medio)

#### 2.1 Auto-Refresh en WebSocket ✅ COMPLETADO

**Implementado en** `backend/src/domains/auth/websocket/socket-auth.middleware.ts`:
```typescript
io.use(async (socket, next) => {
  const req = socket.request as express.Request;
  const session = req.session?.microsoftOAuth;

  if (!session) {
    return next(new Error('Authentication required'));
  }

  // ✅ NUEVO: Intentar refresh si expirado
  if (new Date(session.tokenExpiresAt) <= new Date()) {
    try {
      const refreshed = await oauthService.refreshAccessToken(session.refreshToken);
      req.session.microsoftOAuth = {
        ...session,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        tokenExpiresAt: refreshed.expiresAt.toISOString(),
      };
      await saveSession(req.session);
    } catch (err) {
      return next(new Error('Session expired - please login again'));
    }
  }

  (socket as AuthenticatedSocket).userId = session.userId;
  next();
});
```

**Esfuerzo**: ~4-6 horas

#### 2.2 Endpoint de Health Check para Auth ✅ COMPLETADO

**Implementado en** `backend/src/domains/auth/health/auth-health.routes.ts`:
```typescript
router.get('/health', authenticateMicrosoftOptional, (req, res) => {
  const session = req.session?.microsoftOAuth;

  if (!session) {
    return res.json({ status: 'unauthenticated' });
  }

  const now = Date.now();
  const tokenExpiry = new Date(session.tokenExpiresAt).getTime();
  const sessionExpiry = now + SESSION_MAX_AGE;

  res.json({
    status: 'authenticated',
    tokenExpiresAt: session.tokenExpiresAt,
    tokenExpiresIn: Math.max(0, tokenExpiry - now),  // milliseconds
    sessionExpiresAt: new Date(sessionExpiry).toISOString(),
    sessionExpiresIn: SESSION_MAX_AGE,
    needsRefresh: tokenExpiry - now < 5 * 60 * 1000,  // <5 min
  });
});
```

**Esfuerzo**: ~2-3 horas

#### 2.3 Hook de Session Health en Frontend ✅ COMPLETADO

**Implementado en** `frontend/src/domains/auth/hooks/useSessionHealth.ts`:
```typescript
export function useSessionHealth() {
  const [health, setHealth] = useState<SessionHealth | null>(null);
  const { logout } = useAuthStore();

  useEffect(() => {
    const checkHealth = async () => {
      const response = await fetch('/api/auth/health', { credentials: 'include' });
      const data = await response.json();

      setHealth(data);

      // Auto-logout si sesión expirada
      if (data.status === 'unauthenticated') {
        logout();
      }

      // Proactive refresh si necesita
      if (data.needsRefresh) {
        await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 60000);  // Check cada 1 min

    return () => clearInterval(interval);
  }, []);

  return health;
}
```

**Esfuerzo**: ~4-6 horas

### Fase 3: Mejoras Avanzadas (Esfuerzo Alto)

#### 3.1 Auto-Refresh de Tokens BC en Middleware

**Cambios** (`auth-oauth.ts`):
```typescript
export async function requireBCAccess(req, res, next) {
  const userId = req.userId;
  const bcTokenManager = getBCTokenManager();

  try {
    // ✅ NUEVO: Intentar obtener token (auto-refresh incluido)
    const token = await bcTokenManager.getBCToken(
      userId,
      req.session.microsoftOAuth.refreshToken
    );

    req.bcAccessToken = token.accessToken;
    next();
  } catch (err) {
    // Si falla refresh, pedir re-consent
    sendError(res, ErrorCode.BC_CONSENT_REQUIRED, 'Please re-authorize BC access', {
      consentUrl: '/api/auth/bc-consent',
    });
  }
}
```

**Esfuerzo**: ~6-8 horas

#### 3.2 Mutex para Refresh de Tokens (Prevenir Race Conditions)

**Nueva utilidad** (`TokenRefreshMutex.ts`):
```typescript
class TokenRefreshMutex {
  private locks = new Map<string, Promise<void>>();

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // Esperar si ya hay un refresh en progreso
    while (this.locks.has(key)) {
      await this.locks.get(key);
    }

    // Crear nuevo lock
    let resolve: () => void;
    const lock = new Promise<void>(r => { resolve = r; });
    this.locks.set(key, lock);

    try {
      return await fn();
    } finally {
      this.locks.delete(key);
      resolve!();
    }
  }
}

export const tokenRefreshMutex = new TokenRefreshMutex();
```

**Uso en middleware**:
```typescript
const refreshed = await tokenRefreshMutex.withLock(
  `refresh:${userId}`,
  () => oauthService.refreshAccessToken(refreshToken)
);
```

**Esfuerzo**: ~4-6 horas

#### 3.3 Notificación de Jobs Fallidos al Usuario

**Cambios en BullMQ workers**:
```typescript
// En cualquier processor que falle
async process(job) {
  try {
    // ... processing
  } catch (error) {
    // ✅ NUEVO: Notificar al usuario via WebSocket
    const socketService = getSocketService();
    await socketService.emitToUser(job.data.userId, 'job:failed', {
      jobId: job.id,
      type: job.name,
      error: error.message,
    });

    throw error;  // Re-throw para que BullMQ maneje retry
  }
}
```

**Esfuerzo**: ~8-12 horas (incluye sistema de notificaciones)

---

## 5. Estimación de Esfuerzo Total

| Fase | Descripción | Esfuerzo | Prioridad | Estado |
|------|-------------|----------|-----------|--------|
| **1.1** | Exponer tokenExpiresAt | 2-4h | 🔴 Crítica | ✅ Completado |
| **1.2** | Distinguir 401 vs no-auth | 1-2h | 🔴 Crítica | ✅ Completado |
| **1.3** | Banner de advertencia | 4-6h | 🔴 Crítica | ✅ Completado |
| **2.1** | Auto-refresh en WebSocket | 4-6h | 🟠 Alta | ✅ Completado |
| **2.2** | Endpoint health check | 2-3h | 🟠 Alta | ✅ Completado |
| **2.3** | Hook useSessionHealth | 4-6h | 🟠 Alta | ✅ Completado |
| **3.1** | Auto-refresh tokens BC | 6-8h | 🟡 Media | ⏳ Pendiente |
| **3.2** | Mutex para refresh | 4-6h | 🟡 Media | ⏳ Pendiente |
| **3.3** | Notificación jobs fallidos | 8-12h | 🟡 Media | ⏳ Pendiente |

**Total Fase 1 (Quick Wins)**: ~7-12 horas
**Total Fase 2 (Robustez)**: ~10-15 horas
**Total Fase 3 (Avanzado)**: ~18-26 horas

**Total General**: ~35-53 horas de desarrollo

---

## 6. Recomendación de Implementación

### Prioridad Inmediata (Resolver los síntomas principales)

1. **Fase 1 completa** - Soluciona el problema de "usuario piensa que está logueado"
2. **2.2 + 2.3** - Health check + hook para monitoreo proactivo

Con esto (unas 17-23 horas) se resuelven los problemas principales:
- ✅ Usuario sabe cuándo expira su sesión
- ✅ Banner de advertencia antes de expirar
- ✅ Errores claros cuando la sesión expira
- ✅ Monitoreo proactivo de salud de sesión

### Siguiente Iteración

- **2.1** - Auto-refresh en WebSocket
- **3.2** - Mutex para race conditions

### Fase Final

- **3.1** - Auto-refresh de BC tokens
- **3.3** - Notificaciones de jobs fallidos

---

## 7. Consideraciones Adicionales

### 7.1 Localhost vs Producción

En desarrollo local, los tokens de Microsoft tienen el mismo lifetime que en producción (~1 hora). Sin embargo:

- **Cookies `secure`**: En localhost con HTTP, las cookies no se marcan como `secure`
- **CORS**: Puede haber issues con `credentials: include` si los origins no coinciden
- **Redis**: Si Redis se reinicia, todas las sesiones se pierden

**Recomendación**: Agregar logging detallado en desarrollo para ver cuando ocurren refreshes y expiraciones.

### 7.2 Tokens de Microsoft

- **Access Token**: ~1 hora de vida (no configurable)
- **Refresh Token**: ~90 días de vida (se extiende con uso)
- **Refresh Token inactivo >90 días**: Expira, usuario debe re-autenticar

### 7.3 Sesiones Largas Inactivas

Si un usuario deja la pestaña abierta por días:
1. Access token expira (~1h)
2. Middleware intenta refresh con refresh token
3. Si refresh token válido, obtiene nuevo access token
4. Si refresh token expirado (>90 días), 401 → re-login

El problema actual es que el frontend no detecta esto hasta que hace una request.

---

## 8. Conclusión

El sistema de autenticación actual es **arquitecturalmente sólido** (session-based, tokens server-side, CSRF protection).

### Estado Actual del Progreso

**✅ Fases 1 y 2 COMPLETADAS** - Problemas principales resueltos:
1. ~~Frontend ciego al estado de tokens~~ → **RESUELTO**: `tokenExpiresAt` y `sessionExpiresAt` expuestos
2. ~~Fallos silenciosos~~ → **RESUELTO**: 401 ahora retorna `success: false` con `authFailureReason`
3. ~~WebSocket sin auto-refresh~~ → **RESUELTO**: Auto-refresh implementado en middleware
4. **Operaciones background sin validación** - Pendiente (Fase 3)

### Problemas Resueltos
- ✅ Usuario sabe cuándo expira su sesión (`tokenExpiresAt`, `sessionExpiresAt`)
- ✅ Banner de advertencia antes de expirar (`SessionExpiryBanner`)
- ✅ Errores claros cuando la sesión expira (`authFailureReason`: session_expired/not_authenticated/network_error)
- ✅ Monitoreo proactivo de salud de sesión (`useSessionHealth` hook)
- ✅ WebSocket se recupera automáticamente con auto-refresh

### Pendiente (Fase 3 - Opcional)
- Auto-refresh de tokens BC en middleware
- Mutex para prevenir race conditions en refresh
- Notificaciones de jobs fallidos al usuario

La Fase 3 es opcional pero mejora significativamente la robustez del sistema.
