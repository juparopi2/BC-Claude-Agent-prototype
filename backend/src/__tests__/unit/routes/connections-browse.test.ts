/**
 * Unit Tests - Connections Routes (PRD-101: Browse / Scopes / Sync endpoints)
 *
 * Tests for:
 *   GET  /:id/browse          - Browse root folder
 *   GET  /:id/browse/:folderId - Browse specific folder
 *   POST /:id/scopes           - Create sync scopes
 *   POST /:id/scopes/:scopeId/sync - Trigger initial sync (fire-and-forget)
 *   GET  /:id/sync-status      - Get sync status for all scopes
 *
 * @module __tests__/unit/routes/connections-browse
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Request, Response, NextFunction, Application } from 'express';

// ============================================================================
// Hoisted mock functions (must be created before vi.mock calls)
// ============================================================================

const {
  mockGetConnection,
  mockListScopes,
  mockCreateScope,
  mockFindScopeById,
  mockListFolder,
  mockListSharedWithMe,
  mockListSharedFolder,
  mockSyncScope,
} = vi.hoisted(() => ({
  mockGetConnection: vi.fn(),
  mockListScopes: vi.fn(),
  mockCreateScope: vi.fn(),
  mockFindScopeById: vi.fn(),
  mockListFolder: vi.fn(),
  mockListSharedWithMe: vi.fn(),
  mockListSharedFolder: vi.fn(),
  mockSyncScope: vi.fn(),
}));

// ============================================================================
// Mocks — must be declared before imports that trigger the modules
// ============================================================================

vi.mock('@/shared/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  })),
}));

vi.mock('@/domains/auth/middleware/auth-oauth', () => ({
  authenticateMicrosoft: (req: Request, _res: Response, next: NextFunction) => {
    req.userId = 'TEST-USER-ID-1111-2222-333333333333';
    next();
  },
}));

vi.mock('@/domains/connections', () => ({
  getConnectionService: vi.fn(() => ({
    getConnection: mockGetConnection,
    listConnections: vi.fn(),
    createConnection: vi.fn(),
    updateConnection: vi.fn(),
    deleteConnection: vi.fn(),
    listScopes: mockListScopes,
  })),
  getConnectionRepository: vi.fn(() => ({
    createScope: mockCreateScope,
    findScopeById: mockFindScopeById,
    findByUser: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findScopesByConnection: vi.fn(),
    countScopesByConnection: vi.fn(),
  })),
  ConnectionNotFoundError: class ConnectionNotFoundError extends Error {
    readonly code = 'CONNECTION_NOT_FOUND';
    constructor(id: string) {
      super(`Connection ${id} not found`);
      this.name = 'ConnectionNotFoundError';
    }
  },
  ConnectionForbiddenError: class ConnectionForbiddenError extends Error {
    readonly code = 'CONNECTION_FORBIDDEN';
    constructor(id: string) {
      super(`Access to connection ${id} is forbidden`);
      this.name = 'ConnectionForbiddenError';
    }
  },
  ScopeCurrentlySyncingError: class ScopeCurrentlySyncingError extends Error {
    readonly code = 'SCOPE_CURRENTLY_SYNCING';
    constructor(scopeId: string) {
      super(`Scope ${scopeId} is currently syncing`);
      this.name = 'ScopeCurrentlySyncingError';
    }
  },
}));

vi.mock('@/services/connectors/onedrive', () => ({
  getOneDriveService: vi.fn(() => ({
    listFolder: mockListFolder,
    listSharedWithMe: mockListSharedWithMe,
    listSharedFolder: mockListSharedFolder,
  })),
}));

vi.mock('@/services/sync/InitialSyncService', () => ({
  getInitialSyncService: vi.fn(() => ({
    syncScope: mockSyncScope,
  })),
}));

// Import router AFTER mocks are registered
import connectionsRouter from '@/routes/connections';

// ============================================================================
// Test constants
// ============================================================================

const CONNECTION_ID = 'A1A1A1A1-A1A1-A1A1-A1A1-A1A1A1A1A1A1';
const CONNECTION_ID_LC = CONNECTION_ID.toLowerCase();
const SCOPE_ID = 'B2B2B2B2-B2B2-B2B2-B2B2-B2B2B2B2B2B2';
const OTHER_CONNECTION_ID = 'C3C3C3C3-C3C3-C3C3-C3C3-C3C3C3C3C3C3';
const USER_ID = 'TEST-USER-ID-1111-2222-333333333333';

const sampleConnection = {
  id: CONNECTION_ID,
  provider: 'onedrive' as const,
  status: 'connected' as const,
  displayName: 'My OneDrive',
  lastError: null,
  lastErrorAt: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  scopeCount: 0,
};

const sampleFolderResult = {
  items: [
    { id: 'FOLDER-01', name: 'Documents', isFolder: true, mimeType: null, sizeBytes: 0, lastModifiedAt: '', webUrl: '', eTag: null, parentId: null },
    { id: 'FILE-01', name: 'report.pdf', isFolder: false, mimeType: 'application/pdf', sizeBytes: 1024, lastModifiedAt: '', webUrl: '', eTag: null, parentId: null },
  ],
  nextPageToken: undefined,
};

/** Expected browse response after enrichBrowseItems adds isSupported (PRD-106) */
const enrichedFolderResult = {
  items: [
    { id: 'FOLDER-01', name: 'Documents', isFolder: true, mimeType: null, sizeBytes: 0, lastModifiedAt: '', webUrl: '', eTag: null, parentId: null, isSupported: true },
    { id: 'FILE-01', name: 'report.pdf', isFolder: false, mimeType: 'application/pdf', sizeBytes: 1024, lastModifiedAt: '', webUrl: '', eTag: null, parentId: null, isSupported: true },
  ],
  nextPageToken: undefined,
};

const REMOTE_DRIVE_ID = 'REMOTE-DRIVE-001';
const REMOTE_ITEM_ID = 'REMOTE-ITEM-001';

const sampleSharedResult = {
  items: [
    { id: 'SHARED-FOLDER-01', name: 'Shared Docs', isFolder: true, mimeType: null, sizeBytes: 0, lastModifiedAt: '', webUrl: '', eTag: null, parentId: null, remoteDriveId: REMOTE_DRIVE_ID },
    { id: 'SHARED-FILE-01', name: 'contract.pdf', isFolder: false, mimeType: 'application/pdf', sizeBytes: 2048, lastModifiedAt: '', webUrl: '', eTag: null, parentId: null, remoteDriveId: REMOTE_DRIVE_ID },
  ],
  nextPageToken: undefined,
};

const enrichedSharedResult = {
  items: [
    { id: 'SHARED-FOLDER-01', name: 'Shared Docs', isFolder: true, mimeType: null, sizeBytes: 0, lastModifiedAt: '', webUrl: '', eTag: null, parentId: null, remoteDriveId: REMOTE_DRIVE_ID, isSupported: true },
    { id: 'SHARED-FILE-01', name: 'contract.pdf', isFolder: false, mimeType: 'application/pdf', sizeBytes: 2048, lastModifiedAt: '', webUrl: '', eTag: null, parentId: null, remoteDriveId: REMOTE_DRIVE_ID, isSupported: true },
  ],
  nextPageToken: undefined,
};

const sampleScope = {
  id: SCOPE_ID,
  connection_id: CONNECTION_ID,
  scope_type: 'folder',
  scope_resource_id: 'FOLDER-01',
  scope_display_name: 'Documents',
  scope_path: '/Documents',
  sync_status: 'pending',
  last_sync_at: null,
  last_sync_error: null,
  last_sync_cursor: null,
  item_count: 0,
  created_at: new Date('2025-01-01'),
};

const sampleScopeDetail = {
  id: SCOPE_ID,
  connectionId: CONNECTION_ID,
  scopeType: 'folder',
  scopeResourceId: 'FOLDER-01',
  scopeDisplayName: 'Documents',
  syncStatus: 'pending',
  lastSyncAt: null,
  lastSyncError: null,
  itemCount: 0,
  createdAt: '2025-01-01T00:00:00.000Z',
};

// ============================================================================
// Test Suite
// ============================================================================

describe('Connections Routes — PRD-101 (browse / scopes / sync)', () => {
  let app: Application;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/connections', connectionsRouter);

    // Add a generic error handler so unexpected errors return 500
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      res.status(500).json({ error: 'Internal Server Error', message: err.message, code: 'INTERNAL_ERROR' });
    });

    // Default happy-path mock values
    mockGetConnection.mockResolvedValue(sampleConnection);
    mockListScopes.mockResolvedValue([sampleScopeDetail]);
    mockListFolder.mockResolvedValue(sampleFolderResult);
    mockListSharedWithMe.mockResolvedValue(sampleSharedResult);
    mockListSharedFolder.mockResolvedValue(sampleFolderResult);
    mockCreateScope.mockResolvedValue(SCOPE_ID);
    mockFindScopeById.mockResolvedValue(sampleScope);
    mockSyncScope.mockResolvedValue(undefined);
  });

  // ==========================================================================
  // GET /:id/browse — Browse root folder
  // ==========================================================================
  describe('GET /:id/browse', () => {
    it('returns the folder listing enriched with isSupported from OneDriveService.listFolder', async () => {
      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/browse`)
        .expect(200);

      expect(res.body).toEqual(enrichedFolderResult);
      expect(mockListFolder).toHaveBeenCalledWith(CONNECTION_ID, undefined, undefined);
    });

    it('validates connection ownership by calling getConnection', async () => {
      await request(app)
        .get(`/api/connections/${CONNECTION_ID}/browse`)
        .expect(200);

      expect(mockGetConnection).toHaveBeenCalledWith(USER_ID, CONNECTION_ID);
    });

    it('returns 404 when connection is not found (ConnectionNotFoundError)', async () => {
      const { ConnectionNotFoundError } = await import('@/domains/connections');
      mockGetConnection.mockRejectedValue(new ConnectionNotFoundError(CONNECTION_ID));

      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/browse`)
        .expect(404);

      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('passes pageToken query parameter to listFolder', async () => {
      const token = 'page-token-abc123';
      await request(app)
        .get(`/api/connections/${CONNECTION_ID}/browse`)
        .query({ pageToken: token })
        .expect(200);

      expect(mockListFolder).toHaveBeenCalledWith(CONNECTION_ID, undefined, token);
    });

    it('normalises connection ID to uppercase before passing to services', async () => {
      await request(app)
        .get(`/api/connections/${CONNECTION_ID_LC}/browse`)
        .expect(200);

      // parseConnectionId calls .toUpperCase() on the validated id
      expect(mockGetConnection).toHaveBeenCalledWith(USER_ID, CONNECTION_ID);
      expect(mockListFolder).toHaveBeenCalledWith(CONNECTION_ID, undefined, undefined);
    });

    it('returns 400 when connection ID is not a valid UUID', async () => {
      const res = await request(app)
        .get('/api/connections/not-a-uuid/browse')
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('sets isSupported correctly for folders, supported files, unsupported files, and null mimeType', async () => {
      mockListFolder.mockResolvedValue({
        items: [
          { id: 'F1', name: 'Docs', isFolder: true, mimeType: null, sizeBytes: 0, lastModifiedAt: '', webUrl: '', eTag: null, parentId: null },
          { id: 'F2', name: 'notes.txt', isFolder: false, mimeType: 'text/plain', sizeBytes: 100, lastModifiedAt: '', webUrl: '', eTag: null, parentId: null },
          { id: 'F3', name: 'archive.zip', isFolder: false, mimeType: 'application/zip', sizeBytes: 2000, lastModifiedAt: '', webUrl: '', eTag: null, parentId: null },
          { id: 'F4', name: 'unknown', isFolder: false, mimeType: null, sizeBytes: 500, lastModifiedAt: '', webUrl: '', eTag: null, parentId: null },
        ],
        nextPageToken: null,
      });

      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/browse`)
        .expect(200);

      expect(res.body.items).toEqual([
        expect.objectContaining({ id: 'F1', isSupported: true }),    // folder → always true
        expect.objectContaining({ id: 'F2', isSupported: true }),    // text/plain → supported
        expect.objectContaining({ id: 'F3', isSupported: false }),   // application/zip → unsupported
        expect.objectContaining({ id: 'F4', isSupported: false }),   // null mimeType → unsupported
      ]);
    });

    it('returns 401 when OneDrive token is expired (ConnectionTokenExpiredError)', async () => {
      const tokenError = new Error('Token expired for connection');
      tokenError.name = 'ConnectionTokenExpiredError';
      mockListFolder.mockRejectedValue(tokenError);

      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/browse`)
        .expect(401);

      expect(res.body.code).toBe('INVALID_TOKEN');
    });

    it('returns 401 when Graph API returns 401 (GraphApiError)', async () => {
      const graphError = Object.assign(new Error('InvalidAuthenticationToken'), {
        name: 'GraphApiError',
        statusCode: 401,
        graphErrorCode: 'InvalidAuthenticationToken',
      });
      mockListFolder.mockRejectedValue(graphError);

      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/browse`)
        .expect(401);

      expect(res.body.code).toBe('INVALID_TOKEN');
    });
  });

  // ==========================================================================
  // GET /:id/browse/:folderId — Browse specific folder
  // ==========================================================================
  describe('GET /:id/browse/:folderId', () => {
    const FOLDER_ID = 'FOLDER-RESOURCE-01';

    it('returns folder listing enriched with isSupported with folderId passed to listFolder', async () => {
      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/browse/${FOLDER_ID}`)
        .expect(200);

      expect(res.body).toEqual(enrichedFolderResult);
      expect(mockListFolder).toHaveBeenCalledWith(CONNECTION_ID, FOLDER_ID, undefined);
    });

    it('passes pageToken query parameter along with folderId', async () => {
      const token = 'next-page-token';
      await request(app)
        .get(`/api/connections/${CONNECTION_ID}/browse/${FOLDER_ID}`)
        .query({ pageToken: token })
        .expect(200);

      expect(mockListFolder).toHaveBeenCalledWith(CONNECTION_ID, FOLDER_ID, token);
    });

    it('returns 404 when connection is not found', async () => {
      const { ConnectionNotFoundError } = await import('@/domains/connections');
      mockGetConnection.mockRejectedValue(new ConnectionNotFoundError(CONNECTION_ID));

      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/browse/${FOLDER_ID}`)
        .expect(404);

      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('returns 403 when connection is forbidden (ConnectionForbiddenError)', async () => {
      const { ConnectionForbiddenError } = await import('@/domains/connections');
      mockGetConnection.mockRejectedValue(new ConnectionForbiddenError(CONNECTION_ID));

      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/browse/${FOLDER_ID}`)
        .expect(403);

      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('returns 400 when connection ID is not a valid UUID', async () => {
      const res = await request(app)
        .get('/api/connections/bad-id/browse/some-folder')
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  // ==========================================================================
  // POST /:id/scopes — Create sync scopes
  // ==========================================================================
  describe('POST /:id/scopes', () => {
    const validBody = {
      scopes: [
        {
          scopeType: 'folder',
          scopeResourceId: 'FOLDER-01',
          scopeDisplayName: 'Documents',
          scopePath: '/Documents',
        },
      ],
    };

    it('creates scopes and returns 201 with scope objects', async () => {
      const res = await request(app)
        .post(`/api/connections/${CONNECTION_ID}/scopes`)
        .send(validBody)
        .expect(201);

      expect(res.body).toHaveProperty('scopes');
      expect(res.body.scopes).toHaveLength(1);
      expect(mockCreateScope).toHaveBeenCalledTimes(1);
      expect(mockCreateScope).toHaveBeenCalledWith(
        CONNECTION_ID,
        expect.objectContaining({
          scopeType: 'folder',
          scopeResourceId: 'FOLDER-01',
          scopeDisplayName: 'Documents',
          scopePath: '/Documents',
        })
      );
    });

    it('calls findScopeById after createScope to retrieve the created scope', async () => {
      await request(app)
        .post(`/api/connections/${CONNECTION_ID}/scopes`)
        .send(validBody)
        .expect(201);

      expect(mockFindScopeById).toHaveBeenCalledWith(SCOPE_ID);
    });

    it('verifies connection ownership before creating scopes', async () => {
      await request(app)
        .post(`/api/connections/${CONNECTION_ID}/scopes`)
        .send(validBody)
        .expect(201);

      expect(mockGetConnection).toHaveBeenCalledWith(USER_ID, CONNECTION_ID);
    });

    it('returns 400 when request body is invalid (missing scopes)', async () => {
      const res = await request(app)
        .post(`/api/connections/${CONNECTION_ID}/scopes`)
        .send({})
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(mockCreateScope).not.toHaveBeenCalled();
    });

    it('returns 400 when scopes array is empty', async () => {
      const res = await request(app)
        .post(`/api/connections/${CONNECTION_ID}/scopes`)
        .send({ scopes: [] })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when scopeType is invalid', async () => {
      const res = await request(app)
        .post(`/api/connections/${CONNECTION_ID}/scopes`)
        .send({
          scopes: [
            {
              scopeType: 'invalid_type',
              scopeResourceId: 'FOLDER-01',
              scopeDisplayName: 'Documents',
            },
          ],
        })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when scopeDisplayName is missing', async () => {
      const res = await request(app)
        .post(`/api/connections/${CONNECTION_ID}/scopes`)
        .send({
          scopes: [
            {
              scopeType: 'folder',
              scopeResourceId: 'FOLDER-01',
              // no scopeDisplayName
            },
          ],
        })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 when connection is not found', async () => {
      const { ConnectionNotFoundError } = await import('@/domains/connections');
      mockGetConnection.mockRejectedValue(new ConnectionNotFoundError(CONNECTION_ID));

      const res = await request(app)
        .post(`/api/connections/${CONNECTION_ID}/scopes`)
        .send(validBody)
        .expect(404);

      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('creates multiple scopes from one request', async () => {
      const secondScopeId = 'D4D4D4D4-D4D4-D4D4-D4D4-D4D4D4D4D4D4';
      const secondScope = { ...sampleScope, id: secondScopeId };

      mockCreateScope
        .mockResolvedValueOnce(SCOPE_ID)
        .mockResolvedValueOnce(secondScopeId);
      mockFindScopeById
        .mockResolvedValueOnce(sampleScope)
        .mockResolvedValueOnce(secondScope);

      const res = await request(app)
        .post(`/api/connections/${CONNECTION_ID}/scopes`)
        .send({
          scopes: [
            { scopeType: 'folder', scopeResourceId: 'FOLDER-01', scopeDisplayName: 'Documents' },
            { scopeType: 'folder', scopeResourceId: 'FOLDER-02', scopeDisplayName: 'Pictures' },
          ],
        })
        .expect(201);

      expect(mockCreateScope).toHaveBeenCalledTimes(2);
      expect(res.body.scopes).toHaveLength(2);
    });

    it('normalises connection ID to uppercase', async () => {
      await request(app)
        .post(`/api/connections/${CONNECTION_ID_LC}/scopes`)
        .send(validBody)
        .expect(201);

      expect(mockGetConnection).toHaveBeenCalledWith(USER_ID, CONNECTION_ID);
      expect(mockCreateScope).toHaveBeenCalledWith(CONNECTION_ID, expect.any(Object));
    });
  });

  // ==========================================================================
  // POST /:id/scopes/:scopeId/sync — Trigger initial sync
  // ==========================================================================
  describe('POST /:id/scopes/:scopeId/sync', () => {
    it('returns 202 with { status: "started" } and calls syncScope', async () => {
      const res = await request(app)
        .post(`/api/connections/${CONNECTION_ID}/scopes/${SCOPE_ID}/sync`)
        .expect(202);

      expect(res.body).toEqual({ status: 'started' });
      expect(mockSyncScope).toHaveBeenCalledWith(CONNECTION_ID, SCOPE_ID, USER_ID);
    });

    it('does not await syncScope (fire-and-forget) — response returns immediately', async () => {
      // syncScope is async but we should still get 202 even if it resolves later
      let syncCalled = false;
      mockSyncScope.mockImplementation(() => {
        syncCalled = true;
        return Promise.resolve();
      });

      const res = await request(app)
        .post(`/api/connections/${CONNECTION_ID}/scopes/${SCOPE_ID}/sync`)
        .expect(202);

      expect(res.body.status).toBe('started');
      // syncScope was still called (fire-and-forget means we don't await)
      expect(syncCalled).toBe(true);
    });

    it('returns 404 when scope is not found', async () => {
      mockFindScopeById.mockResolvedValue(null);

      const res = await request(app)
        .post(`/api/connections/${CONNECTION_ID}/scopes/${SCOPE_ID}/sync`)
        .expect(404);

      expect(res.body.code).toBe('NOT_FOUND');
      expect(mockSyncScope).not.toHaveBeenCalled();
    });

    it('returns 403 when scope belongs to a different connection', async () => {
      mockFindScopeById.mockResolvedValue({
        ...sampleScope,
        connection_id: OTHER_CONNECTION_ID, // different connection
      });

      const res = await request(app)
        .post(`/api/connections/${CONNECTION_ID}/scopes/${SCOPE_ID}/sync`)
        .expect(403);

      expect(res.body.code).toBe('FORBIDDEN');
      expect(mockSyncScope).not.toHaveBeenCalled();
    });

    it('verifies connection ownership before triggering sync', async () => {
      await request(app)
        .post(`/api/connections/${CONNECTION_ID}/scopes/${SCOPE_ID}/sync`)
        .expect(202);

      expect(mockGetConnection).toHaveBeenCalledWith(USER_ID, CONNECTION_ID);
    });

    it('returns 404 when connection is not found', async () => {
      const { ConnectionNotFoundError } = await import('@/domains/connections');
      mockGetConnection.mockRejectedValue(new ConnectionNotFoundError(CONNECTION_ID));

      const res = await request(app)
        .post(`/api/connections/${CONNECTION_ID}/scopes/${SCOPE_ID}/sync`)
        .expect(404);

      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('normalises scope ID to uppercase', async () => {
      const scopeIdLC = SCOPE_ID.toLowerCase();
      // findScopeById should be called with the uppercased version
      await request(app)
        .post(`/api/connections/${CONNECTION_ID}/scopes/${scopeIdLC}/sync`)
        .expect(202);

      expect(mockFindScopeById).toHaveBeenCalledWith(SCOPE_ID);
      expect(mockSyncScope).toHaveBeenCalledWith(CONNECTION_ID, SCOPE_ID, USER_ID);
    });

    it('returns 400 when connection ID is not a valid UUID', async () => {
      const res = await request(app)
        .post(`/api/connections/not-valid/scopes/${SCOPE_ID}/sync`)
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  // ==========================================================================
  // GET /:id/browse-shared — Browse shared items (PRD-110)
  // ==========================================================================
  describe('GET /:id/browse-shared', () => {
    it('returns enriched shared items from OneDriveService.listSharedWithMe', async () => {
      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/browse-shared`)
        .expect(200);

      expect(res.body).toEqual(enrichedSharedResult);
      expect(mockListSharedWithMe).toHaveBeenCalledWith(CONNECTION_ID);
    });

    it('validates connection ownership by calling getConnection', async () => {
      await request(app)
        .get(`/api/connections/${CONNECTION_ID}/browse-shared`)
        .expect(200);

      expect(mockGetConnection).toHaveBeenCalledWith(USER_ID, CONNECTION_ID);
    });

    it('returns 401 when OneDrive token is expired (ConnectionTokenExpiredError)', async () => {
      const tokenError = new Error('Token expired for connection');
      tokenError.name = 'ConnectionTokenExpiredError';
      mockListSharedWithMe.mockRejectedValue(tokenError);

      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/browse-shared`)
        .expect(401);

      expect(res.body.code).toBe('INVALID_TOKEN');
    });

    it('returns 401 when Graph API returns 401 (GraphApiError)', async () => {
      const graphError = Object.assign(new Error('InvalidAuthenticationToken'), {
        name: 'GraphApiError',
        statusCode: 401,
        graphErrorCode: 'InvalidAuthenticationToken',
      });
      mockListSharedWithMe.mockRejectedValue(graphError);

      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/browse-shared`)
        .expect(401);

      expect(res.body.code).toBe('INVALID_TOKEN');
    });

    it('returns 404 when connection is not found (ConnectionNotFoundError)', async () => {
      const { ConnectionNotFoundError } = await import('@/domains/connections');
      mockGetConnection.mockRejectedValue(new ConnectionNotFoundError(CONNECTION_ID));

      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/browse-shared`)
        .expect(404);

      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('returns 400 when connection ID is not a valid UUID', async () => {
      const res = await request(app)
        .get('/api/connections/not-a-uuid/browse-shared')
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  // ==========================================================================
  // GET /:id/browse-shared/:driveId/:itemId — Browse inside a shared folder (PRD-110)
  // ==========================================================================
  describe('GET /:id/browse-shared/:driveId/:itemId', () => {
    it('returns enriched children from OneDriveService.listSharedFolder', async () => {
      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/browse-shared/${REMOTE_DRIVE_ID}/${REMOTE_ITEM_ID}`)
        .expect(200);

      expect(res.body).toEqual(enrichedFolderResult);
      expect(mockListSharedFolder).toHaveBeenCalledWith(
        CONNECTION_ID,
        REMOTE_DRIVE_ID,
        REMOTE_ITEM_ID,
        undefined
      );
    });

    it('passes pageToken query parameter to listSharedFolder', async () => {
      const token = 'shared-page-token-xyz';
      await request(app)
        .get(`/api/connections/${CONNECTION_ID}/browse-shared/${REMOTE_DRIVE_ID}/${REMOTE_ITEM_ID}`)
        .query({ pageToken: token })
        .expect(200);

      expect(mockListSharedFolder).toHaveBeenCalledWith(
        CONNECTION_ID,
        REMOTE_DRIVE_ID,
        REMOTE_ITEM_ID,
        token
      );
    });

    it('validates connection ownership before listing shared folder', async () => {
      await request(app)
        .get(`/api/connections/${CONNECTION_ID}/browse-shared/${REMOTE_DRIVE_ID}/${REMOTE_ITEM_ID}`)
        .expect(200);

      expect(mockGetConnection).toHaveBeenCalledWith(USER_ID, CONNECTION_ID);
    });

    it('returns 401 when token expired for shared folder access', async () => {
      const tokenError = new Error('Token expired');
      tokenError.name = 'ConnectionTokenExpiredError';
      mockListSharedFolder.mockRejectedValue(tokenError);

      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/browse-shared/${REMOTE_DRIVE_ID}/${REMOTE_ITEM_ID}`)
        .expect(401);

      expect(res.body.code).toBe('INVALID_TOKEN');
    });

    it('returns 400 when connection ID is not a valid UUID', async () => {
      const res = await request(app)
        .get(`/api/connections/bad-id/browse-shared/${REMOTE_DRIVE_ID}/${REMOTE_ITEM_ID}`)
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  // ==========================================================================
  // POST /:id/scopes — remoteDriveId forwarding (PRD-110)
  // ==========================================================================
  describe('POST /:id/scopes — remoteDriveId forwarding', () => {
    it('forwards remoteDriveId to createScope when provided', async () => {
      const res = await request(app)
        .post(`/api/connections/${CONNECTION_ID}/scopes`)
        .send({
          scopes: [
            {
              scopeType: 'folder',
              scopeResourceId: REMOTE_ITEM_ID,
              scopeDisplayName: 'Shared Documents',
              scopePath: '/Shared Documents',
              remoteDriveId: REMOTE_DRIVE_ID,
            },
          ],
        })
        .expect(201);

      expect(res.body).toHaveProperty('scopes');
      expect(mockCreateScope).toHaveBeenCalledWith(
        CONNECTION_ID,
        expect.objectContaining({
          scopeType: 'folder',
          scopeResourceId: REMOTE_ITEM_ID,
          scopeDisplayName: 'Shared Documents',
          remoteDriveId: REMOTE_DRIVE_ID,
        })
      );
    });

    it('omits remoteDriveId from createScope when not provided (non-shared scope)', async () => {
      await request(app)
        .post(`/api/connections/${CONNECTION_ID}/scopes`)
        .send({
          scopes: [
            {
              scopeType: 'folder',
              scopeResourceId: 'LOCAL-FOLDER-01',
              scopeDisplayName: 'My Documents',
            },
          ],
        })
        .expect(201);

      expect(mockCreateScope).toHaveBeenCalledWith(
        CONNECTION_ID,
        expect.objectContaining({
          scopeType: 'folder',
          scopeResourceId: 'LOCAL-FOLDER-01',
          scopeDisplayName: 'My Documents',
        })
      );
      // remoteDriveId should be undefined (not present) for non-shared scopes
      const callArg = mockCreateScope.mock.calls[0]![1] as Record<string, unknown>;
      expect(callArg.remoteDriveId).toBeUndefined();
    });
  });

  // ==========================================================================
  // GET /:id/sync-status — Get sync status for all scopes
  // ==========================================================================
  describe('GET /:id/sync-status', () => {
    it('returns scopes array from ConnectionService.listScopes', async () => {
      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/sync-status`)
        .expect(200);

      expect(res.body).toEqual({ scopes: [sampleScopeDetail] });
      expect(mockListScopes).toHaveBeenCalledWith(USER_ID, CONNECTION_ID);
    });

    it('returns empty scopes array when no scopes exist', async () => {
      mockListScopes.mockResolvedValue([]);

      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/sync-status`)
        .expect(200);

      expect(res.body).toEqual({ scopes: [] });
    });

    it('returns 404 when connection is not found (ConnectionNotFoundError)', async () => {
      const { ConnectionNotFoundError } = await import('@/domains/connections');
      mockListScopes.mockRejectedValue(new ConnectionNotFoundError(CONNECTION_ID));

      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/sync-status`)
        .expect(404);

      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('returns 403 when connection is forbidden', async () => {
      const { ConnectionForbiddenError } = await import('@/domains/connections');
      mockListScopes.mockRejectedValue(new ConnectionForbiddenError(CONNECTION_ID));

      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/sync-status`)
        .expect(403);

      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('normalises connection ID to uppercase', async () => {
      await request(app)
        .get(`/api/connections/${CONNECTION_ID_LC}/sync-status`)
        .expect(200);

      expect(mockListScopes).toHaveBeenCalledWith(USER_ID, CONNECTION_ID);
    });

    it('returns 400 when connection ID is not a valid UUID', async () => {
      const res = await request(app)
        .get('/api/connections/bad-id/sync-status')
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });
});
