/**
 * Mock Authentication Routes (Development Only)
 *
 * Temporary mock endpoints for testing UI without database connection.
 * Remove this file once database is properly configured.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const router = Router();

// Mock users storage (in-memory)
const mockUsers: Record<string, { id: string; email: string; fullName: string; passwordHash: string; role: string }> = {
  'test@example.com': {
    id: 'user-mock-1',
    email: 'test@example.com',
    fullName: 'Test User',
    passwordHash: bcrypt.hashSync('Test1234', 10), // Test1234
    role: 'admin',
  },
};

// Mock refresh tokens storage
const mockRefreshTokens: Set<string> = new Set();

const JWT_SECRET = process.env.JWT_SECRET || 'development-secret-key';

const registerSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(1, 'Full name is required'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

/**
 * Mock Register
 */
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = registerSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
      return;
    }

    const { email, password, fullName } = validation.data;

    // Check if user already exists
    if (mockUsers[email]) {
      res.status(400).json({
        error: 'Registration failed',
        message: 'Email already registered',
      });
      return;
    }

    // Create new mock user
    const userId = `user-mock-${Date.now()}`;
    const passwordHash = await bcrypt.hash(password, 10);

    mockUsers[email] = {
      id: userId,
      email,
      fullName,
      passwordHash,
      role: 'viewer',
    };

    // Generate tokens
    const accessToken = jwt.sign(
      { userId, email, role: 'viewer' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    const refreshToken = jwt.sign(
      { userId, email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    mockRefreshTokens.add(refreshToken);

    res.status(201).json({
      user: {
        id: userId,
        email,
        name: fullName,
        role: 'viewer',
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error('[Mock Auth] Register error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Registration failed',
    });
  }
});

/**
 * Mock Login
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = loginSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
      return;
    }

    const { email, password } = validation.data;

    // Check if user exists
    const user = mockUsers[email];
    if (!user) {
      res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid credentials',
      });
      return;
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid credentials',
      });
      return;
    }

    // Generate tokens
    const accessToken = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    const refreshToken = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    mockRefreshTokens.add(refreshToken);

    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.fullName,
        role: user.role,
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error('[Mock Auth] Login error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Login failed',
    });
  }
});

/**
 * Mock Refresh Token
 */
router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken || !mockRefreshTokens.has(refreshToken)) {
      res.status(401).json({
        error: 'Invalid refresh token',
      });
      return;
    }

    // Verify token
    const decoded = jwt.verify(refreshToken, JWT_SECRET) as unknown as { userId: string; email: string };

    // Generate new tokens
    const user = mockUsers[decoded.email];
    if (!user) {
      res.status(401).json({
        error: 'User not found',
      });
      return;
    }

    const newAccessToken = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    const newRefreshToken = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Revoke old token
    mockRefreshTokens.delete(refreshToken);
    mockRefreshTokens.add(newRefreshToken);

    res.status(200).json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    console.error('[Mock Auth] Refresh error:', error);
    res.status(401).json({
      error: 'Invalid refresh token',
    });
  }
});

/**
 * Mock Get Current User
 */
router.get('/me', (req: Request, res: Response): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: 'No authorization header provided' });
    return;
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as unknown as { userId: string; email: string; role: string };
    const user = mockUsers[decoded.email];

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.fullName,
        role: user.role,
      },
    });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

/**
 * Mock Logout
 */
router.post('/logout', (req: Request, res: Response): void => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    mockRefreshTokens.delete(refreshToken);
  }
  res.status(200).json({ message: 'Logged out successfully' });
});

export default router;
