/**
 * Microsoft OAuth 2.0 and Business Central Integration Type Definitions
 *
 * This file defines all types related to Microsoft Entra ID OAuth authentication
 * and Business Central API token management.
 *
 * Architecture Note:
 * Refresh tokens are managed internally by MSAL via Redis cache. Only access tokens
 * are stored in SQL (encrypted). Token refresh is handled by acquireBCTokenSilent().
 */

import { GRAPH_API_SCOPES } from '@bc-agent/shared';

/**
 * Microsoft OAuth Configuration
 */
export interface MicrosoftOAuthConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  redirectUri: string;
  scopes: string[];
}

/**
 * OAuth Token Response from Microsoft Entra ID
 */
export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

/**
 * Microsoft User Profile from Graph API
 */
export interface MicrosoftUserProfile {
  id: string;
  displayName: string;
  givenName: string;
  surname: string;
  mail: string;
  userPrincipalName: string;
  jobTitle?: string;
  officeLocation?: string;
  mobilePhone?: string;
  businessPhones?: string[];
}

/**
 * Business Central Token Record (stored in database, encrypted)
 *
 * Note: Only access token is stored. Refresh tokens are managed by MSAL in Redis.
 */
export interface BCTokenRecord {
  userId: string;
  accessTokenEncrypted: string;
  expiresAt: Date;
}

/**
 * Business Central Token Data (decrypted, for use in API calls)
 *
 * Note: refreshToken is optional as refresh is handled by MSAL.
 */
export interface BCTokenData {
  accessToken: string;
  expiresAt: Date;
}

/**
 * Token Acquisition Result
 */
export interface TokenAcquisitionResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
}

/**
 * Microsoft OAuth Session Data
 * Stored in express-session
 */
export interface MicrosoftOAuthSession {
  userId?: string;
  microsoftId?: string;
  displayName?: string;
  email?: string;
  accessToken?: string;
  /**
   * MSAL homeAccountId - used for acquireTokenSilent
   *
   * This is the preferred method for token refresh. MSAL manages refresh tokens
   * internally via the token cache (Redis). We only store the account identifier.
   */
  homeAccountId?: string;
  /**
   * MSAL cache partition key - the sessionId used to partition MSAL token cache in Redis.
   *
   * Using sessionId instead of userId avoids the "chicken and egg" problem during OAuth
   * callback where we need to exchange the code before we know the userId.
   *
   * This key is used with acquireTokenSilent for all token refresh operations.
   */
  msalPartitionKey?: string;
  tokenExpiresAt?: string;  // ISO 8601 format for session serialization
}

/**
 * Business Central API Scope
 */
export const BC_API_SCOPE = 'https://api.businesscentral.dynamics.com/Financials.ReadWrite.All';

/**
 * OpenID Connect base scopes for Microsoft Entra ID authentication.
 * Used only within this module to build LOGIN_SCOPES.
 */
const AUTH_BASE_SCOPES = {
  OPENID: 'openid',
  PROFILE: 'profile',
  EMAIL: 'email',
  OFFLINE_ACCESS: 'offline_access',
  USER_READ: 'User.Read',
} as const;

/**
 * Login-only scopes (minimal permissions for user authentication)
 *
 * These scopes are requested during the initial Microsoft login.
 * Connector-specific scopes (BC, OneDrive, SharePoint) are requested
 * on-demand via incremental consent when the user connects each service.
 */
export const LOGIN_SCOPES = [
  AUTH_BASE_SCOPES.OPENID,
  AUTH_BASE_SCOPES.PROFILE,
  AUTH_BASE_SCOPES.EMAIL,
  AUTH_BASE_SCOPES.OFFLINE_ACCESS,
  AUTH_BASE_SCOPES.USER_READ,
];

/** @deprecated Use LOGIN_SCOPES instead. BC scope is now requested on-demand via incremental consent. */
export const ALL_SCOPES = LOGIN_SCOPES;

// ─── Connector-specific scopes (requested on-demand via incremental consent) ──

/** OneDrive consent scopes — requested when user connects OneDrive. */
export const ONEDRIVE_CONSENT_SCOPES = [GRAPH_API_SCOPES.FILES_READ_ALL, 'offline_access'] as const;

/** SharePoint consent scopes — requested when user connects SharePoint. */
export const SHAREPOINT_CONSENT_SCOPES = [GRAPH_API_SCOPES.SITES_READ_ALL, GRAPH_API_SCOPES.FILES_READ_ALL, 'offline_access'] as const;

/** Business Central consent scopes — requested when user connects BC. */
export const BC_CONSENT_SCOPES = [BC_API_SCOPE] as const;
