/**
 * Microsoft OAuth Service
 *
 * Handles Microsoft Entra ID OAuth 2.0 authentication flow using MSAL (Microsoft Authentication Library).
 * Provides methods for:
 * - Authorization code flow (login redirect)
 * - Token acquisition and refresh
 * - User profile retrieval from Microsoft Graph
 * - Business Central API token acquisition
 */

import { ConfidentialClientApplication, AuthorizationUrlRequest, AuthorizationCodeRequest, Configuration, AccountInfo } from '@azure/msal-node';
import { MicrosoftOAuthConfig, OAuthTokenResponse, MicrosoftUserProfile, TokenAcquisitionResult, ALL_SCOPES, BC_API_SCOPE } from '@/types/microsoft.types';
import { createChildLogger } from '@/shared/utils/logger';
import { MsalRedisCachePlugin } from './MsalRedisCachePlugin';

export class MicrosoftOAuthService {
  private msalClient: ConfidentialClientApplication;
  private config: MicrosoftOAuthConfig;
  private logger = createChildLogger({ service: 'MicrosoftOAuthService' });

  constructor(config: MicrosoftOAuthConfig) {
    this.config = config;

    const msalConfig: Configuration = {
      auth: {
        clientId: config.clientId,
        authority: `https://login.microsoftonline.com/${config.tenantId}`,
        clientSecret: config.clientSecret,
      },
      system: {
        loggerOptions: {
          loggerCallback: (level, message, containsPii) => {
            if (containsPii) return;
            switch (level) {
              case 0: // Error
                this.logger.error(`MSAL: ${message}`);
                break;
              case 1: // Warning
                this.logger.warn(`MSAL: ${message}`);
                break;
              case 2: // Info
                this.logger.info(`MSAL: ${message}`);
                break;
              case 3: // Verbose
                this.logger.debug(`MSAL: ${message}`);
                break;
            }
          },
          piiLoggingEnabled: false,
          logLevel: 3, // Verbose
        },
      },
    };

    this.msalClient = new ConfidentialClientApplication(msalConfig);
    this.logger.info('MicrosoftOAuthService initialized', { tenantId: config.tenantId, clientId: config.clientId });
  }

  /**
   * Generate Authorization URL for OAuth login redirect
   *
   * @param state - Random state string for CSRF protection
   * @returns Authorization URL to redirect user to
   */
  async getAuthCodeUrl(state: string): Promise<string> {
    try {
      const authCodeUrlParameters: AuthorizationUrlRequest = {
        scopes: this.config.scopes,
        redirectUri: this.config.redirectUri,
        state,
        prompt: 'select_account', // Force account selection
      };

      const authUrl = await this.msalClient.getAuthCodeUrl(authCodeUrlParameters);
      this.logger.info('Generated authorization URL', { state });
      return authUrl;
    } catch (error) {
      this.logger.error('Failed to generate authorization URL', { error, state });
      throw new Error('Failed to generate Microsoft login URL');
    }
  }

  /**
   * Handle OAuth callback and exchange authorization code for tokens
   *
   * @param code - Authorization code from callback
   * @param state - State string for CSRF validation
   * @returns Token response with access_token, refresh_token, id_token
   */
  async handleAuthCallback(code: string, state: string): Promise<OAuthTokenResponse> {
    try {
      const tokenRequest: AuthorizationCodeRequest = {
        code,
        scopes: this.config.scopes,
        redirectUri: this.config.redirectUri,
      };

      const response = await this.msalClient.acquireTokenByCode(tokenRequest);

      if (!response || !response.accessToken) {
        throw new Error('Failed to acquire tokens from authorization code');
      }

      this.logger.info('Successfully acquired tokens from authorization code', {
        state,
        scopes: response.scopes,
        expiresOn: response.expiresOn,
      });

      // Note: MSAL Node may not expose refreshToken in the typed response,
      // but it may be present in the actual object. We'll extract it if available.
      const refreshToken = 'refreshToken' in response && typeof response.refreshToken === 'string'
        ? response.refreshToken
        : undefined;

      return {
        access_token: response.accessToken,
        refresh_token: refreshToken,
        id_token: response.idToken || '',
        token_type: response.tokenType || 'Bearer',
        expires_in: response.expiresOn ? Math.floor((response.expiresOn.getTime() - Date.now()) / 1000) : 3600,
        scope: response.scopes?.join(' ') || '',
      };
    } catch (error) {
      this.logger.error('Failed to handle authorization callback', { error, state });
      throw new Error('Failed to complete Microsoft login');
    }
  }

  /**
   * Acquire access token using refresh token
   *
   * @param refreshToken - Refresh token from previous authentication
   * @returns New token set
   */
  async refreshAccessToken(refreshToken: string): Promise<TokenAcquisitionResult> {
    try {
      const refreshTokenRequest = {
        refreshToken,
        scopes: this.config.scopes,
      };

      const response = await this.msalClient.acquireTokenByRefreshToken(refreshTokenRequest);

      if (!response || !response.accessToken) {
        throw new Error('Failed to refresh access token');
      }

      this.logger.info('Successfully refreshed access token', {
        scopes: response.scopes,
        expiresOn: response.expiresOn,
      });

      // Reuse the input refresh token if no new one is provided
      // MSAL typically doesn't return a new refresh token on refresh operations
      const newRefreshToken =
        ('refreshToken' in response && typeof response.refreshToken === 'string')
          ? response.refreshToken
          : refreshToken;

      return {
        accessToken: response.accessToken,
        refreshToken: newRefreshToken,
        expiresAt: response.expiresOn || new Date(Date.now() + 3600 * 1000),
      };
    } catch (error) {
      this.logger.error('Failed to refresh access token', { error });
      throw new Error('Failed to refresh Microsoft access token');
    }
  }

  /**
   * Validate access token by attempting to use it
   *
   * @param accessToken - Access token to validate
   * @returns True if token is valid
   */
  async validateAccessToken(accessToken: string): Promise<boolean> {
    try {
      // Validate by attempting to fetch user profile
      await this.getUserProfile(accessToken);
      return true;
    } catch (error) {
      this.logger.warn('Access token validation failed', { error });
      return false;
    }
  }

  /**
   * Get user profile from Microsoft Graph API
   *
   * @param accessToken - Access token with User.Read scope
   * @returns User profile data
   */
  async getUserProfile(accessToken: string): Promise<MicrosoftUserProfile> {
    try {
      const response = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Microsoft Graph API error: ${response.status} ${response.statusText}`);
      }

      const profile = await response.json() as MicrosoftUserProfile;

      this.logger.info('Successfully fetched user profile from Microsoft Graph', {
        userId: profile.id,
        email: profile.mail || profile.userPrincipalName,
      });

      return {
        id: profile.id,
        displayName: profile.displayName,
        givenName: profile.givenName,
        surname: profile.surname,
        mail: profile.mail || profile.userPrincipalName,
        userPrincipalName: profile.userPrincipalName,
        jobTitle: profile.jobTitle,
        officeLocation: profile.officeLocation,
        mobilePhone: profile.mobilePhone,
        businessPhones: profile.businessPhones,
      };
    } catch (error) {
      this.logger.error('Failed to get user profile from Microsoft Graph', { error });
      throw new Error('Failed to retrieve user profile');
    }
  }

  /**
   * Acquire Business Central API token with delegated permissions
   *
   * This method exchanges the user's Microsoft token for a Business Central API token.
   * The BC token will have delegated permissions (act on behalf of the user).
   *
   * @param refreshToken - User's refresh token
   * @returns BC API access token
   */
  async acquireBCToken(refreshToken: string): Promise<TokenAcquisitionResult> {
    try {
      const tokenRequest = {
        refreshToken,
        scopes: [BC_API_SCOPE],
      };

      const response = await this.msalClient.acquireTokenByRefreshToken(tokenRequest);

      if (!response || !response.accessToken) {
        throw new Error('Failed to acquire Business Central API token');
      }

      this.logger.info('Successfully acquired Business Central API token', {
        scopes: response.scopes,
        expiresOn: response.expiresOn,
      });

      // Reuse the input refresh token if no new one is provided
      const newRefreshToken =
        ('refreshToken' in response && typeof response.refreshToken === 'string')
          ? response.refreshToken
          : refreshToken;

      return {
        accessToken: response.accessToken,
        refreshToken: newRefreshToken,
        expiresAt: response.expiresOn || new Date(Date.now() + 3600 * 1000),
      };
    } catch (error) {
      this.logger.error('Failed to acquire Business Central API token', { error });
      throw new Error('Failed to acquire Business Central access');
    }
  }

  /**
   * Get MSAL configuration for debugging
   */
  getConfig(): Partial<MicrosoftOAuthConfig> {
    return {
      clientId: this.config.clientId,
      tenantId: this.config.tenantId,
      redirectUri: this.config.redirectUri,
      scopes: this.config.scopes,
    };
  }

  /**
   * Create MSAL client with Redis cache plugin for a specific user
   *
   * This allows MSAL to persist and retrieve tokens from Redis,
   * enabling acquireTokenSilent to work across server restarts and
   * multiple container instances.
   *
   * @param userId - User ID to partition the cache
   * @returns Configured MSAL ConfidentialClientApplication
   */
  private createMsalClientWithCache(userId: string): ConfidentialClientApplication {
    const msalConfig: Configuration = {
      auth: {
        clientId: this.config.clientId,
        authority: `https://login.microsoftonline.com/${this.config.tenantId}`,
        clientSecret: this.config.clientSecret,
      },
      cache: {
        cachePlugin: new MsalRedisCachePlugin(userId),
      },
      system: {
        loggerOptions: {
          loggerCallback: (level, message, containsPii) => {
            if (containsPii) return;
            switch (level) {
              case 0: // Error
                this.logger.error(`MSAL: ${message}`);
                break;
              case 1: // Warning
                this.logger.warn(`MSAL: ${message}`);
                break;
              case 2: // Info
                this.logger.info(`MSAL: ${message}`);
                break;
              case 3: // Verbose
                this.logger.debug(`MSAL: ${message}`);
                break;
            }
          },
          piiLoggingEnabled: false,
          logLevel: 2, // Info level for cache operations
        },
      },
    };

    return new ConfidentialClientApplication(msalConfig);
  }

  /**
   * Handle OAuth callback with Redis cache persistence
   *
   * This method acquires tokens and persists them in Redis via MSAL cache plugin.
   * Use this instead of handleAuthCallback when you want tokens cached for later
   * acquireTokenSilent calls.
   *
   * @param code - Authorization code from callback
   * @param state - State string for CSRF validation
   * @param userId - User ID for cache partitioning
   * @returns Token response with access_token, account info, etc.
   */
  async handleAuthCallbackWithCache(
    code: string,
    state: string,
    userId: string
  ): Promise<OAuthTokenResponse & { homeAccountId?: string }> {
    try {
      const msalClient = this.createMsalClientWithCache(userId);

      const tokenRequest: AuthorizationCodeRequest = {
        code,
        scopes: this.config.scopes,
        redirectUri: this.config.redirectUri,
      };

      const response = await msalClient.acquireTokenByCode(tokenRequest);

      if (!response || !response.accessToken) {
        throw new Error('Failed to acquire tokens from authorization code');
      }

      this.logger.info('Successfully acquired tokens with Redis cache', {
        state,
        scopes: response.scopes,
        expiresOn: response.expiresOn,
        hasAccount: !!response.account,
        homeAccountId: response.account?.homeAccountId,
      });

      return {
        access_token: response.accessToken,
        refresh_token: undefined, // MSAL manages refresh tokens internally
        id_token: response.idToken || '',
        token_type: response.tokenType || 'Bearer',
        expires_in: response.expiresOn ? Math.floor((response.expiresOn.getTime() - Date.now()) / 1000) : 3600,
        scope: response.scopes?.join(' ') || '',
        homeAccountId: response.account?.homeAccountId,
      };
    } catch (error) {
      this.logger.error('Failed to handle authorization callback with cache', { error, state, userId });
      throw new Error('Failed to complete Microsoft login');
    }
  }

  /**
   * Refresh access token using acquireTokenSilent (MSAL cache-based)
   *
   * This is the recommended method for token refresh. MSAL retrieves the refresh
   * token from Redis cache internally and uses it to get a new access token.
   *
   * Prerequisites:
   * - User must have logged in via handleAuthCallbackWithCache
   * - MSAL cache must exist in Redis for this partition key
   *
   * @param partitionKey - Cache partition key (sessionId from login)
   * @param homeAccountId - Account identifier from initial login
   * @returns New access token and expiration
   * @throws Error if account not found in cache (user needs to re-login)
   */
  async refreshAccessTokenSilent(
    partitionKey: string,
    homeAccountId: string
  ): Promise<TokenAcquisitionResult> {
    try {
      const msalClient = this.createMsalClientWithCache(partitionKey);
      const tokenCache = msalClient.getTokenCache();

      // Get account from cache by homeAccountId
      const account = await tokenCache.getAccountByHomeId(homeAccountId);

      if (!account) {
        this.logger.warn('Account not found in MSAL cache', { partitionKey, homeAccountId });
        throw new Error('Account not found in cache - user needs to re-login');
      }

      this.logger.debug('Found account in MSAL cache, attempting silent token refresh', {
        partitionKey,
        homeAccountId,
        accountUsername: account.username,
      });

      // Acquire token silently - MSAL will use refresh token from cache
      const response = await msalClient.acquireTokenSilent({
        account,
        scopes: this.config.scopes,
      });

      if (!response || !response.accessToken) {
        throw new Error('Failed to acquire token silently');
      }

      this.logger.info('Successfully refreshed access token via acquireTokenSilent', {
        partitionKey,
        scopes: response.scopes,
        expiresOn: response.expiresOn,
        fromCache: response.fromCache,
      });

      return {
        accessToken: response.accessToken,
        // Note: refreshToken is undefined because MSAL manages it internally
        refreshToken: undefined,
        expiresAt: response.expiresOn || new Date(Date.now() + 3600 * 1000),
      };
    } catch (error) {
      const errorInfo = error instanceof Error
        ? { message: error.message, name: error.name }
        : { value: String(error) };
      this.logger.error('Failed to refresh access token silently', { error: errorInfo, partitionKey, homeAccountId });

      // Provide specific error for common cases
      if (error instanceof Error && error.message.includes('cache')) {
        throw new Error('Session expired - user needs to re-login');
      }

      throw new Error('Failed to refresh Microsoft access token');
    }
  }

  /**
   * Acquire Business Central API token using silent refresh
   *
   * Uses MSAL cache to get BC API token without requiring the refresh token
   * to be passed explicitly.
   *
   * @param partitionKey - Cache partition key (sessionId from login)
   * @param homeAccountId - Account identifier from initial login
   * @returns BC API access token
   */
  async acquireBCTokenSilent(
    partitionKey: string,
    homeAccountId: string
  ): Promise<TokenAcquisitionResult> {
    try {
      const msalClient = this.createMsalClientWithCache(partitionKey);
      const tokenCache = msalClient.getTokenCache();

      const account = await tokenCache.getAccountByHomeId(homeAccountId);

      if (!account) {
        this.logger.warn('Account not found in MSAL cache for BC token', { partitionKey, homeAccountId });
        throw new Error('Account not found in cache - user needs to re-login');
      }

      const response = await msalClient.acquireTokenSilent({
        account,
        scopes: [BC_API_SCOPE],
      });

      if (!response || !response.accessToken) {
        throw new Error('Failed to acquire Business Central API token silently');
      }

      this.logger.info('Successfully acquired Business Central API token via acquireTokenSilent', {
        partitionKey,
        scopes: response.scopes,
        expiresOn: response.expiresOn,
      });

      return {
        accessToken: response.accessToken,
        refreshToken: undefined,
        expiresAt: response.expiresOn || new Date(Date.now() + 3600 * 1000),
      };
    } catch (error) {
      this.logger.error('Failed to acquire Business Central API token silently', { error, partitionKey, homeAccountId });
      throw new Error('Failed to acquire Business Central access');
    }
  }

  /**
   * Get account info from MSAL cache
   *
   * Useful for checking if a user has a valid cached session.
   *
   * @param partitionKey - Cache partition key (sessionId from login)
   * @param homeAccountId - Account identifier
   * @returns Account info or null if not found
   */
  async getAccountFromCache(partitionKey: string, homeAccountId: string): Promise<AccountInfo | null> {
    try {
      const msalClient = this.createMsalClientWithCache(partitionKey);
      const tokenCache = msalClient.getTokenCache();
      return await tokenCache.getAccountByHomeId(homeAccountId);
    } catch (error) {
      this.logger.warn('Failed to get account from cache', { error, partitionKey, homeAccountId });
      return null;
    }
  }
}

/**
 * Create MicrosoftOAuthService instance from environment variables
 */
export function createMicrosoftOAuthService(): MicrosoftOAuthService {
  const config: MicrosoftOAuthConfig = {
    clientId: process.env.MICROSOFT_CLIENT_ID || '',
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
    tenantId: process.env.MICROSOFT_TENANT_ID || 'common',
    redirectUri: process.env.MICROSOFT_REDIRECT_URI || 'http://localhost:3002/api/auth/callback',
    // Hardcoded scopes - always use the full set required for Graph + BC API
    scopes: ALL_SCOPES,
  };

  if (!config.clientId || !config.clientSecret) {
    throw new Error('MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET must be configured');
  }

  return new MicrosoftOAuthService(config);
}
