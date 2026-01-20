/**
 * Auth Service Exports
 * @deprecated Import from '@/domains/auth' instead
 */

// Microsoft OAuth 2.0 Authentication (re-exported from domains/auth)
export { MicrosoftOAuthService, createMicrosoftOAuthService } from '@/domains/auth/oauth/MicrosoftOAuthService';

// BC Token Manager (stays here for now, will move to domains/business-central)
export { BCTokenManager, createBCTokenManager } from './BCTokenManager';
