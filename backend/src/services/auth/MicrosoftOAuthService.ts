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

import { ConfidentialClientApplication, AuthorizationUrlRequest, AuthorizationCodeRequest, Configuration } from '@azure/msal-node';
import { MicrosoftOAuthConfig, OAuthTokenResponse, MicrosoftUserProfile, TokenAcquisitionResult, ALL_SCOPES, BC_API_SCOPE } from '../../types/microsoft.types';
import { logger } from '../../utils/logger';

export class MicrosoftOAuthService {
  private msalClient: ConfidentialClientApplication;
  private config: MicrosoftOAuthConfig;

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
                logger.error(`MSAL: ${message}`);
                break;
              case 1: // Warning
                logger.warn(`MSAL: ${message}`);
                break;
              case 2: // Info
                logger.info(`MSAL: ${message}`);
                break;
              case 3: // Verbose
                logger.debug(`MSAL: ${message}`);
                break;
            }
          },
          piiLoggingEnabled: false,
          logLevel: 3, // Verbose
        },
      },
    };

    this.msalClient = new ConfidentialClientApplication(msalConfig);
    logger.info('MicrosoftOAuthService initialized', { tenantId: config.tenantId, clientId: config.clientId });
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
      logger.info('Generated authorization URL', { state });
      return authUrl;
    } catch (error) {
      logger.error('Failed to generate authorization URL', { error, state });
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

      logger.info('Successfully acquired tokens from authorization code', {
        state,
        scopes: response.scopes,
        expiresOn: response.expiresOn,
      });

      // Note: MSAL Node may not expose refreshToken in the typed response,
      // but it may be present in the actual object. We'll extract it if available.
      const refreshToken = (response as { refreshToken?: string }).refreshToken;

      return {
        access_token: response.accessToken,
        refresh_token: refreshToken,
        id_token: response.idToken || '',
        token_type: response.tokenType || 'Bearer',
        expires_in: response.expiresOn ? Math.floor((response.expiresOn.getTime() - Date.now()) / 1000) : 3600,
        scope: response.scopes?.join(' ') || '',
      };
    } catch (error) {
      logger.error('Failed to handle authorization callback', { error, state });
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

      logger.info('Successfully refreshed access token', {
        scopes: response.scopes,
        expiresOn: response.expiresOn,
      });

      // Reuse the input refresh token if no new one is provided
      // MSAL typically doesn't return a new refresh token on refresh operations
      const newRefreshToken = (response as { refreshToken?: string }).refreshToken || refreshToken;

      return {
        accessToken: response.accessToken,
        refreshToken: newRefreshToken,
        expiresAt: response.expiresOn || new Date(Date.now() + 3600 * 1000),
      };
    } catch (error) {
      logger.error('Failed to refresh access token', { error });
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
      logger.warn('Access token validation failed', { error });
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

      logger.info('Successfully fetched user profile from Microsoft Graph', {
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
      logger.error('Failed to get user profile from Microsoft Graph', { error });
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

      logger.info('Successfully acquired Business Central API token', {
        scopes: response.scopes,
        expiresOn: response.expiresOn,
      });

      // Reuse the input refresh token if no new one is provided
      const newRefreshToken = (response as { refreshToken?: string }).refreshToken || refreshToken;

      return {
        accessToken: response.accessToken,
        refreshToken: newRefreshToken,
        expiresAt: response.expiresOn || new Date(Date.now() + 3600 * 1000),
      };
    } catch (error) {
      logger.error('Failed to acquire Business Central API token', { error });
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
    scopes: process.env.MICROSOFT_SCOPES?.split(' ') || ALL_SCOPES,
  };

  if (!config.clientId || !config.clientSecret) {
    throw new Error('MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET must be configured');
  }

  return new MicrosoftOAuthService(config);
}
