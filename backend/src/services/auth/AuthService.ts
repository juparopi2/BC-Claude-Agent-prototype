/**
 * Authentication Service
 *
 * Handles user authentication, JWT generation/verification, and password management.
 * Uses bcrypt for password hashing and jsonwebtoken for JWT tokens.
 */

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getPool } from '@/config/database';
import { env } from '@/config';
import type {
  RegisterRequest,
  LoginRequest,
  AuthResponse,
  UserDTO,
  JWTPayload,
  RefreshTokenPayload,
  UserRecord,
  RefreshTokenRecord,
  PasswordValidationResult,
  TokenVerificationResult,
} from '@/types';
import { AuthenticationError } from '@/types';

/**
 * Authentication Service Class
 *
 * Provides methods for user registration, login, logout, token management, and password operations.
 */
export class AuthService {
  private readonly BCRYPT_ROUNDS = 10;
  private readonly JWT_SECRET: string;
  private readonly ACCESS_TOKEN_EXPIRY: string;
  private readonly REFRESH_TOKEN_EXPIRY: string;

  constructor() {
    this.JWT_SECRET = env.JWT_SECRET || '';
    this.ACCESS_TOKEN_EXPIRY = env.JWT_EXPIRES_IN;
    this.REFRESH_TOKEN_EXPIRY = env.JWT_REFRESH_EXPIRES_IN;

    if (!this.JWT_SECRET) {
      console.warn('[AuthService] JWT_SECRET not configured');
    }
  }

  /**
   * Register New User
   *
   * Creates a new user account with hashed password and generates JWT tokens.
   *
   * @param data - Registration data
   * @returns Promise resolving to auth response with user and tokens
   * @throws AuthenticationError if email already exists or validation fails
   */
  async register(data: RegisterRequest): Promise<AuthResponse> {
    const { email, password, fullName } = data;

    // Validate password strength
    const passwordValidation = this.validatePasswordStrength(password);
    if (!passwordValidation.valid) {
      throw new AuthenticationError(
        `Password does not meet requirements: ${passwordValidation.errors.join(', ')}`
      );
    }

    const pool = getPool();

    try {
      // Check if email already exists
      const existingUser = await pool
        .request()
        .input('email', email.toLowerCase())
        .query<UserRecord>(`
          SELECT id FROM users WHERE LOWER(email) = @email
        `);

      if (existingUser.recordset.length > 0) {
        throw new AuthenticationError('Email already registered');
      }

      // Hash password
      const passwordHash = await this.hashPassword(password);

      // Create user
      const userId = crypto.randomUUID();
      const now = new Date();

      await pool
        .request()
        .input('id', userId)
        .input('email', email.toLowerCase())
        .input('password_hash', passwordHash)
        .input('full_name', fullName)
        .input('role', 'viewer') // Default role
        .input('is_active', true)
        .input('is_admin', false)
        .input('created_at', now)
        .input('updated_at', now).query(`
          INSERT INTO users (id, email, password_hash, full_name, role, is_active, is_admin, created_at, updated_at)
          VALUES (@id, @email, @password_hash, @full_name, @role, @is_active, @is_admin, @created_at, @updated_at)
        `);

      // Fetch created user
      const userResult = await pool
        .request()
        .input('id', userId)
        .query<UserRecord>(`
          SELECT * FROM users WHERE id = @id
        `);

      const user = userResult.recordset[0];

      if (!user) {
        throw new AuthenticationError('Failed to create user');
      }

      // Generate tokens
      const tokens = await this.generateTokens(user);

      // Audit log
      await this.createAuditLog(userId, 'user_registered', 'User registered successfully');

      return {
        user: this.mapUserToDTO(user),
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      };
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      console.error('[AuthService] Registration failed:', error);
      throw new AuthenticationError('Registration failed');
    }
  }

  /**
   * Login User
   *
   * Authenticates user with email/password and generates JWT tokens.
   *
   * @param data - Login credentials
   * @returns Promise resolving to auth response with user and tokens
   * @throws AuthenticationError if credentials are invalid
   */
  async login(data: LoginRequest): Promise<AuthResponse> {
    const { email, password } = data;
    const pool = getPool();

    try {
      // Find user by email
      const result = await pool
        .request()
        .input('email', email.toLowerCase())
        .query<UserRecord>(`
          SELECT * FROM users WHERE LOWER(email) = @email
        `);

      const user = result.recordset[0];

      if (!user) {
        throw new AuthenticationError('Invalid credentials');
      }

      // Check if user is active
      if (!user.is_active) {
        throw new AuthenticationError('Account is disabled');
      }

      // Verify password
      const passwordValid = await this.comparePassword(password, user.password_hash);
      if (!passwordValid) {
        // Audit log for failed attempt
        await this.createAuditLog(user.id, 'login_failed', 'Invalid password');
        throw new AuthenticationError('Invalid credentials');
      }

      // Update last login timestamp
      const now = new Date();
      await pool
        .request()
        .input('id', user.id)
        .input('last_login_at', now).query(`
          UPDATE users SET last_login_at = @last_login_at WHERE id = @id
        `);

      user.last_login_at = now;

      // Generate tokens
      const tokens = await this.generateTokens(user);

      // Audit log
      await this.createAuditLog(user.id, 'user_logged_in', 'User logged in successfully');

      return {
        user: this.mapUserToDTO(user),
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      };
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      console.error('[AuthService] Login failed:', error);
      throw new AuthenticationError('Login failed');
    }
  }

  /**
   * Logout User
   *
   * Revokes the provided refresh token.
   *
   * @param refreshToken - Refresh token to revoke
   * @returns Promise resolving when logout is complete
   * @throws AuthenticationError if token is invalid
   */
  async logout(refreshToken: string): Promise<void> {
    try {
      // Verify refresh token
      const verification = await this.verifyRefreshToken(refreshToken);
      if (!verification.valid || !verification.payload) {
        throw new AuthenticationError('Invalid refresh token');
      }

      const payload = verification.payload as RefreshTokenPayload;
      const pool = getPool();

      // Revoke token in database
      await pool
        .request()
        .input('token_id', payload.tokenId)
        .input('revoked_at', new Date()).query(`
          UPDATE refresh_tokens
          SET is_revoked = 1, revoked_at = @revoked_at
          WHERE id = @token_id
        `);

      // Audit log
      await this.createAuditLog(payload.userId, 'user_logged_out', 'User logged out');
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      console.error('[AuthService] Logout failed:', error);
      throw new AuthenticationError('Logout failed');
    }
  }

  /**
   * Refresh Tokens
   *
   * Generates new access and refresh tokens using a valid refresh token.
   *
   * @param refreshToken - Current refresh token
   * @returns Promise resolving to new token pair
   * @throws AuthenticationError if refresh token is invalid or revoked
   */
  async refreshTokens(
    refreshToken: string
  ): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      // Verify refresh token
      const verification = await this.verifyRefreshToken(refreshToken);
      if (!verification.valid || !verification.payload) {
        throw new AuthenticationError('Invalid refresh token');
      }

      const payload = verification.payload as RefreshTokenPayload;
      const pool = getPool();

      // Check if token exists and is not revoked
      const tokenResult = await pool
        .request()
        .input('token_id', payload.tokenId)
        .query<RefreshTokenRecord>(`
          SELECT * FROM refresh_tokens WHERE id = @token_id
        `);

      const tokenRecord = tokenResult.recordset[0];

      if (!tokenRecord) {
        throw new AuthenticationError('Refresh token not found');
      }

      if (tokenRecord.is_revoked) {
        throw new AuthenticationError('Refresh token has been revoked');
      }

      if (new Date() > tokenRecord.expires_at) {
        throw new AuthenticationError('Refresh token has expired');
      }

      // Get user
      const userResult = await pool
        .request()
        .input('user_id', payload.userId)
        .query<UserRecord>(`
          SELECT * FROM users WHERE id = @user_id
        `);

      const user = userResult.recordset[0];

      if (!user || !user.is_active) {
        throw new AuthenticationError('User not found or inactive');
      }

      // Revoke old refresh token
      await pool
        .request()
        .input('token_id', payload.tokenId)
        .input('revoked_at', new Date()).query(`
          UPDATE refresh_tokens
          SET is_revoked = 1, revoked_at = @revoked_at
          WHERE id = @token_id
        `);

      // Generate new tokens
      const newTokens = await this.generateTokens(user);

      // Audit log
      await this.createAuditLog(user.id, 'token_refreshed', 'Access token refreshed');

      return newTokens;
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      console.error('[AuthService] Token refresh failed:', error);
      throw new AuthenticationError('Token refresh failed');
    }
  }

  /**
   * Generate JWT Tokens
   *
   * Generates both access and refresh tokens for a user.
   *
   * @param user - User record
   * @returns Promise resolving to token pair
   */
  private async generateTokens(
    user: UserRecord
  ): Promise<{ accessToken: string; refreshToken: string }> {
    if (!this.JWT_SECRET) {
      throw new AuthenticationError('JWT_SECRET not configured');
    }

    const pool = getPool();

    // Generate access token
    const accessPayload: Omit<JWTPayload, 'iat' | 'exp'> = {
      userId: user.id,
      email: user.email,
      role: user.role,
      isAdmin: user.is_admin,
    };

    const accessToken = jwt.sign(accessPayload, this.JWT_SECRET, {
      expiresIn: this.ACCESS_TOKEN_EXPIRY,
    } as jwt.SignOptions);

    // Generate refresh token
    const tokenId = crypto.randomUUID();
    const refreshPayload: Omit<RefreshTokenPayload, 'iat' | 'exp'> = {
      userId: user.id,
      tokenId,
    };

    const refreshToken = jwt.sign(refreshPayload, this.JWT_SECRET, {
      expiresIn: this.REFRESH_TOKEN_EXPIRY,
    } as jwt.SignOptions);

    // Hash refresh token and store in database
    const tokenHash = await bcrypt.hash(refreshToken, this.BCRYPT_ROUNDS);
    const expiresAt = new Date(Date.now() + this.parseExpiryToMs(this.REFRESH_TOKEN_EXPIRY));

    await pool
      .request()
      .input('id', tokenId)
      .input('user_id', user.id)
      .input('token_hash', tokenHash)
      .input('expires_at', expiresAt)
      .input('is_revoked', false)
      .input('created_at', new Date()).query(`
        INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, is_revoked, created_at)
        VALUES (@id, @user_id, @token_hash, @expires_at, @is_revoked, @created_at)
      `);

    return { accessToken, refreshToken };
  }

  /**
   * Verify Access Token
   *
   * Verifies and decodes a JWT access token.
   *
   * @param token - JWT access token
   * @returns Token verification result
   */
  verifyAccessToken(token: string): TokenVerificationResult {
    try {
      if (!this.JWT_SECRET) {
        return { valid: false, error: 'JWT_SECRET not configured' };
      }
      const payload = jwt.verify(token, this.JWT_SECRET) as JWTPayload;
      return { valid: true, payload };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { valid: false, error: message };
    }
  }

  /**
   * Verify Refresh Token
   *
   * Verifies and decodes a JWT refresh token.
   *
   * @param token - JWT refresh token
   * @returns Promise resolving to token verification result
   */
  async verifyRefreshToken(token: string): Promise<TokenVerificationResult> {
    try {
      if (!this.JWT_SECRET) {
        return { valid: false, error: 'JWT_SECRET not configured' };
      }
      const payload = jwt.verify(token, this.JWT_SECRET) as RefreshTokenPayload;
      return { valid: true, payload };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { valid: false, error: message };
    }
  }

  /**
   * Hash Password
   *
   * Hashes a plain text password using bcrypt.
   *
   * @param password - Plain text password
   * @returns Promise resolving to password hash
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.BCRYPT_ROUNDS);
  }

  /**
   * Compare Password
   *
   * Compares a plain text password with a bcrypt hash.
   *
   * @param password - Plain text password
   * @param hash - Bcrypt password hash
   * @returns Promise resolving to true if passwords match
   */
  async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Validate Password Strength
   *
   * Checks if a password meets security requirements.
   *
   * Requirements:
   * - Minimum 8 characters
   * - At least 1 uppercase letter
   * - At least 1 lowercase letter
   * - At least 1 number
   *
   * @param password - Password to validate
   * @returns Password validation result
   */
  validatePasswordStrength(password: string): PasswordValidationResult {
    const errors: string[] = [];

    if (password.length < 8) {
      errors.push('Password must be at least 8 characters long');
    }

    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least 1 uppercase letter');
    }

    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least 1 lowercase letter');
    }

    if (!/\d/.test(password)) {
      errors.push('Password must contain at least 1 number');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Map User Record to DTO
   *
   * Converts a database user record to a sanitized DTO for API responses.
   *
   * @param user - User record from database
   * @returns User DTO
   */
  private mapUserToDTO(user: UserRecord): UserDTO {
    return {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      isAdmin: user.is_admin,
      isActive: user.is_active,
      createdAt: user.created_at.toISOString(),
      lastLoginAt: user.last_login_at ? user.last_login_at.toISOString() : null,
    };
  }

  /**
   * Create Audit Log Entry
   *
   * Logs an authentication-related event to the audit log table.
   *
   * @param userId - User ID
   * @param eventType - Event type
   * @param eventData - Event description
   */
  private async createAuditLog(
    userId: string,
    eventType: string,
    eventData: string
  ): Promise<void> {
    try {
      const pool = getPool();
      const auditId = crypto.randomUUID();

      await pool
        .request()
        .input('id', auditId)
        .input('user_id', userId)
        .input('event_type', eventType)
        .input('event_data', eventData)
        .input('created_at', new Date()).query(`
          INSERT INTO audit_log (id, user_id, event_type, event_data, created_at)
          VALUES (@id, @user_id, @event_type, @event_data, @created_at)
        `);
    } catch (error) {
      console.error('[AuthService] Failed to create audit log:', error);
      // Don't throw - audit log failure shouldn't break auth flow
    }
  }

  /**
   * Parse Expiry String to Milliseconds
   *
   * Converts JWT expiry format (e.g., '24h', '7d') to milliseconds.
   *
   * @param expiry - Expiry string (e.g., '24h', '7d')
   * @returns Milliseconds
   */
  private parseExpiryToMs(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match || !match[1] || !match[2]) {
      throw new Error(`Invalid expiry format: ${expiry}`);
    }

    const value = parseInt(match[1], 10);
    const unit = match[2] as 's' | 'm' | 'h' | 'd';

    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    const multiplier = multipliers[unit];
    if (!multiplier) {
      throw new Error(`Invalid time unit: ${unit}`);
    }

    return value * multiplier;
  }

  /**
   * Check if Service is Configured
   *
   * @returns True if JWT_SECRET is set
   */
  isConfigured(): boolean {
    return Boolean(this.JWT_SECRET && this.JWT_SECRET.length > 0);
  }
}

// Singleton instance
let authServiceInstance: AuthService | null = null;

/**
 * Get Auth Service Singleton Instance
 *
 * @returns The shared AuthService instance
 */
export function getAuthService(): AuthService {
  if (!authServiceInstance) {
    authServiceInstance = new AuthService();
  }
  return authServiceInstance;
}
