/**
 * Authentication Type Definitions
 *
 * Types for JWT authentication, user management, and authorization.
 */

/**
 * User Role Enum
 * Role hierarchy: ADMIN > EDITOR > VIEWER
 *
 * Usage:
 * ```typescript
 * if (user.role === UserRole.ADMIN) {
 *   // Admin-only logic
 * }
 * ```
 */
export enum UserRole {
  ADMIN = 'admin',
  EDITOR = 'editor',
  VIEWER = 'viewer'
}

/**
 * @deprecated Use UserRole enum instead
 * Legacy type alias for backward compatibility
 */
export type UserRoleString = 'admin' | 'editor' | 'viewer';

/**
 * Register Request
 * Request payload for user registration
 */
export interface RegisterRequest {
  /** User email (unique) */
  email: string;
  /** User password (plain text, will be hashed) */
  password: string;
  /** User full name */
  fullName: string;
}

/**
 * Login Request
 * Request payload for user login
 */
export interface LoginRequest {
  /** User email */
  email: string;
  /** User password (plain text) */
  password: string;
}

/**
 * Refresh Token Request
 * Request payload for refreshing access token
 */
export interface RefreshTokenRequest {
  /** Refresh token */
  refreshToken: string;
}

/**
 * Logout Request
 * Request payload for logout
 */
export interface LogoutRequest {
  /** Refresh token to revoke */
  refreshToken: string;
}

/**
 * Authentication Response
 * Response containing user data and tokens
 */
export interface AuthResponse {
  /** User data */
  user: UserDTO;
  /** JWT access token (short-lived) */
  accessToken: string;
  /** Refresh token (long-lived) */
  refreshToken: string;
}

/**
 * User Data Transfer Object
 * Sanitized user data for API responses
 */
export interface UserDTO {
  /** User ID (GUID) */
  id: string;
  /** User email */
  email: string;
  /** User full name */
  fullName: string;
  /** User role */
  role: UserRole;
  /** Is user an admin (for backward compatibility) */
  isAdmin: boolean;
  /** Is user active */
  isActive: boolean;
  /** Account creation timestamp */
  createdAt: string;
  /** Last login timestamp */
  lastLoginAt: string | null;
}

/**
 * JWT Access Token Payload
 * Payload stored in JWT access token
 */
export interface JWTPayload {
  /** User ID (GUID) */
  userId: string;
  /** User email */
  email: string;
  /** User role */
  role: UserRole;
  /** Is user an admin */
  isAdmin: boolean;
  /** Issued at timestamp (seconds) */
  iat: number;
  /** Expiration timestamp (seconds) */
  exp: number;
}

/**
 * Refresh Token Payload
 * Payload stored in JWT refresh token
 */
export interface RefreshTokenPayload {
  /** User ID (GUID) */
  userId: string;
  /** Token ID (GUID, stored in database) */
  tokenId: string;
  /** Issued at timestamp (seconds) */
  iat: number;
  /** Expiration timestamp (seconds) */
  exp: number;
}

/**
 * User Database Record
 * User record from database
 */
export interface UserRecord {
  /** User ID (GUID) */
  id: string;
  /** User email */
  email: string;
  /** Password hash (bcrypt) */
  password_hash: string;
  /** User full name */
  full_name: string;
  /** User role */
  role: UserRole;
  /** Is user active */
  is_active: boolean;
  /** Is user an admin */
  is_admin: boolean;
  /** Account creation timestamp */
  created_at: Date;
  /** Last update timestamp */
  updated_at: Date;
  /** Last login timestamp */
  last_login_at: Date | null;
}

/**
 * Refresh Token Database Record
 * Refresh token record from database
 */
export interface RefreshTokenRecord {
  /** Token ID (GUID) */
  id: string;
  /** User ID (GUID) */
  user_id: string;
  /** Token hash (bcrypt) */
  token_hash: string;
  /** Expiration timestamp */
  expires_at: Date;
  /** Is token revoked */
  is_revoked: boolean;
  /** Creation timestamp */
  created_at: Date;
  /** Revocation timestamp */
  revoked_at: Date | null;
}

/**
 * Password Validation Result
 * Result of password strength validation
 */
export interface PasswordValidationResult {
  /** Is password valid */
  valid: boolean;
  /** Validation errors (if any) */
  errors: string[];
}

/**
 * Token Verification Result
 * Result of token verification
 */
export interface TokenVerificationResult {
  /** Is token valid */
  valid: boolean;
  /** Decoded payload (if valid) */
  payload?: JWTPayload | RefreshTokenPayload;
  /** Error message (if invalid) */
  error?: string;
}

/**
 * Extend Express Request to include authenticated user
 */
declare global {
  namespace Express {
    interface Request {
      /** Authenticated user from JWT (set by auth middleware) */
      user?: JWTPayload;
    }
  }
}

/**
 * Authentication Error
 * Custom error class for authentication failures
 */
export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * Authorization Error
 * Custom error class for authorization failures
 */
export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthorizationError';
  }
}
