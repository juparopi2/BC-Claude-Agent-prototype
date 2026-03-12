# PRD-113: SharePoint Frontend — Wizard, Browsing & Unified Views

**Phase**: SharePoint
**Status**: Planned
**Prerequisites**: PRD-111 (SharePoint Backend), PRD-107 (OneDrive UX Polish), PRD-110 (Shared Files)
**Estimated Effort**: 4-5 days
**Created**: 2026-03-11
**Backend Companion**: [PRD-111](./PRD-111-sharepoint-connection.md)

---

## 1. Objective

Deliver the complete frontend experience for SharePoint integration:

1. **SharePoint Connection Wizard** — multi-step flow for connecting, discovering sites, selecting libraries/folders, and starting sync
2. **SharePoint Folder Tree** — hierarchical browsing with site → library → folder navigation and teal visual theming
3. **Unified File Browsing** — mirror the OneDrive web experience with "My Files", "Shared" (With You / By You), and direct SharePoint site access
4. **File Actions** — "Open in SharePoint", "Open site in browser", and download capabilities

The goal is to make SharePoint files feel native within MyWorkMate while maintaining the visual identity users expect from Microsoft's own file browser.

---

## 2. UX Research — OneDrive Web File Organization

### 2.1 How Microsoft Organizes Files

In OneDrive for Business (e.g., `{tenant}-my.sharepoint.com`), the file browser has three main sections:

| Section | Content | Source |
|---|---|---|
| **My Files** | User's personal OneDrive files | `/me/drive/root/children` |
| **Shared** | Files shared with/by the user from ANY source | `/me/drive/sharedWithMe` |
| **Quick Access** | Pinned/recent SharePoint sites | Not applicable for us |

The **Shared** section has two views:
- **"Shared with you"** — Files others have shared with the current user. Includes files from personal OneDrive shares AND SharePoint document libraries. Each item shows the sharer's name, date shared, and a link to the source location.
- **"Shared by you"** — Files the current user has shared with others. Shows who has access and sharing permissions.

### 2.2 How SharePoint Items Appear in "Shared"

When someone shares a file from a SharePoint site (e.g., "Marketing/Documents/Report.pdf"), it appears in the user's "Shared with you" view with:
- File name and metadata
- Sharer's display name
- A hyperlink icon that opens the SharePoint site/library containing the file
- The `remoteDriveId` pointing to the SharePoint document library drive

**Key insight**: The existing PRD-110 "Shared with me" implementation already surfaces SharePoint shared items via `/me/drive/sharedWithMe`. This endpoint returns items from ALL drives — personal OneDrive AND SharePoint libraries.

### 2.3 Our Adaptation

We will implement three main file sections that map to the OneDrive paradigm:

| Our Section | Maps to | Source | Implementation |
|---|---|---|---|
| **My Files** | OneDrive "My files" | Personal uploaded files | Existing (local files) |
| **OneDrive** | OneDrive "My files" (external) | User's OneDrive drive | Existing (PRD-101) |
| **Shared** | OneDrive "Shared" | Cross-provider shared items | Extended from PRD-110 |
| **SharePoint** | Direct site access | SP sites & libraries | **NEW** (this PRD) |

---

## 3. Current State (After PRD-112)

### What Exists
- **ConnectionWizard** (`frontend/components/connections/ConnectionWizard.tsx`):
  - 3-step flow: connect → browse → sync
  - Tree navigation with expand/load states
  - SelectedScope tracking (new/existing/removed)
  - Include/exclude scope mode toggle (PRD-112)
  - Scope diff view (before/after)
  - Progress tracking per scope
- **Folder Tree** (`frontend/components/files/FolderTree.tsx`):
  - My Files root node (local files)
  - OneDrive root node (blue accent `#0078d4`)
  - Lazy-loaded subtrees
  - `folderTreeStore` for caching
- **File Data Table** (`frontend/components/files/FileDataTable.tsx`):
  - TanStack Table with columns: name, size, modified, type
  - Pipeline status badges
  - Source type indicators
- **File Icon** (`frontend/components/files/FileIcon.tsx`):
  - MIME type-based icons
  - Cloud badge overlay for OneDrive files
  - Users badge for shared items (PRD-110)
- **Shared Files** (PRD-110):
  - "Shared with me" browsing via `browse-shared` endpoint
  - Shared item source identification via `remoteDriveId`
  - Shared folder drill-down via `browse-shared/:driveId/:itemId`
- **Sync Events** (`useSyncEvents` hook):
  - Real-time sync progress per scope
  - Toast notifications for sync completion/error
  - Folder tree invalidation on file changes
- **Integration Stores**:
  - `integrationListStore` — connection list management
  - `syncStatusStore` — per-scope sync status/progress
  - `folderTreeStore` — cached folder tree nodes
- **Context Menu Actions**:
  - "Open in OneDrive" for external files
  - Download via content proxy
  - Standard file actions (rename, delete, move) for local files

### What's Missing for SharePoint
- SharePoint connection wizard (site picker + library picker)
- SharePoint root node in folder tree with teal theming
- Site and library virtual nodes in tree
- "Open in SharePoint" context menu action
- SharePoint-specific breadcrumb
- "Shared by you" subtab in Shared section
- Source origin indicators in shared view (OneDrive vs. SharePoint site name)

---

## 4. Detailed Specifications

### 4.1 SharePoint Connection Wizard

The wizard has **4 steps** (one more than OneDrive due to the site selection level):

#### Step 1: Connect
Same pattern as OneDrive wizard:
- "Connect to SharePoint" button
- Triggers OAuth flow with `Sites.Read.All` + `Files.Read.All` scopes
- MSAL popup/redirect for consent
- On success: connection created, wizard advances to Step 2
- On failure: error banner with retry option
- **Teal accent color** (`#038387`) throughout

#### Step 2: Select Sites
Grid view of accessible SharePoint sites:

```
┌─────────────────────────────────────────────────────────┐
│  Select SharePoint Sites                                │
│  ───────────────────────────────────                    │
│  🔍 [Search sites...                              ]    │
│                                                         │
│  ☑ 🌐 Marketing                                        │
│     marketing.sharepoint.com/sites/marketing            │
│     Last modified: Mar 10, 2026                         │
│                                                         │
│  ☐ 🌐 Engineering                                      │
│     contoso.sharepoint.com/sites/engineering            │
│     Last modified: Mar 11, 2026                         │
│                                                         │
│  ☑ 🌐 HR Portal                                        │
│     contoso.sharepoint.com/sites/hr                     │
│     Last modified: Feb 28, 2026                         │
│                                                         │
│  ☐ 🌐 Executive Team                                   │
│     contoso.sharepoint.com/sites/exec                   │
│     Last modified: Mar 5, 2026                          │
│                                                         │
│  [Load more sites...]                                   │
│                                                         │
│  ⓘ 2 sites selected          [Back] [Next: Libraries]  │
└─────────────────────────────────────────────────────────┘
```

**Features**:
- Multi-select checkboxes
- Search/filter input (client-side for loaded sites, server-side if paginated)
- Site URL displayed below name
- Last modified date
- Globe icon (`<Globe />` from lucide-react) for each site
- Pagination ("Load more sites") for large tenants
- Selected count indicator
- Warning if >10 sites selected ("This may take a while to sync")

#### Step 3: Select Libraries & Folders
Expandable tree view per selected site:

```
┌─────────────────────────────────────────────────────────┐
│  Select Libraries & Folders                             │
│  ─────────────────────────────                          │
│                                                         │
│  🌐 Marketing                                          │
│  ├── ☑ 📚 Documents                (234 items, 1.2 GB) │
│  │   ├── ☐ 📁 Campaigns/                               │
│  │   ├── ☐ 📁 Brand Assets/                            │
│  │   └── ☐ 📁 Templates/                               │
│  ├── ☐ 📚 Shared Files             (45 items, 300 MB)  │
│  └── ☐ 📚 Project Archive          (12 items, 50 MB)   │
│                                                         │
│  🌐 HR Portal                                          │
│  ├── ☑ 📚 Policies                 (89 items, 400 MB)  │
│  └── ☐ 📚 Training Materials       (156 items, 2.1 GB) │
│                                                         │
│  ⓘ Selecting a library syncs all files inside it.       │
│    Expand to select specific folders instead.            │
│                                                         │
│  ⚠ Estimated total: 323 files (~1.6 GB)                │
│    Libraries with 5,000+ files may take several minutes. │
│                                                         │
│                               [Back] [Next: Confirm]    │
└─────────────────────────────────────────────────────────┘
```

**Features**:
- Sites grouped with headers (Globe icon + site name)
- Libraries shown with BookOpen icon (`<BookOpen />` from lucide-react)
- Library-level checkbox = sync entire library (creates `scope_type='library'`)
- Expandable libraries → shows folders for granular selection
- Folder selection creates `scope_type='folder'`
- Item count and size estimate per library (from Graph API `quota` data)
- Warning banner when estimated total > 5,000 files
- Tri-state checkboxes: unchecked, checked (full library), partial (some folders) — reuse PRD-112 pattern
- Include/Exclude toggle for advanced users (from PRD-112)

#### Step 4: Confirm & Sync
Same pattern as OneDrive:

```
┌─────────────────────────────────────────────────────────┐
│  Confirm SharePoint Sync                                │
│  ────────────────────────                               │
│                                                         │
│  📊 Summary                                             │
│  • 2 sites: Marketing, HR Portal                        │
│  • 3 libraries selected                                 │
│  • ~323 files to sync                                   │
│                                                         │
│  🌐 Marketing                                          │
│     📚 Documents (full library)                         │
│     📚 Shared Files (full library)                      │
│                                                         │
│  🌐 HR Portal                                          │
│     📚 Policies (full library)                          │
│                                                         │
│  ⓘ Sync will run in the background.                    │
│    You can continue using MyWorkMate while files sync.  │
│                                                         │
│                           [Back] [Start Sync]           │
└─────────────────────────────────────────────────────────┘
```

**Post-sync behavior**:
- Wizard closes
- Toast: "SharePoint sync started for 3 libraries"
- `syncStatusStore` tracks progress per scope
- Folder tree auto-updates as files arrive via WebSocket

### 4.2 SharePoint in the Folder Tree

The folder tree gets a new SharePoint root node:

```
📁 My Files                               ← Local uploads
  └── ...

☁️ OneDrive (blue #0078d4)               ← Personal OneDrive
  ├── 📁 Documents/
  ├── 📁 Pictures/
  └── 📁 Projects/

🤝 Shared                                 ← Unified shared view (NEW)
  ├── 📄 Shared Report.xlsx    (from Marketing SP)
  ├── 📄 Design Guide.pdf     (from John's OneDrive)
  └── 📄 Budget 2026.xlsx     (from Finance SP)

🌐 SharePoint (teal #038387)              ← SharePoint sites (NEW)
  ├── 🌐 Marketing
  │   ├── 📚 Documents
  │   │   ├── 📁 Campaigns/
  │   │   └── 📁 Brand Assets/
  │   └── 📚 Shared Files
  │       └── 📁 Templates/
  └── 🌐 HR Portal
      └── 📚 Policies
          ├── 📁 2025/
          └── 📁 2026/
```

**Visual elements**:

| Element | Icon | Color | Notes |
|---|---|---|---|
| SharePoint root | `<Globe />` | Teal `#038387` | Virtual node |
| Site nodes | `<Globe />` (smaller) | Teal `#038387` | Virtual node per site |
| Library nodes | `<BookOpen />` | Teal `#038387` | Virtual node per library |
| Folders | `<Folder />` | Default | Standard folder icon |
| Files | MIME-type icon | Default | Standard file icon |
| SP file badge | `<Globe />` (tiny) | Teal | Overlay on FileIcon (like OneDrive cloud badge) |

**Tree node hierarchy** (3-level virtual nodes):
1. **SharePoint root** — Virtual, `source_type='sharepoint'`
2. **Site nodes** — Virtual folders, fetched from connection scopes grouping
3. **Library nodes** — Virtual folders, map to actual scopes
4. **Synced content** — Real folders/files from DB (fetched via file API with `connectionScopeId` filter)

**Lazy loading**:
- SharePoint root expanded → fetch sites from connection scopes
- Site expanded → show libraries from scopes
- Library expanded → fetch folder tree from file API (same as OneDrive)
- All subtree loading cached in `folderTreeStore`

### 4.3 Unified "Shared" Section

Currently, PRD-110 added "Shared with me" as a sub-section of OneDrive. This PRD moves it to a **top-level "Shared" section** that's provider-agnostic:

#### 4.3.1 "Shared with you" (existing, relocated)

Moves from `OneDrive > Shared with me` to `Shared > Shared with you`:

```
🤝 Shared
  ├── 👥 Shared with you
  │   ├── 📄 Report.xlsx         👤 Maria (Marketing SP)
  │   ├── 📄 Design.pdf          👤 John (OneDrive)
  │   └── 📄 Budget.xlsx         👤 Ana (Finance SP)
  └── 📤 Shared by you
      ├── 📄 Proposal.docx       → 3 people
      └── 📄 Roadmap.pdf         → Team channel
```

**Enhancements over PRD-110**:
- **Source origin indicator**: Each shared item shows where it comes from:
  - OneDrive personal: "from John's OneDrive"
  - SharePoint library: "from Marketing (SharePoint)" using the site display name
  - Determined by `remoteDriveId` — if it matches a known SharePoint library drive, show site name; otherwise show "OneDrive"
- **Open source location**: Click the origin link to open the containing folder in SharePoint/OneDrive web
- **Filter by source**: Dropdown to filter shared items by "All", "OneDrive", "SharePoint"

#### 4.3.2 "Shared by you" (new)

**Note**: The Microsoft Graph API does NOT have a direct "shared by me" endpoint. To implement this, we have two options:

**Option A (Recommended for MVP)**: Skip "Shared by you" — it requires Search API or permission enumeration which is complex and unreliable.

**Option B (Future)**: Use Microsoft Graph Search API to find items the current user has shared:
```
POST /search/query
{
  "requests": [{
    "entityTypes": ["driveItem"],
    "query": { "queryString": "SharedWithUsersOWSUSER:{currentUser}" }
  }]
}
```
This only works for work/school accounts and has limitations.

**Decision**: "Shared by you" is **out of scope** for this PRD. The "Shared" section will contain only "Shared with you" (renamed from "Shared with me") for now. This can be revisited in a future PRD when the Search API approach is validated.

### 4.4 Breadcrumb Navigation

#### SharePoint path
```
🌐 SharePoint > 🌐 Marketing > 📚 Documents > 📁 Campaigns
```

#### Shared path
```
🤝 Shared > Shared with you
```

Each segment is clickable for navigation. The root icon matches the section color.

### 4.5 File Context Menu — SharePoint Actions

| Action | Condition | Behavior |
|---|---|---|
| **Open in SharePoint** | `source_type='sharepoint'` | Opens `external_url` in new tab |
| **Open site** | SP file/folder | Opens site `webUrl` in new tab |
| **Open library** | SP file/folder | Opens library `webUrl` in new tab |
| **Download** | Any file with `external_url` | Download via backend content proxy (same as OneDrive) |
| **View details** | Any file | Shows file metadata panel |
| **Copy link** | SP file | Copies `external_url` to clipboard |

**Disabled actions for external files** (same as OneDrive):
- Rename, Move, Delete — read-only from external sources
- Upload — not applicable within SP folders

### 4.6 SharePoint Visual Theming

When browsing inside the SharePoint section:

| Element | Style |
|---|---|
| Folder tree nodes | `border-left: 2px solid #038387` for SP subtree |
| Breadcrumb root | Globe icon, teal `#038387` |
| Data table header | `border-top: 2px solid #038387` |
| Info banner | "Files from SharePoint · Read-only · Open in SharePoint to edit" |
| File icon badge | Tiny globe overlay (teal) |
| Sync status | Teal-colored progress indicators |
| Empty state | "No SharePoint sites connected. Connect in Settings > Connections." |

**Dark mode**: Teal becomes lighter `#4DB8BF` for dark backgrounds (same pattern as OneDrive blue `#4DA3FF`).

### 4.7 Data Table Enhancements

Add a "Source" column to the file data table when in the "Shared" or "All Files" view:

| Column | Content | Example |
|---|---|---|
| Source | Provider icon + location name | ☁️ OneDrive / 🌐 Marketing (SP) / 📁 Local |

This column is hidden when browsing within a specific provider (unnecessary when all files are from the same source).

### 4.8 Sync Progress UI

Reuse the existing sync progress infrastructure from OneDrive:

- `syncStatusStore` tracks per-scope progress (works for SharePoint scopes too)
- `useSyncEvents` hook listens to WebSocket events (provider-agnostic)
- Toast notifications for sync start/complete/error
- Library nodes show spinning indicator while syncing
- Scope sync status badge in Settings > Connections tab (existing)

**SharePoint-specific**:
- Progress grouped by site (e.g., "Marketing: 2/3 libraries synced")
- Site-level progress = aggregate of library-level progress
- Library node icon changes: `<BookOpen />` → `<Loader2 className="animate-spin" />` while syncing

### 4.9 Settings > Connections Tab — SharePoint Card

The existing Settings > Connections tab (PRD-109) shows connection cards. Add SharePoint card:

```
┌──────────────────────────────────────────┐
│  🌐 SharePoint                     ✅    │
│  ────────────────────────                │
│  Connected · 3 sites · 5 libraries       │
│  247 files synced                        │
│                                          │
│  [Manage Scopes]    [Disconnect]         │
└──────────────────────────────────────────┘
```

- "Manage Scopes" opens the wizard in edit mode (Step 2)
- "Disconnect" opens `DisconnectConfirmModal` (existing)
- Card uses teal accent color
- Shows site count + library count + file count

---

## 5. Component Architecture

### 5.1 New Components

| Component | Location | Purpose |
|---|---|---|
| `SharePointWizard` | `connections/SharePointWizard.tsx` | 4-step wizard (reuse wizard shell from ConnectionWizard) |
| `SitePicker` | `connections/sharepoint/SitePicker.tsx` | Step 2: searchable site grid |
| `LibraryPicker` | `connections/sharepoint/LibraryPicker.tsx` | Step 3: expandable library tree |
| `SharePointConfirm` | `connections/sharepoint/SharePointConfirm.tsx` | Step 4: summary |
| `SharedFilesView` | `files/SharedFilesView.tsx` | Unified shared view with source origin |
| `SourceBadge` | `files/SourceBadge.tsx` | Provider icon + name indicator |

### 5.2 Modified Components

| Component | Change |
|---|---|
| `FolderTree` | Add SharePoint root node, site nodes, library nodes |
| `FileIcon` | Add globe badge for SharePoint files |
| `FileBreadcrumb` | Handle SP path: SharePoint > Site > Library > Folder |
| `FileDataTable` | Optional "Source" column |
| `FileContextMenu` | "Open in SharePoint", "Open site", "Copy link" |
| `ConnectionCard` | SharePoint-specific card in Settings |

### 5.3 New Hooks

| Hook | Purpose |
|---|---|
| `useSharePointSites` | Fetch sites for wizard + tree |
| `useSharePointLibraries` | Fetch libraries for a site |
| `useSharedFiles` | Enhanced shared file listing with source origin |

### 5.4 Store Changes

| Store | Change |
|---|---|
| `folderTreeStore` | Add SharePoint subtree caching (site → library → folders) |
| `integrationListStore` | No changes (already supports any provider) |
| `syncStatusStore` | No changes (already provider-agnostic) |

---

## 6. API Integration (Frontend → Backend)

### 6.1 New API Calls

```typescript
// SharePoint site discovery
GET /api/connections/:id/sites?search=term&pageToken=token
→ { sites: SharePointSite[], nextPageToken: string | null }

// Library listing
GET /api/connections/:id/sites/:siteId/libraries
→ { libraries: SharePointLibrary[] }

// Library folder browsing
GET /api/connections/:id/sites/:siteId/libraries/:driveId/browse
GET /api/connections/:id/sites/:siteId/libraries/:driveId/browse/:folderId
→ FolderListResult (same shape as OneDrive browse)
```

### 6.2 Reused API Calls

All scope management and sync APIs are the same:
```typescript
// Create scopes (works for site/library/folder scope types)
POST /api/connections/:id/scopes → same payload, scopeType='library'|'folder'

// Batch scopes
POST /api/connections/:id/scopes/batch → same payload

// Trigger sync
POST /api/connections/:id/scopes/:scopeId/sync → same

// Sync status
GET /api/connections/:id/sync-status → same

// Disconnect
DELETE /api/connections/:id/full-disconnect → same
```

---

## 7. Implementation Order

### Step 1: Shared Section Refactor (1 day)

1. Move "Shared with me" from OneDrive subtree to top-level "Shared" section
2. Create `SharedFilesView` component with source origin indicators
3. Add `SourceBadge` component (provider icon + location name)
4. Update `FolderTree` to include Shared root node
5. Update breadcrumb for Shared path
6. Source origin logic: resolve `remoteDriveId` against known SharePoint library drives
7. Tests: SharedFilesView renders, source origin resolves correctly

### Step 2: SharePoint Folder Tree Shell (0.5 day)

1. Add SharePoint root node to FolderTree (teal accent)
2. Implement virtual site nodes (from connection scopes, grouped by site)
3. Implement virtual library nodes (from scopes)
4. Lazy-load synced content under library nodes (file API)
5. FileIcon globe badge for SharePoint files
6. Tests: tree renders correctly with mock data

### Step 3: SharePoint Connection Wizard (2 days)

1. Create `SharePointWizard` component (4-step flow)
2. Implement `SitePicker` (Step 2):
   - Fetch sites from `GET /connections/:id/sites`
   - Client-side search/filter
   - Multi-select checkboxes
   - Pagination ("Load more")
3. Implement `LibraryPicker` (Step 3):
   - Fetch libraries per site from `GET /connections/:id/sites/:siteId/libraries`
   - System library filtering (already done by backend)
   - Library-level checkboxes (full library sync)
   - Expandable to show folders (browse endpoint)
   - Folder-level selection
   - Tri-state checkboxes (PRD-112 pattern)
   - Size/count estimates
4. Implement `SharePointConfirm` (Step 4):
   - Summary grouped by site
   - Scope creation via `POST /connections/:id/scopes`
   - Sync trigger via `POST /connections/:id/scopes/:scopeId/sync`
5. Wire into Settings > Connections tab
6. Tests: wizard flow, scope creation, error handling

### Step 4: SharePoint Visual Theming (0.5 day)

1. Teal accent throughout SP section
2. Breadcrumb SP-awareness (Globe icon, site/library names)
3. Info banner "Files from SharePoint · Read-only"
4. Dark mode teal variant (`#4DB8BF`)
5. Data table header accent when in SP view

### Step 5: Context Menu & Actions (0.5 day)

1. "Open in SharePoint" for SP files (`external_url`)
2. "Open site" action (site `webUrl`)
3. "Copy SharePoint link" action
4. Download via content proxy (existing)
5. Disable write actions (rename, delete, move) for SP files
6. Tests: context menu shows correct actions per source type

### Step 6: Settings Card & Manage (0.5 day)

1. SharePoint card in Settings > Connections
2. Card shows: status, site count, library count, file count
3. "Manage Scopes" button → opens wizard at Step 2
4. "Disconnect" button → existing DisconnectConfirmModal
5. Teal accent on card
6. Tests: card renders, disconnect flow

---

## 8. Lessons Learned from OneDrive Frontend (Applied Here)

### 8.1 Wizard Bugs (PRD-102)

**Problems found**: Tree loading states inconsistent, error boundaries missing, scope selection lost on back-navigation.

**Applied to SharePoint wizard**:
- Each step maintains selection state even when navigating back
- Loading skeletons for site/library lists
- Error boundary per step with retry button
- Debounced search input
- Disabled "Next" button until selection is valid

### 8.2 Scope Selection UX (PRD-105)

**Problem**: No scope pre-selection on re-configure.

**Applied**: When opening wizard in edit mode, pre-select existing scopes (sites and libraries already synced).

### 8.3 Folder Tree Performance (PRD-107)

**Problem**: Flat file list — no hierarchy visible.

**Applied**: Virtual nodes (site, library) provide immediate structure. Lazy-load actual files only when library node is expanded.

### 8.4 Sync Event Responsiveness (PRD-107)

**Problem**: No frontend sync event listeners — user had no feedback during sync.

**Applied**: `useSyncEvents` hook already handles this. SharePoint scopes emit the same events. Library nodes show spinning indicator during sync.

### 8.5 Tri-State Selection (PRD-112)

**Problem**: Selecting a folder should visually indicate partial selection on parent library.

**Applied**: LibraryPicker uses tri-state checkboxes — unchecked/checked/partial, same as PRD-112 scope inheritance.

---

## 9. Success Criteria

### Wizard
- [ ] SharePoint OAuth flow completes with `Sites.Read.All` consent
- [ ] Site picker shows all accessible sites (personal sites filtered out)
- [ ] Search/filter works on site list
- [ ] Library picker shows libraries per selected site (system libraries filtered)
- [ ] Libraries show item count and size estimates
- [ ] Folder-level selection works within libraries
- [ ] Tri-state checkboxes work (library checked, partial, unchecked)
- [ ] Scope creation sends correct scope types (site/library/folder)
- [ ] Sync triggers and progress displays correctly
- [ ] Wizard state preserved on back-navigation
- [ ] Error handling with retry for each step

### Folder Tree
- [ ] SharePoint root node with teal accent appears when SP connection exists
- [ ] Site nodes appear under SP root (grouped from scopes)
- [ ] Library nodes appear under sites
- [ ] Synced content loads lazily under library nodes
- [ ] Globe badge on SP file icons
- [ ] Tree collapses/expands smoothly

### Shared Section
- [ ] "Shared" appears as top-level section (not under OneDrive)
- [ ] Shared items show source origin (OneDrive vs. SharePoint site name)
- [ ] Items from SharePoint sites correctly identified via `remoteDriveId`
- [ ] Source origin link opens containing location in browser

### Actions
- [ ] "Open in SharePoint" opens `external_url` in new tab
- [ ] "Open site" opens site URL in new tab
- [ ] "Copy link" copies SP URL to clipboard
- [ ] Download works via content proxy
- [ ] Write actions (rename, delete, move) disabled for SP files

### Visual
- [ ] Teal `#038387` accent for all SP elements
- [ ] Dark mode teal `#4DB8BF` variant works
- [ ] Breadcrumb shows SP path correctly
- [ ] Info banner "Files from SharePoint · Read-only" appears
- [ ] Settings card shows SP connection with teal accent

### E2E
1. Connect SharePoint → select 2 sites → select libraries → start sync → files appear in tree
2. Navigate: SharePoint > Site > Library > Folder — all levels load correctly
3. Shared section shows items from both OneDrive and SharePoint with correct origin
4. "Open in SharePoint" opens correct URL
5. Download SP file works
6. Manage scopes: add/remove libraries in edit mode
7. Disconnect SharePoint: confirmation modal → clean removal
8. OneDrive integration unaffected after SP addition (regression)

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Wizard complexity (4 steps vs. OneDrive's 3) | Reuse wizard shell. Each step is independent. Back-navigation preserves state. |
| Large tenant with 100+ sites | Paginated site list + search. "Load more" pattern. |
| Shared section origin resolution inaccurate | Fallback to "External" if `remoteDriveId` doesn't match known SP library. |
| Tree performance with many SP sites/libraries | Virtual nodes — only fetch file content when expanded. |
| Dark mode teal readability | Test with both themes. Use `#4DB8BF` for dark mode. |
| Scope diff view complexity for SP | Reuse `ScopeDiffView` — it works with any scope type. |

---

## 11. Out of Scope

- "Shared by you" subtab (requires Search API — complex, unreliable)
- SharePoint site search from within the folder tree (users use wizard to add sites)
- SharePoint list browsing (non-document lists)
- Editing files directly in MyWorkMate (all external files are read-only)
- Custom SharePoint site icons/logos
- SharePoint hub site grouping (treated as regular sites)
- Offline file caching
- File preview for SP files (existing preview infrastructure applies if file is processed)
