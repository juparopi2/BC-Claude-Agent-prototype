/**
 * Microsoft OAuth 2.0 and Business Central Integration Type Definitions
 *
 * This file defines all types related to Microsoft Entra ID OAuth authentication
 * and Business Central API token management.
 */

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
 */
export interface BCTokenRecord {
  userId: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  expiresAt: Date;
}

/**
 * Decrypted Business Central Token Data
 */
export interface BCTokenData {
  accessToken: string;
  refreshToken: string;
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
  refreshToken?: string;
  tokenExpiresAt?: string;  // ⭐ Changed to string (ISO 8601 format) for session serialization
}

/**
 * Business Central API Scope
 */
export const BC_API_SCOPE = 'https://api.businesscentral.dynamics.com/Financials.ReadWrite.All';

/**
 * Microsoft Graph Scopes
 */
export const GRAPH_SCOPES = {
  OPENID: 'openid',
  PROFILE: 'profile',
  EMAIL: 'email',
  OFFLINE_ACCESS: 'offline_access',
  USER_READ: 'User.Read',
} as const;

/**
 * All Required Scopes (Graph + Business Central)
 */
export const ALL_SCOPES = [
  GRAPH_SCOPES.OPENID,
  GRAPH_SCOPES.PROFILE,
  GRAPH_SCOPES.EMAIL,
  GRAPH_SCOPES.OFFLINE_ACCESS,
  GRAPH_SCOPES.USER_READ,
  BC_API_SCOPE,
];
