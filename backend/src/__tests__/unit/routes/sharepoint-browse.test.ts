/**
 * Unit Tests - SharePoint Browse Routes (PRD-111)
 *
 * Tests for:
 *   GET  /:id/sites                                         - List SharePoint sites
 *   GET  /:id/sites/:siteId/libraries                       - List document libraries
 *   GET  /:id/sites/:siteId/libraries/:driveId/browse       - Browse root folder
 *   GET  /:id/sites/:siteId/libraries/:driveId/browse/:folderId - Browse specific folder
 *
 * @module __tests__/unit/routes/sharepoint-browse
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Request, Response, NextFunction, Application } from 'express';

// ============================================================================
// Hoisted mock functions (must be created before vi.mock calls)
// ============================================================================

const {
  mockGetConnection,
  mockDiscoverSites,
  mockGetLibraries,
  mockBrowseFolder,
} = vi.hoisted(() => ({
  mockGetConnection: vi.fn(),
  mockDiscoverSites: vi.fn(),
  mockGetLibraries: vi.fn(),
  mockBrowseFolder: vi.fn(),
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
}));

vi.mock('@/services/connectors/sharepoint', () => ({
  getSharePointService: vi.fn(() => ({
    discoverSites: mockDiscoverSites,
    getLibraries: mockGetLibraries,
    browseFolder: mockBrowseFolder,
  })),
}));

// Import router AFTER mocks are registered
import sharepointBrowseRouter from '@/routes/sharepoint-browse';

// ============================================================================
// Test constants
// ============================================================================

const CONNECTION_ID = 'A1A1A1A1-A1A1-A1A1-A1A1-A1A1A1A1A1A1';
const CONNECTION_ID_LC = CONNECTION_ID.toLowerCase();
const SITE_ID = 'SITE-0001-ABCD-1234-EFGH-SITE-WEB-0001';
const DRIVE_ID = 'DRIVE-001-ABCDEF';
const FOLDER_ID = 'FOLDER-RESOURCE-01';
const USER_ID = 'TEST-USER-ID-1111-2222-333333333333';

const sampleConnection = {
  id: CONNECTION_ID,
  provider: 'sharepoint' as const,
  status: 'connected' as const,
  displayName: 'My SharePoint',
  lastError: null,
  lastErrorAt: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  scopeCount: 0,
};

const sampleSitesResult = {
  sites: [
    {
      siteId: SITE_ID,
      displayName: 'Contoso Team Site',
      description: 'Main team site',
      webUrl: 'https://contoso.sharepoint.com/sites/team',
      isPersonalSite: false,
      lastModifiedAt: '2025-01-01T00:00:00.000Z',
    },
  ],
  nextPageToken: null,
};

const sampleLibrariesResult = {
  libraries: [
    {
      driveId: DRIVE_ID,
      displayName: 'Documents',
      description: null,
      webUrl: 'https://contoso.sharepoint.com/sites/team/Shared%20Documents',
      itemCount: 0,
      sizeBytes: 1024,
      isSystemLibrary: false,
      siteId: SITE_ID,
      siteName: 'Contoso Team Site',
    },
  ],
};

const sampleFolderResult = {
  items: [
    {
      id: 'FOLDER-01',
      name: 'Documents',
      isFolder: true,
      mimeType: null,
      sizeBytes: 0,
      lastModifiedAt: '',
      webUrl: '',
      eTag: null,
      parentId: null,
      parentPath: null,
      childCount: 2,
    },
    {
      id: 'FILE-01',
      name: 'report.pdf',
      isFolder: false,
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      lastModifiedAt: '',
      webUrl: '',
      eTag: null,
      parentId: null,
      parentPath: null,
      childCount: null,
    },
  ],
  nextPageToken: null,
};

/** Expected browse response after enriching items with isSupported */
const enrichedFolderResult = {
  items: [
    {
      id: 'FOLDER-01',
      name: 'Documents',
      isFolder: true,
      mimeType: null,
      sizeBytes: 0,
      lastModifiedAt: '',
      webUrl: '',
      eTag: null,
      parentId: null,
      parentPath: null,
      childCount: 2,
      isSupported: true,
    },
    {
      id: 'FILE-01',
      name: 'report.pdf',
      isFolder: false,
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      lastModifiedAt: '',
      webUrl: '',
      eTag: null,
      parentId: null,
      parentPath: null,
      childCount: null,
      isSupported: true,
    },
  ],
  nextPageToken: null,
};

// ============================================================================
// Test Suite
// ============================================================================

describe('SharePoint Browse Routes — PRD-111 (sites / libraries / browse)', () => {
  let app: Application;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/connections', sharepointBrowseRouter);

    // Add a generic error handler so unexpected errors return 500
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      res.status(500).json({ error: 'Internal Server Error', message: err.message, code: 'INTERNAL_ERROR' });
    });

    // Default happy-path mock values
    mockGetConnection.mockResolvedValue(sampleConnection);
    mockDiscoverSites.mockResolvedValue(sampleSitesResult);
    mockGetLibraries.mockResolvedValue(sampleLibrariesResult);
    mockBrowseFolder.mockResolvedValue(sampleFolderResult);
  });

  // ==========================================================================
  // GET /:id/sites — List SharePoint sites
  // ==========================================================================
  describe('GET /:id/sites', () => {
    it('returns sites list from SharePointService.discoverSites', async () => {
      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/sites`)
        .expect(200);

      expect(res.body).toEqual(sampleSitesResult);
      expect(mockDiscoverSites).toHaveBeenCalledWith(CONNECTION_ID, undefined, undefined);
    });

    it('validates connection ownership by calling getConnection', async () => {
      await request(app)
        .get(`/api/connections/${CONNECTION_ID}/sites`)
        .expect(200);

      expect(mockGetConnection).toHaveBeenCalledWith(USER_ID, CONNECTION_ID);
    });

    it('passes search query param to discoverSites', async () => {
      const search = 'marketing';

      await request(app)
        .get(`/api/connections/${CONNECTION_ID}/sites`)
        .query({ search })
        .expect(200);

      expect(mockDiscoverSites).toHaveBeenCalledWith(CONNECTION_ID, search, undefined);
    });

    it('passes pageToken query param for pagination to discoverSites', async () => {
      const pageToken = 'page-token-abc123';

      await request(app)
        .get(`/api/connections/${CONNECTION_ID}/sites`)
        .query({ pageToken })
        .expect(200);

      expect(mockDiscoverSites).toHaveBeenCalledWith(CONNECTION_ID, undefined, pageToken);
    });

    it('returns 500 when connection is not found (ConnectionNotFoundError)', async () => {
      const { ConnectionNotFoundError } = await import('@/domains/connections');
      mockGetConnection.mockRejectedValue(new ConnectionNotFoundError(CONNECTION_ID));

      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/sites`)
        .expect(500);

      expect(res.body.code).toBe('INTERNAL_ERROR');
    });

    it('returns 500 when connection is forbidden (ConnectionForbiddenError)', async () => {
      const { ConnectionForbiddenError } = await import('@/domains/connections');
      mockGetConnection.mockRejectedValue(new ConnectionForbiddenError(CONNECTION_ID));

      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/sites`)
        .expect(500);

      expect(res.body.code).toBe('INTERNAL_ERROR');
    });

    it('returns 400 when connection is not a SharePoint connection', async () => {
      mockGetConnection.mockResolvedValue({ ...sampleConnection, provider: 'onedrive' });

      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/sites`)
        .expect(400);

      expect(res.body.code).toBe('BAD_REQUEST');
    });

    it('normalises connection ID to uppercase before passing to services', async () => {
      await request(app)
        .get(`/api/connections/${CONNECTION_ID_LC}/sites`)
        .expect(200);

      expect(mockGetConnection).toHaveBeenCalledWith(USER_ID, CONNECTION_ID);
      expect(mockDiscoverSites).toHaveBeenCalledWith(CONNECTION_ID, undefined, undefined);
    });
  });

  // ==========================================================================
  // GET /:id/sites/:siteId/libraries — List document libraries
  // ==========================================================================
  describe('GET /:id/sites/:siteId/libraries', () => {
    it('returns libraries list from SharePointService.getLibraries', async () => {
      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/sites/${SITE_ID}/libraries`)
        .expect(200);

      expect(res.body).toEqual(sampleLibrariesResult);
      expect(mockGetLibraries).toHaveBeenCalledWith(CONNECTION_ID, SITE_ID, false);
    });

    it('passes includeSystem=true flag to getLibraries when provided', async () => {
      await request(app)
        .get(`/api/connections/${CONNECTION_ID}/sites/${SITE_ID}/libraries`)
        .query({ includeSystem: 'true' })
        .expect(200);

      expect(mockGetLibraries).toHaveBeenCalledWith(CONNECTION_ID, SITE_ID, true);
    });

    it('defaults includeSystem to false when query param is omitted', async () => {
      await request(app)
        .get(`/api/connections/${CONNECTION_ID}/sites/${SITE_ID}/libraries`)
        .expect(200);

      expect(mockGetLibraries).toHaveBeenCalledWith(CONNECTION_ID, SITE_ID, false);
    });

    it('returns 500 when connection is not found (ConnectionNotFoundError)', async () => {
      const { ConnectionNotFoundError } = await import('@/domains/connections');
      mockGetConnection.mockRejectedValue(new ConnectionNotFoundError(CONNECTION_ID));

      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/sites/${SITE_ID}/libraries`)
        .expect(500);

      expect(res.body.code).toBe('INTERNAL_ERROR');
    });

    it('returns 400 when connection is not a SharePoint connection', async () => {
      mockGetConnection.mockResolvedValue({ ...sampleConnection, provider: 'onedrive' });

      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/sites/${SITE_ID}/libraries`)
        .expect(400);

      expect(res.body.code).toBe('BAD_REQUEST');
    });
  });

  // ==========================================================================
  // GET /:id/sites/:siteId/libraries/:driveId/browse — Browse folder
  // ==========================================================================
  describe('GET /:id/sites/:siteId/libraries/:driveId/browse (root and folder)', () => {
    it('browses root when no folderId provided — calls browseFolder with undefined folderId', async () => {
      // The route uses Express 5 optional param syntax {/:folderId}, so the root
      // browse URL requires a trailing slash: /browse/ (folderId undefined)
      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/sites/${SITE_ID}/libraries/${DRIVE_ID}/browse/`)
        .expect(200);

      expect(res.body).toEqual(enrichedFolderResult);
      expect(mockBrowseFolder).toHaveBeenCalledWith(CONNECTION_ID, DRIVE_ID, undefined, undefined);
    });

    it('browses specific folder when folderId is provided', async () => {
      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/sites/${SITE_ID}/libraries/${DRIVE_ID}/browse/${FOLDER_ID}`)
        .expect(200);

      expect(res.body).toEqual(enrichedFolderResult);
      expect(mockBrowseFolder).toHaveBeenCalledWith(CONNECTION_ID, DRIVE_ID, FOLDER_ID, undefined);
    });

    it('enriches response items: folders always isSupported=true, files based on mimeType', async () => {
      mockBrowseFolder.mockResolvedValue({
        items: [
          { id: 'F1', name: 'Docs', isFolder: true, mimeType: null, sizeBytes: 0, lastModifiedAt: '', webUrl: '', eTag: null, parentId: null, parentPath: null, childCount: 2 },
          { id: 'F2', name: 'notes.txt', isFolder: false, mimeType: 'text/plain', sizeBytes: 100, lastModifiedAt: '', webUrl: '', eTag: null, parentId: null, parentPath: null, childCount: null },
          { id: 'F3', name: 'archive.zip', isFolder: false, mimeType: 'application/zip', sizeBytes: 2000, lastModifiedAt: '', webUrl: '', eTag: null, parentId: null, parentPath: null, childCount: null },
          { id: 'F4', name: 'unknown', isFolder: false, mimeType: null, sizeBytes: 500, lastModifiedAt: '', webUrl: '', eTag: null, parentId: null, parentPath: null, childCount: null },
        ],
        nextPageToken: null,
      });

      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/sites/${SITE_ID}/libraries/${DRIVE_ID}/browse/`)
        .expect(200);

      expect(res.body.items).toEqual([
        expect.objectContaining({ id: 'F1', isSupported: true }),    // folder → always true
        expect.objectContaining({ id: 'F2', isSupported: true }),    // text/plain → supported
        expect.objectContaining({ id: 'F3', isSupported: false }),   // application/zip → unsupported
        expect.objectContaining({ id: 'F4', isSupported: false }),   // null mimeType → unsupported
      ]);
    });

    it('passes pageToken query param to browseFolder', async () => {
      const pageToken = 'next-page-token-xyz';

      await request(app)
        .get(`/api/connections/${CONNECTION_ID}/sites/${SITE_ID}/libraries/${DRIVE_ID}/browse/${FOLDER_ID}`)
        .query({ pageToken })
        .expect(200);

      expect(mockBrowseFolder).toHaveBeenCalledWith(CONNECTION_ID, DRIVE_ID, FOLDER_ID, pageToken);
    });

    it('includes nextPageToken in response from browseFolder', async () => {
      const token = 'cursor-token-abc';
      mockBrowseFolder.mockResolvedValue({
        items: [],
        nextPageToken: token,
      });

      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/sites/${SITE_ID}/libraries/${DRIVE_ID}/browse/`)
        .expect(200);

      expect(res.body.nextPageToken).toBe(token);
    });

    it('returns 500 when connection is not found (ConnectionNotFoundError)', async () => {
      const { ConnectionNotFoundError } = await import('@/domains/connections');
      mockGetConnection.mockRejectedValue(new ConnectionNotFoundError(CONNECTION_ID));

      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/sites/${SITE_ID}/libraries/${DRIVE_ID}/browse/`)
        .expect(500);

      expect(res.body.code).toBe('INTERNAL_ERROR');
    });

    it('returns 400 when connection is not a SharePoint connection', async () => {
      mockGetConnection.mockResolvedValue({ ...sampleConnection, provider: 'onedrive' });

      const res = await request(app)
        .get(`/api/connections/${CONNECTION_ID}/sites/${SITE_ID}/libraries/${DRIVE_ID}/browse/`)
        .expect(400);

      expect(res.body.code).toBe('BAD_REQUEST');
    });

    it('validates connection ownership before browsing', async () => {
      await request(app)
        .get(`/api/connections/${CONNECTION_ID}/sites/${SITE_ID}/libraries/${DRIVE_ID}/browse/`)
        .expect(200);

      expect(mockGetConnection).toHaveBeenCalledWith(USER_ID, CONNECTION_ID);
    });

    it('normalises connection ID to uppercase before passing to services', async () => {
      await request(app)
        .get(`/api/connections/${CONNECTION_ID_LC}/sites/${SITE_ID}/libraries/${DRIVE_ID}/browse/`)
        .expect(200);

      expect(mockGetConnection).toHaveBeenCalledWith(USER_ID, CONNECTION_ID);
      expect(mockBrowseFolder).toHaveBeenCalledWith(CONNECTION_ID, DRIVE_ID, undefined, undefined);
    });
  });
});
