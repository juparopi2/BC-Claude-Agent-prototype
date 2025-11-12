# Deprecated: MCP Server as Git Submodule

> **Status**: ❌ DEPRECATED (Week 7, November 2025)
> **Replaced By**: Vendored MCP data files (115 files in `backend/mcp-server/data/`)
> **Reason**: CI/CD failures, slow Docker builds, operational complexity

---

## What Was Deprecated

### Git Submodule Approach

```bash
# .gitmodules (deleted)
[submodule "backend/mcp-server"]
  path = backend/mcp-server
  url = https://github.com/organization/bc-mcp-server
  branch = main

# Setup (removed from docs)
git submodule init
git submodule update --remote

# Build (removed from package.json)
npm run build:mcp  # cd mcp-server && npm install && npm run build
```

### Why It Was Deprecated

1. **CI/CD Failures**: GitHub Actions couldn't access submodule URL (authentication issues)
2. **Slow Docker Builds**: ~2 minutes added per build (git clone + npm install + npm build)
3. **Complex Setup**: New developers had to learn git submodule commands
4. **Fragile Deployments**: Submodule not initialized → build fails silently

---

## What Replaced It

### Vendored Data Files

```
backend/mcp-server/data/
├── bcoas1.0.yaml                # 540KB (OpenAPI spec)
└── data/v1.0/                   # 852KB
    ├── customer/schema.json
    ├── salesOrder/schema.json
    └── ... (52 BC entities)

Total: 115 files (~1.4MB)
```

### Benefits

- ✅ CI/CD reliable (no git submodule errors)
- ✅ Faster Docker builds (~2 min saved)
- ✅ Simpler setup (just `git clone`)
- ✅ Data files version-controlled explicitly

### Trade-Offs

- ⚠️ ~1.4MB added to repo size (acceptable)
- ⚠️ Manual updates required (copy files from upstream)

---

## How to Update Vendored Data

```bash
# 1. Clone latest MCP server
cd /tmp
git clone https://github.com/organization/bc-mcp-server
cd bc-mcp-server
npm install && npm run build

# 2. Copy to main repo
cp bcoas1.0.yaml /path/to/BC-Claude-Agent-prototype/backend/mcp-server/data/
cp -r data/v1.0/ /path/to/BC-Claude-Agent-prototype/backend/mcp-server/data/data/

# 3. Commit
cd /path/to/BC-Claude-Agent-prototype
git add backend/mcp-server/data/
git commit -m "chore: update vendored MCP data to vX.Y.Z"
```

---

## Related Documents

- **MCP Vendoring Strategy**: `docs/04-integrations/07-mcp-vendoring-strategy.md` (to be created)
- **Direction Changes**: `docs/13-roadmap/07-direction-changes.md` (Direction Change #3)

---

**Deprecated**: 2025-11-10 (Week 7)
**Reason**: CI/CD reliability, faster Docker builds
**Replaced By**: Vendored data files (115 files, ~1.4MB)
**Status**: ❌ DO NOT USE GIT SUBMODULE
