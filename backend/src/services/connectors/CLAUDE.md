# Connectors Service

## Purpose

Content provider abstraction and Graph API clients for OneDrive and SharePoint. Provides unified file access across cloud storage providers with OAuth token management, rate limiting, and delta sync support.

## Architecture

```
IFileContentProvider (interface)
    ├── BlobContentProvider      — Azure Blob Storage (uploaded files)
    └── GraphApiContentProvider  — Microsoft Graph API (OneDrive/SharePoint)

ContentProviderFactory.getProvider(sourceType) → IFileContentProvider
    Routes by sourceType: 'local' → Blob, 'onedrive'/'sharepoint' → Graph

Used by:
  - FileProcessingService (text extraction during sync)
  - MessageContextBuilder.resolveMentionContentBlocks() (download @mentioned files for LLM)
```

## GraphTokenManager

Manages OAuth tokens for Microsoft Graph API calls from BullMQ workers.

- **Singleflight dedup**: `inflightTokenRequests` Map keyed by connectionId. When 3+ concurrent workers need tokens, only 1 DB query + MSAL refresh runs.
- **Encryption**: AES-256-GCM for stored refresh tokens (`EncryptionService`)
- **MSAL silent refresh**: Uses `acquireTokenSilent()` with cached refresh token
- **5-min expiry buffer**: Refreshes token if < 5 minutes remaining
- **Failure**: `ConnectionTokenExpiredError` → emitted as WebSocket event for user re-auth

## GraphHttpClient

Base HTTP client for all Microsoft Graph API calls.

- **Base URL**: `https://graph.microsoft.com/v1.0`
- **429 Retry**: Reads `Retry-After` header, max 3 attempts
- **401 NOT retried**: Token issues bubble up as `ConnectionTokenExpiredError`
- **Pagination**: Auto-follows `@odata.nextLink` until exhausted

**Critical**: Delta `nextPageLink` URLs are ALWAYS absolute — NEVER prepend base URL.

## GraphRateLimiter

Token bucket rate limiter, per-tenant isolation.

- **Capacity**: 2,500 tokens, refill 2,500/min
- **On 429**: Drains bucket to 0 (immediate backoff)
- **Polling**: 100ms check interval
- **Hard timeout**: 30s — throws if bucket never refills

## OneDrive vs SharePoint

| Aspect | OneDrive | SharePoint |
|---|---|---|
| **driveId source** | Connection record | Passed per library |
| **Delta queries** | Folder/root scoped | Folder/root scoped |
| **Site discovery** | N/A | Site enumeration + library listing |
| **System libraries** | N/A | Filtered out (Style Library, etc.) |
| **Shared items** | `remoteItem` facet with `remoteDriveId` | Same |

### Shared Items
Items shared from other drives have a `remoteItem` facet. Use `remoteDriveId` + `remoteItemId` for content access. Shared items from remote drives do NOT get webhook subscriptions (except SharePoint folder scopes — PRD-118).

**Mapping**: `mapDriveItem()` for owned items, `mapSharedDriveItem()` for shared items (uses `remoteItem` facet).

## OAuth Incremental Consent

Three-stage consent flow, each adding Graph API scopes:

1. **Login**: Basic profile scopes (openid, profile, email)
2. **OneDrive**: Adds `Files.Read.All`
3. **SharePoint**: Adds `Sites.Read.All`

Each stage triggers MSAL `acquireTokenByCode()` with the expanded scope set.

## Critical Gotchas

1. **Delta nextPageLink is absolute**: `graphClient.get(nextPageLink)` — do NOT prepend `https://graph.microsoft.com/v1.0`
2. **Rate limits**: 2,500 tokens/min per tenant. `GraphRateLimiter` enforces this.
3. **Singleflight**: Without `inflightTokenRequests` dedup, N concurrent workers = N DB queries + N MSAL calls
4. **SharePoint folder scopes**: Have `remote_drive_id` but DO need webhook subscriptions (PRD-118 fix)
5. **mapDriveItem vs mapSharedDriveItem**: Shared items use `remoteItem` facet — wrong mapper = missing content

## Key Files

| File | Purpose |
|---|---|
| `ContentProviderFactory.ts` | Routes file access by source type |
| `BlobContentProvider.ts` | Azure Blob download |
| `graph/GraphTokenManager.ts` | Token lifecycle + singleflight |
| `graph/GraphHttpClient.ts` | HTTP client + retry + pagination |
| `graph/GraphRateLimiter.ts` | Per-tenant token bucket |
| `graph/OneDriveService.ts` | OneDrive API (items, delta, children) |
| `graph/SharePointService.ts` | SharePoint API (sites, libraries, items) |
