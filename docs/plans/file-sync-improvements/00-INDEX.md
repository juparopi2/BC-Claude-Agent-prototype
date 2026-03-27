# File Sync Improvements — PRD Index

## Initiative Overview

Systematic improvements to the SharePoint/OneDrive file synchronization system. Addresses operational gaps in health monitoring, error recovery, scope management UX, re-processing efficiency, and multi-tenant file sharing.

**Started**: 2026-03-25
**Status**: Planning

## Documents

| # | Document | Status | Effort | Description |
|---|----------|--------|--------|-------------|
| 00 | [System Diagnostic](./00-SYSTEM-DIAGNOSTIC.md) | Draft | — | Current state analysis, architecture overview, identified gaps |
| 300 | [PRD-300: Sync Health & Recovery](./PRD-300-sync-health-recovery.md) | Draft | M-L | Recurring health checks, reconciliation, auto-recovery, API |
| 301 | [PRD-301: Scope Selection Fix](./PRD-301-scope-selection-fix.md) | Draft | S | Fix "can't deselect all folders" bug in wizard |
| 302 | [PRD-302: Smart Scope Reassignment](./PRD-302-smart-scope-reassignment.md) | Draft | M | Preserve files when changing sync scope hierarchy |
| 303 | [PRD-303: Multi-Tenant Sharing](./PRD-303-multi-tenant-sharing.md) | Draft | S (prep) / XL (full) | Feasibility assessment + Phase 1 embedding copy |
| 304 | [PRD-304: Health Modular Refactor](./PRD-304-health-refactor.md) | Implemented | M | Detector/Repairer pattern, healthy state definitions, soft-delete fixes, auto-reconciliation on login |

## Implementation Order

```
Phase 1 (parallel, independent):
  ├── PRD-301: Scope selection fix (S)
  ├── Health check script (S)
  └── System diagnostic doc (S)

Phase 2:
  └── PRD-300: Sync health & recovery (M-L)

Phase 3 (depends on PRD-301):
  └── PRD-302: Smart scope reassignment (M)

Phase 4:
  └── PRD-303: Multi-tenant prep (S, Phase 1 only)
```

## Related Resources

- Sync service CLAUDE.md: `backend/src/services/sync/CLAUDE.md`
- File processing CLAUDE.md: `backend/src/domains/files/CLAUDE.md`
- Search service CLAUDE.md: `backend/src/services/search/CLAUDE.md`
- Queue infrastructure CLAUDE.md: `backend/src/infrastructure/queue/CLAUDE.md`
- Health check script: `backend/scripts/sync/verify-sync-health.ts`
