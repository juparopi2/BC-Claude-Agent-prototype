# Microsoft OAuth Setup Guide

## Overview

Esta guía detalla cómo configurar Microsoft Entra ID (Azure AD) OAuth 2.0 para permitir que los usuarios se autentiquen con sus cuentas Microsoft y accedan a Business Central con sus credenciales delegadas.

---

## Architecture Overview

```
Usuario → Frontend → Backend → Microsoft Entra ID → BC API
                          ↓
                    (User's BC Token)
                          ↓
                    Encrypted Storage (DB)
```

**Flujo**:
1. Usuario hace click en "Sign in with Microsoft"
2. Backend redirect a Microsoft login page
3. Usuario inicia sesión y otorga consent a BC permissions
4. Microsoft redirect a backend con authorization code
5. Backend intercambia code por access token + refresh token
6. Backend almacena tokens cifrados en BD
7. Backend usa tokens para ejecutar operaciones BC en nombre del usuario

---

## Prerequisites

- **Azure Subscription**: Cuenta de Azure activa
- **Azure CLI**: Instalado y configurado (`az login`)
- **Permisos**: Admin consent capability para otorgar permisos de BC

---

## Step 1: Create Azure App Registration

### Option A: Using Azure Portal (Recomendado para primera vez)

1. **Navega a Azure Portal**:
   - URL: https://portal.azure.com
   - Ir a "Microsoft Entra ID" (anteriormente Azure Active Directory)

2. **Create App Registration**:
   - Click "App registrations" → "New registration"
   - **Name**: `BC-Claude-Agent-Dev` (o nombre de tu elección)
   - **Supported account types**:
     - Single tenant: Solo usuarios de tu organización
     - Multi-tenant: Usuarios de cualquier organización Microsoft (recomendado)
   - **Redirect URI**:
     - Platform: Web
     - URI: `http://localhost:3002/api/auth/callback` (dev)
     - Add production URI later: `https://your-prod-domain.com/api/auth/callback`
   - Click "Register"

3. **Note Important Values**:
   - **Application (client) ID**: Copia este valor → `MICROSOFT_CLIENT_ID`
   - **Directory (tenant) ID**: Copia este valor → `MICROSOFT_TENANT_ID`
     - Si es multi-tenant, usa `common` en lugar del tenant ID

4. **Create Client Secret**:
   - Go to "Certificates & secrets" → "New client secret"
   - **Description**: `BC-Claude-Agent-Dev-Secret`
   - **Expires**: 24 months (máximo recomendado)
   - Click "Add"
   - **IMPORTANT**: Copia el **Value** inmediatamente → `MICROSOFT_CLIENT_SECRET`
     - Este valor solo se muestra UNA VEZ
     - Si lo pierdes, debes crear un nuevo secret

### Option B: Using Azure CLI (Para automation)

```bash
# Login to Azure
az login

# Create App Registration
az ad app create \
  --display-name "BC-Claude-Agent-Dev" \
  --sign-in-audience AzureADMultipleOrgs \
  --web-redirect-uris "http://localhost:3002/api/auth/callback"

# Get Application ID (guarda este valor)
APP_ID=$(az ad app list --display-name "BC-Claude-Agent-Dev" --query "[0].appId" -o tsv)
echo "MICROSOFT_CLIENT_ID=$APP_ID"

# Get Tenant ID
TENANT_ID=$(az account show --query tenantId -o tsv)
echo "MICROSOFT_TENANT_ID=$TENANT_ID"
# Para multi-tenant, usa: MICROSOFT_TENANT_ID=common

# Create Client Secret (expires in 2 years)
SECRET=$(az ad app credential reset --id $APP_ID --years 2 --query password -o tsv)
echo "MICROSOFT_CLIENT_SECRET=$SECRET"
# ⚠️ GUARDA ESTE SECRET INMEDIATAMENTE - no se puede recuperar después
```

---

## Step 2: Configure API Permissions

### Required Scopes

**Microsoft Graph**:
- `openid`: Basic login
- `profile`: User profile info
- `email`: User email address
- `offline_access`: Refresh token capability
- `User.Read`: Read user's profile from Graph

**Business Central**:
- `https://api.businesscentral.dynamics.com/Financials.ReadWrite.All`: Full BC access

### Add Permissions (Azure Portal)

1. **Go to App Registration** → "API permissions"

2. **Add Microsoft Graph Permissions**:
   - Click "Add a permission" → "Microsoft Graph" → "Delegated permissions"
   - Search and select:
     - ✅ `openid`
     - ✅ `profile`
     - ✅ `email`
     - ✅ `offline_access`
     - ✅ `User.Read`
   - Click "Add permissions"

3. **Add Business Central Permissions**:
   - Click "Add a permission" → "APIs my organization uses"
   - Search for "Dynamics 365 Business Central" or "Business Central"
   - **API**: `https://api.businesscentral.dynamics.com`
   - Select "Delegated permissions"
   - Search and select:
     - ✅ `Financials.ReadWrite.All`
   - Click "Add permissions"

4. **Grant Admin Consent** (si eres admin):
   - Click "Grant admin consent for [Your Organization]"
   - Confirm "Yes"
   - Status debe cambiar a green checkmarks

**⚠️ IMPORTANTE**: Si no eres admin, debes pedirle a un admin que otorgue consent, o los usuarios verán error al intentar login.

### Add Permissions (Azure CLI)

```bash
# Microsoft Graph permissions
az ad app permission add \
  --id $APP_ID \
  --api 00000003-0000-0000-c000-000000000000 \
  --api-permissions \
    e1fe6dd8-ba31-4d61-89e7-88639da4683d=Scope \  # User.Read
    37f7f235-527c-4136-accd-4a02d197296e=Scope \  # openid
    14dad69e-099b-42c9-810b-d002981feec1=Scope \  # profile
    64a6cdd6-aab1-4aaf-94b8-3cc8405e90d0=Scope \  # email
    7427e0e9-2fba-42fe-b0c0-848c9e6a8182=Scope    # offline_access

# Business Central permissions
# First, get BC API ID
BC_API_ID=$(az ad sp list --display-name "Dynamics 365 Business Central" --query "[0].appId" -o tsv)

# Add BC permission (Financials.ReadWrite.All)
az ad app permission add \
  --id $APP_ID \
  --api $BC_API_ID \
  --api-permissions \
    # TODO: Get exact permission ID for Financials.ReadWrite.All
    # Usar portal para obtener el permission ID correcto

# Grant admin consent (requires admin role)
az ad app permission admin-consent --id $APP_ID
```

---

## Step 3: Configure Backend Environment Variables

### .env File

Create or update `backend/.env`:

```bash
# Microsoft OAuth Configuration
MICROSOFT_CLIENT_ID=<Application (client) ID from Step 1>
MICROSOFT_CLIENT_SECRET=<Client secret value from Step 1>
MICROSOFT_TENANT_ID=common  # or specific tenant ID for single-tenant
MICROSOFT_REDIRECT_URI=http://localhost:3002/api/auth/callback
MICROSOFT_SCOPES="openid profile email offline_access User.Read https://api.businesscentral.dynamics.com/Financials.ReadWrite.All"

# Encryption Key (para cifrar tokens BC en BD)
ENCRYPTION_KEY=<generate with: openssl rand -base64 32>

# Session Management
SESSION_SECRET=<generate with: openssl rand -base64 32>
SESSION_MAX_AGE=86400000  # 24 hours in milliseconds

# Business Central API
BC_API_URL=https://api.businesscentral.dynamics.com/v2.0
```

### Generate Secrets

```bash
# Generate encryption key (32 bytes for AES-256)
openssl rand -base64 32

# Generate session secret
openssl rand -base64 32
```

### Store Secrets in Azure Key Vault (Production)

```bash
# Create Key Vault (if not exists)
az keyvault create \
  --name kv-bcagent-prod \
  --resource-group rg-BCAgentPrototype-app-prod \
  --location westeurope

# Store secrets
az keyvault secret set --vault-name kv-bcagent-prod --name "MicrosoftClientId" --value "$MICROSOFT_CLIENT_ID"
az keyvault secret set --vault-name kv-bcagent-prod --name "MicrosoftClientSecret" --value "$MICROSOFT_CLIENT_SECRET"
az keyvault secret set --vault-name kv-bcagent-prod --name "EncryptionKey" --value "$(openssl rand -base64 32)"
az keyvault secret set --vault-name kv-bcagent-prod --name "SessionSecret" --value "$(openssl rand -base64 32)"

# Retrieve secrets in backend
# (Using Azure SDK for JavaScript with Managed Identity)
```

---

## Step 4: Test OAuth Flow

### Manual Testing

1. **Start Backend Server**:
```bash
cd backend
npm run dev
```

2. **Initiate Login Flow**:
```bash
# Open in browser
http://localhost:3002/api/auth/login
```

3. **Expected Flow**:
   - Browser redirects a Microsoft login page
   - Ingresa credenciales Microsoft
   - Se muestra consent screen con permisos solicitados:
     - View your basic profile
     - Maintain access to data you have given it access to
     - Access Dynamics 365 Business Central as you
   - Click "Accept"
   - Browser redirect a `http://localhost:3002/api/auth/callback?code=...`
   - Backend procesa callback y redirect a frontend
   - Usuario está autenticado

4. **Verify User Session**:
```bash
# Get current user info
curl http://localhost:3002/api/auth/me \
  -H "Cookie: session=<session-cookie-from-browser>"

# Expected response:
# {
#   "user": {
#     "id": "user-uuid",
#     "email": "john.doe@contoso.com",
#     "fullName": "John Doe",
#     "microsoftUserId": "azure-ad-object-id"
#   },
#   "bcConnected": true,  // true if user has granted BC consent
#   "bcTokenExpiresAt": "2025-11-12T14:30:00Z"
# }
```

### Automated Testing

```typescript
// test/auth.test.ts
describe('Microsoft OAuth Flow', () => {
  it('should redirect to Microsoft login page', async () => {
    const response = await request(app)
      .get('/api/auth/login')
      .expect(302);

    expect(response.headers.location).toContain('login.microsoftonline.com');
    expect(response.headers.location).toContain('client_id=');
    expect(response.headers.location).toContain('redirect_uri=');
  });

  it('should exchange code for tokens', async () => {
    // Mock Microsoft token response
    nock('https://login.microsoftonline.com')
      .post('/common/oauth2/v2.0/token')
      .reply(200, {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer'
      });

    const response = await request(app)
      .get('/api/auth/callback')
      .query({ code: 'mock-auth-code', state: 'mock-state' })
      .expect(302);

    expect(response.headers['set-cookie']).toBeDefined();
  });
});
```

---

## Step 5: Handle Common Errors

### Error: AADSTS65001 - User or administrator has not consented

**Causa**: Usuario no ha otorgado consent a los permisos solicitados.

**Solución**:
1. Admin debe otorgar admin consent en Azure Portal (Step 2, punto 4)
2. O forzar consent prompt al usuario:

```typescript
// backend/src/services/auth/MicrosoftOAuthService.ts
getAuthCodeUrl(state: string): string {
  return `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/authorize?` +
    `client_id=${this.clientId}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(this.redirectUri)}` +
    `&scope=${encodeURIComponent(this.scopes.join(' '))}` +
    `&state=${state}` +
    `&prompt=consent`;  // ✅ Force consent screen
}
```

### Error: AADSTS50011 - Reply URL mismatch

**Causa**: Redirect URI en request no coincide con el registrado en Azure.

**Solución**:
1. Verifica que `MICROSOFT_REDIRECT_URI` en `.env` coincida EXACTAMENTE con el registrado en Azure
2. Verifica protocolo (http vs https), puerto, y path
3. Azure Portal → App Registration → "Authentication" → Add missing redirect URI

### Error: AADSTS700016 - Application not found

**Causa**: `MICROSOFT_CLIENT_ID` incorrecto o app registration eliminado.

**Solución**:
1. Verifica que `MICROSOFT_CLIENT_ID` sea correcto
2. Verifica que app registration exista en Azure Portal

### Error: Invalid client secret

**Causa**: `MICROSOFT_CLIENT_SECRET` incorrecto o expirado.

**Solución**:
1. Azure Portal → App Registration → "Certificates & secrets"
2. Create new client secret
3. Update `MICROSOFT_CLIENT_SECRET` en `.env`

---

## Step 6: Production Checklist

### Before Deploying to Production

- [ ] **App Registration**:
  - [ ] Add production redirect URI: `https://your-domain.com/api/auth/callback`
  - [ ] Verify all permissions are granted with admin consent
  - [ ] Client secret expiry is at least 6 months away
  - [ ] Tenant ID is `common` for multi-tenant support

- [ ] **Environment Variables**:
  - [ ] All secrets stored in Azure Key Vault (NOT in .env files)
  - [ ] `MICROSOFT_REDIRECT_URI` points to production domain
  - [ ] `SESSION_SECRET` is strong and unique
  - [ ] `ENCRYPTION_KEY` is 32 bytes (256 bits) and stored securely

- [ ] **Security**:
  - [ ] HTTPS enabled on production domain
  - [ ] `SESSION_COOKIE_SECURE=true` in production
  - [ ] CORS configured to allow only frontend domain
  - [ ] Rate limiting enabled on OAuth endpoints

- [ ] **Testing**:
  - [ ] Login flow tested with test user
  - [ ] BC operations tested with user's BC token
  - [ ] Token refresh tested (when access token expires)
  - [ ] Logout flow tested (session destruction)

- [ ] **Monitoring**:
  - [ ] Logging enabled for OAuth errors
  - [ ] Alerts configured for failed logins (rate > 5%)
  - [ ] Metrics tracked: login success rate, token refresh rate

---

## Troubleshooting

### Debug OAuth Flow

Enable debug logging in backend:

```typescript
// backend/src/services/auth/MicrosoftOAuthService.ts
import { Logger } from '../utils/logger';

const logger = new Logger('MicrosoftOAuth', { level: 'DEBUG' });

async acquireTokenByCode(code: string) {
  logger.debug('Acquiring token with code', { code: code.substring(0, 10) + '...' });

  try {
    const response = await this.msalClient.acquireTokenByCode({
      code,
      scopes: this.scopes,
      redirectUri: this.redirectUri
    });

    logger.debug('Token acquired successfully', {
      expiresIn: response.expiresOn,
      scopes: response.scopes
    });

    return response;
  } catch (error) {
    logger.error('Failed to acquire token', { error });
    throw error;
  }
}
```

### Verify Token Claims

Decode JWT token to verify claims:

```bash
# Install jq for JSON parsing
# Decode access token (JWT)
echo "<access-token>" | cut -d. -f2 | base64 -d | jq .

# Expected claims:
# {
#   "aud": "https://api.businesscentral.dynamics.com",
#   "iss": "https://sts.windows.net/<tenant-id>/",
#   "name": "John Doe",
#   "preferred_username": "john.doe@contoso.com",
#   "scp": "Financials.ReadWrite.All",
#   "tid": "<tenant-id>"
# }
```

### Test BC API Access

```bash
# Test BC API with user's access token
curl -H "Authorization: Bearer <bc-access-token>" \
  "https://api.businesscentral.dynamics.com/v2.0/<tenant-id>/production/api/v2.0/companies"

# Expected: List of companies
# If 401 Unauthorized: Token invalid or expired
# If 403 Forbidden: User doesn't have permission in BC
```

---

## References

- **Microsoft OAuth Documentation**: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- **BC OAuth Setup**: https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/administration/automation-apis-using-s2s-authentication
- **MSAL Node Documentation**: https://github.com/AzureAD/microsoft-authentication-library-for-js/tree/dev/lib/msal-node
- **Azure App Registration Best Practices**: https://learn.microsoft.com/en-us/entra/identity-platform/security-best-practices-for-app-registration

---

**Last updated**: 2025-11-11
**Version**: 1.0
