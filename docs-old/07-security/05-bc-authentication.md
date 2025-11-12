# Business Central Authentication

## Overview

El sistema utiliza **OAuth 2.0 Authorization Code Flow con Delegated Permissions** para acceder a Business Central. Esto significa que cada usuario autentica con su cuenta Microsoft y otorga permisos a la aplicación para actuar en su nombre.

**Cambio importante**: Ya NO usamos OAuth 2.0 Client Credentials (service-to-service authentication). Ahora usamos delegated permissions para que las operaciones en Business Central se ejecuten en nombre del usuario real.

---

## Flujo de Autenticación

### 1. User Login (Microsoft OAuth)

```
Usuario → "Sign in with Microsoft" → Microsoft Entra ID →
Consent Screen → Authorization Code → Backend Exchange →
Access Token + Refresh Token → Stored Encrypted in DB
```

**Scopes solicitados**:
- `openid` - Autenticación básica
- `profile` - Perfil del usuario
- `email` - Email del usuario
- `offline_access` - Refresh tokens para renovación automática
- `User.Read` - Leer perfil de Microsoft Graph
- `https://api.businesscentral.dynamics.com/Financials.ReadWrite.All` - **Acceso completo a BC (delegated)**

### 2. BC Token Acquisition

Después del login con Microsoft, el backend obtiene un token específico para Business Central:

```typescript
// MicrosoftOAuthService.ts
async acquireBCToken(userAccessToken: string): Promise<BCTokenData> {
  const result = await msalClient.acquireTokenOnBehalfOf({
    oboAssertion: userAccessToken,
    scopes: ['https://api.businesscentral.dynamics.com/Financials.ReadWrite.All']
  });

  return {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresAt: new Date(Date.now() + result.expiresIn * 1000)
  };
}
```

### 3. Token Storage (Encrypted)

Los tokens BC se almacenan cifrados en la base de datos por usuario:

```sql
-- Tabla users
CREATE TABLE users (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  email NVARCHAR(255) NOT NULL,
  microsoft_user_id NVARCHAR(255) UNIQUE NOT NULL,
  bc_access_token_encrypted NVARCHAR(MAX) NULL,  -- AES-256-GCM encrypted
  bc_refresh_token_encrypted NVARCHAR(MAX) NULL, -- AES-256-GCM encrypted
  bc_token_expires_at DATETIME2 NULL,
  ...
);
```

**Cifrado**: AES-256-GCM con encryption key almacenada en Azure Key Vault.

---

## Uso en BCClient

### Constructor con Token Delegado

```typescript
// backend/src/services/bc/BCClient.ts
class BCClient {
  constructor(
    private userAccessToken: string,  // Token del usuario (NO de env vars)
    private apiUrl: string
  ) {}

  private getHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.userAccessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  }

  async query<T>(entity: string, options?: BCQueryOptions): Promise<BCApiResponse<T>> {
    // Token viene del usuario, no hay authenticate() method
    const response = await fetch(`${this.apiUrl}/${entity}`, {
      headers: this.getHeaders(),
      ...
    });
    return response.json();
  }
}
```

### Integración con AgentService

```typescript
// backend/src/services/agent/DirectAgentService.ts
async query(userId: string, sessionId: string, prompt: string) {
  // 1. Obtener BC token del usuario (descifrado)
  const bcTokens = await bcTokenManager.getBCTokens(userId);

  if (!bcTokens) {
    throw new Error('User has not granted BC consent');
  }

  // 2. Verificar si token expiró y refresh si es necesario
  if (bcTokens.expiresAt < new Date()) {
    await bcTokenManager.refreshBCToken(userId);
    bcTokens = await bcTokenManager.getBCTokens(userId);
  }

  // 3. Crear BCClient con token delegado del usuario
  const bcClient = new BCClient(bcTokens.accessToken, process.env.BC_API_URL!);

  // 4. Ejecutar query
  const result = await bcClient.query('customers', { $top: 10 });
  return result;
}
```

---

## Token Lifecycle

### Token Expiration

- **Access Token BC**: Expira cada ~1 hora
- **Refresh Token BC**: Expira cada 90 días (configurable en Azure AD)

### Auto-Refresh Flow

```typescript
// BCTokenManager.ts
async refreshBCToken(userId: string): Promise<void> {
  // 1. Obtener refresh token cifrado de BD
  const user = await db.query('SELECT bc_refresh_token_encrypted FROM users WHERE id = ?', [userId]);
  const refreshToken = await encryptionService.decrypt(user.bc_refresh_token_encrypted);

  // 2. Intercambiar refresh token por nuevo access token
  const newTokens = await microsoftOAuthService.refreshAccessToken(refreshToken);

  // 3. Guardar nuevos tokens cifrados en BD
  await this.storeBCTokens(userId, newTokens);
}
```

**Auto-refresh automático**: El middleware `requireBCToken` verifica expiración antes de cada operación BC:

```typescript
// backend/src/middleware/auth-microsoft.ts
export async function requireBCToken(req, res, next) {
  const userId = req.user.id;
  const user = await db.query('SELECT bc_token_expires_at FROM users WHERE id = ?', [userId]);

  // Si token expiró, auto-refresh
  if (user.bc_token_expires_at && user.bc_token_expires_at < new Date()) {
    await bcTokenManager.refreshBCToken(userId);
  }

  // Obtener token descifrado y adjuntar a request
  const bcTokens = await bcTokenManager.getBCTokens(userId);
  req.bcToken = bcTokens.accessToken;

  next();
}
```

### Token Revocation (Logout)

```typescript
// Cuando usuario hace logout
async logout(userId: string): Promise<void> {
  // 1. Eliminar tokens BC de BD
  await bcTokenManager.revokeBCTokens(userId);

  // 2. Destruir session
  req.session.destroy();

  // 3. Optional: revocar tokens en Microsoft
  // (Microsoft puede revocarlos automáticamente al destruir la session)
}
```

---

## Delegated Permissions vs Client Credentials

### Antes (Client Credentials) ❌

```typescript
// Todos los usuarios usaban las MISMAS credenciales
const bcClient = new BCClient();  // Lee BC_CLIENT_ID y BC_CLIENT_SECRET de .env

// Problema: BC registra todas las operaciones como "Service Account"
// No hay audit trail de qué usuario real hizo cada cambio
```

### Ahora (Delegated Permissions) ✅

```typescript
// Cada usuario usa SUS PROPIAS credenciales
const bcClient = new BCClient(userAccessToken, apiUrl);

// Ventaja: BC registra operaciones con el usuario real
// Audit trail completo: "John Doe creó customer X"
```

---

## Consent Screen

### Primera vez que usuario hace login

Microsoft muestra una pantalla de consentimiento solicitando permisos:

```
BC Claude Agent needs permission to:

✓ Sign you in and read your profile
✓ Read your email address
✓ Maintain access to data you have given it access to
✓ Access Dynamics 365 Business Central on your behalf
  (Read and write your Business Central data)

[Accept] [Cancel]
```

**Admin Consent**: Si un administrador de Azure AD ejecuta "Grant admin consent", todos los usuarios del tenant obtienen los permisos automáticamente sin ver la pantalla.

### Re-consentimiento

Si el usuario revoca permisos en https://myaccount.microsoft.com/, la aplicación detecta el error y muestra `ConsentDialog`:

```typescript
// Frontend: ConsentDialog.tsx
<AlertDialog>
  <AlertDialogTitle>Business Central Access Required</AlertDialogTitle>
  <AlertDialogDescription>
    To perform write operations in Business Central, you need to grant
    additional permissions. You'll be redirected to Microsoft to authorize
    this application.
  </AlertDialogDescription>
  <AlertDialogAction onClick={requestBCConsent}>
    Grant Access
  </AlertDialogAction>
</AlertDialog>
```

---

## Security Considerations

### 1. Token Storage

- ✅ **Cifrado AES-256-GCM** para access y refresh tokens
- ✅ **Encryption key en Azure Key Vault**, no en código
- ✅ **IV (Initialization Vector) aleatorio** por cada token cifrado
- ✅ **Auth tag verificado** en cada descifrado (integridad)

### 2. Token Transmission

- ✅ **HTTPS obligatorio** en producción
- ✅ **HttpOnly cookies** para session management
- ✅ **Secure flag** en cookies (solo HTTPS)
- ✅ **SameSite=Strict** para prevenir CSRF

### 3. Token Rotation

- ✅ **Auto-refresh antes de expiración** (5 minutos antes)
- ✅ **Refresh token rotation**: nuevo refresh token en cada renovación
- ✅ **Revocación inmediata** al logout

### 4. Audit Logging

Todas las operaciones de autenticación se registran:

```sql
-- Tabla audit_log
INSERT INTO audit_log (user_id, event_type, details) VALUES
  (?, 'user_logged_in', '{"microsoft_user_id": "..."}'),
  (?, 'bc_token_acquired', '{"expires_at": "2025-11-12T10:00:00Z"}'),
  (?, 'bc_token_refreshed', '{"old_expires_at": "...", "new_expires_at": "..."}'),
  (?, 'user_logged_out', '{"tokens_revoked": true}');
```

---

## Error Handling

### Common OAuth Errors

#### 1. `consent_required`

**Causa**: Usuario no ha dado consentimiento para acceder a BC.

**Solución**:
```typescript
if (error.code === 'consent_required') {
  // Redirect a consent endpoint
  return res.redirect('/api/auth/bc-consent');
}
```

#### 2. `invalid_grant`

**Causa**: Refresh token expiró o fue revocado.

**Solución**:
```typescript
if (error.code === 'invalid_grant') {
  // Forzar re-login
  await bcTokenManager.revokeBCTokens(userId);
  return res.status(401).json({ error: 'Re-authentication required' });
}
```

#### 3. `interaction_required`

**Causa**: Microsoft requiere MFA u otra interacción del usuario.

**Solución**:
```typescript
if (error.code === 'interaction_required') {
  // Redirect a Microsoft login
  return res.redirect('/api/auth/login');
}
```

#### 4. `insufficient_permissions`

**Causa**: Token BC no tiene permisos suficientes para la operación.

**Solución**:
- Verificar que app registration tenga scope `Financials.ReadWrite.All`
- Verificar que admin consent fue otorgado
- Verificar permisos del usuario en BC

---

## Multi-Tenant Support

Cada usuario puede tener credenciales de **diferentes tenants** de Business Central:

```typescript
// Usuario A: Tenant "Contoso Ltd"
const userA = await db.query('SELECT * FROM users WHERE id = ?', [userIdA]);
// bc_access_token_encrypted contiene token para tenant A

// Usuario B: Tenant "Fabrikam Inc"
const userB = await db.query('SELECT * FROM users WHERE id = ?', [userIdB]);
// bc_access_token_encrypted contiene token para tenant B

// Aislamiento garantizado: cada BCClient usa su propio token
const bcClientA = new BCClient(userA.bcAccessToken, BC_API_URL);
const bcClientB = new BCClient(userB.bcAccessToken, BC_API_URL);
```

---

## Testing

### Manual Testing

1. **Login con Microsoft**:
   ```bash
   curl http://localhost:3002/api/auth/login
   # Redirect a login.microsoftonline.com
   ```

2. **Verificar token BC en BD**:
   ```sql
   SELECT
     email,
     microsoft_user_id,
     CASE WHEN bc_access_token_encrypted IS NOT NULL THEN 'YES' ELSE 'NO' END AS has_bc_token,
     bc_token_expires_at
   FROM users
   WHERE id = '<user-id>';
   ```

3. **Test BC query con token delegado**:
   ```bash
   # En la UI del agente
   > List all customers

   # Verificar en backend logs:
   # "BCClient using delegated token for user john.doe@contoso.com"
   ```

4. **Test token refresh**:
   ```sql
   -- Simular token expirado
   UPDATE users
   SET bc_token_expires_at = DATEADD(hour, -1, GETUTCDATE())
   WHERE id = '<user-id>';
   ```
   ```bash
   # Hacer query BC → Backend debe auto-refresh
   > List customers

   # Verificar en logs: "BC token refreshed for user ..."
   ```

---

## Troubleshooting

### Token BC es NULL en BD

**Causa posible**:
1. Usuario no completó consent screen
2. Error al intercambiar authorization code
3. App registration no tiene permisos correctos

**Solución**:
```sql
-- Verificar usuario
SELECT * FROM users WHERE id = '<user-id>';

-- Si bc_access_token_encrypted IS NULL:
-- 1. Hacer logout
-- 2. Re-login con Microsoft
-- 3. Aceptar consent screen completo
```

### "Unauthorized" al hacer query BC

**Causa posible**:
1. Token BC expiró y refresh falló
2. Token fue revocado en Microsoft
3. Permisos de usuario en BC fueron revocados

**Solución**:
```bash
# Check token expiration
SELECT bc_token_expires_at FROM users WHERE id = '<user-id>';

# Check token validity manually
curl -H "Authorization: Bearer <token>" \
  https://api.businesscentral.dynamics.com/v2.0/<tenant>/production/companies
```

---

## References

- **Official docs**: https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/administration/automation-apis-using-s2s-authentication
- **OAuth 2.0 delegated permissions**: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- **BC API reference**: https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/

---

**Last updated**: 2025-11-11 (rewritten for Microsoft OAuth delegated permissions)
