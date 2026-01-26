# MyWorkMate Production Diagnostics Toolkit

This directory contains scripts for diagnosing production issues in the MyWorkMate Azure infrastructure.

## Prerequisites

1. **Azure CLI** installed and authenticated:
   ```bash
   az login
   az account set --subscription "<your-subscription-id>"
   ```

2. **Bash shell** (Git Bash on Windows, native bash on Linux/Mac)

3. **jq** installed (JSON processor):
   ```bash
   # Windows (via Chocolatey)
   choco install jq

   # macOS
   brew install jq

   # Linux
   sudo apt-get install jq
   ```

4. **Permissions**: Your Azure account needs:
   - Reader access to resource groups
   - Key Vault Secrets User role (to read secrets)
   - Storage Blob Data Contributor role (for storage tests)

## Scripts Overview

### 1. `check-file-upload-health.sh`

Comprehensive health check for the file upload infrastructure.

**What it checks:**
- Azure Storage account existence and accessibility
- Container `user-files` existence and configuration
- Network firewall rules
- CORS configuration
- Managed identity configuration and role assignments
- Key Vault connection string
- Container App environment variables
- Live connection test (uploads a test file)

**Usage:**
```bash
cd infrastructure/diagnostics
./check-file-upload-health.sh
```

**Output:**
- ✅ Green checkmarks for passing checks
- ⚠️  Yellow warnings for non-critical issues
- ❌ Red X for failing checks with remediation steps

**When to use:**
- File upload is failing in production
- After infrastructure changes
- As part of deployment verification

---

### 2. `fetch-container-logs.sh`

Intelligent log fetcher with filtering capabilities.

**Features:**
- Filter by userId (case-insensitive)
- Filter by service name (e.g., FileUploadService)
- Filter by log level (debug, info, warn, error, fatal)
- Time range queries (last 2h, 30m, etc.)
- Colored output for readability
- JSON export for programmatic processing

**Usage:**
```bash
# Basic usage - last 100 logs
./fetch-container-logs.sh

# Get logs from last 2 hours
./fetch-container-logs.sh --since 2h --tail 500

# Filter by user ID
./fetch-container-logs.sh --user-id BCD5A31B-C560-40D5-972F-50E134A8389D

# Filter by service
./fetch-container-logs.sh --service FileProcessingWorker --since 1h

# Show only errors
./fetch-container-logs.sh --errors-only --since 6h

# Combine filters
./fetch-container-logs.sh --user-id ABC-123 --service FileUploadService --level error

# JSON output for further processing
./fetch-container-logs.sh --since 1h --format json | jq '.level >= 50'
```

**Options:**
- `-h, --help`: Show help message
- `-t, --tail NUMBER`: Number of log lines (default: 100)
- `-s, --since DURATION`: Time range (2h, 30m, 1d)
- `-u, --user-id UUID`: Filter by userId
- `--service NAME`: Filter by service name
- `--level LEVEL`: Filter by log level
- `-f, --format FORMAT`: Output format (colored, json, raw)
- `-e, --errors-only`: Show only errors and warnings

**When to use:**
- Debugging user-specific issues
- Investigating service failures
- Analyzing error patterns
- Exporting logs for support tickets

---

### 3. `verify-azure-config.sh`

Validates Container App environment configuration against expected values.

**What it checks:**
- All required environment variables are set
- Secrets are properly configured via secretRef
- Key Vault secrets exist and have values
- Managed identity is assigned
- Managed identity has access to Key Vault
- Container App provisioning and running status
- Active replica count

**Usage:**
```bash
./verify-azure-config.sh
```

**Output:**
- Complete inventory of environment variables
- Validation against expected values
- Secret existence in both Container App and Key Vault
- Identity and access verification

**When to use:**
- After infrastructure updates
- When troubleshooting authentication issues
- When environment variables might be misconfigured
- As part of deployment validation

---

## Common Workflows

### Workflow 1: "File upload is failing for a user"

```bash
# Step 1: Identify the issue
./check-file-upload-health.sh

# Step 2: Get recent logs for the user
./fetch-container-logs.sh --user-id <USER_ID> --since 2h --service FileUploadService

# Step 3: Check for errors in file processing
./fetch-container-logs.sh --user-id <USER_ID> --errors-only --since 6h

# Step 4: Verify environment configuration
./verify-azure-config.sh
```

### Workflow 2: "Application is returning 500 errors"

```bash
# Step 1: Get recent error logs
./fetch-container-logs.sh --errors-only --since 1h --tail 200

# Step 2: Check if it's service-specific
./fetch-container-logs.sh --service <SERVICE_NAME> --level error --since 2h

# Step 3: Verify infrastructure health
./check-file-upload-health.sh
./verify-azure-config.sh
```

### Workflow 3: "User reported slow file processing"

```bash
# Step 1: Get user's recent activity
./fetch-container-logs.sh --user-id <USER_ID> --since 4h

# Step 2: Filter file processing logs
./fetch-container-logs.sh --user-id <USER_ID> --service FileProcessingWorker

# Step 3: Check for warnings or errors
./fetch-container-logs.sh --user-id <USER_ID> --level warn --since 4h
```

### Workflow 4: "Export logs for GDPR request"

```bash
# Export all logs for a user in JSON format
./fetch-container-logs.sh \
  --user-id <USER_ID> \
  --since 30d \
  --tail 10000 \
  --format json > user_logs_export.json
```

---

## Tips and Best Practices

### 1. Always start with health checks
Before diving into logs, run health checks to rule out infrastructure issues:
```bash
./check-file-upload-health.sh
./verify-azure-config.sh
```

### 2. Use time ranges effectively
- Use `--since 2h` for recent issues
- Use `--since 1d` for historical analysis
- Avoid very large time ranges (slow queries)

### 3. Combine filters strategically
```bash
# Good: Specific and fast
./fetch-container-logs.sh --user-id ABC --service FileUploadService --errors-only

# Bad: Too broad (slow)
./fetch-container-logs.sh --since 7d --tail 50000
```

### 4. Use JSON output for advanced analysis
```bash
# Find slowest operations
./fetch-container-logs.sh --since 1h --format json | \
  jq 'select(.durationMs) | {service, durationMs, msg}' | \
  sort -k2 -rn | head -20

# Count errors by service
./fetch-container-logs.sh --errors-only --since 6h --format json | \
  jq -r '.service' | sort | uniq -c | sort -rn
```

### 5. Save frequently used commands as aliases
Add to your `.bashrc` or `.zshrc`:
```bash
alias logs-errors='cd /path/to/infrastructure/diagnostics && ./fetch-container-logs.sh --errors-only --since 1h'
alias logs-user='cd /path/to/infrastructure/diagnostics && ./fetch-container-logs.sh --user-id'
alias health-check='cd /path/to/infrastructure/diagnostics && ./check-file-upload-health.sh'
```

---

## Common Issues

### CORS Errors (Browser file uploads failing)

**Symptom:** Browser console shows:
```
Access to XMLHttpRequest at 'https://sabcagentdev.blob.core.windows.net/...'
from origin 'http://localhost:3000' has been blocked by CORS policy
```

**Solution:**
```bash
# From project root
bash infrastructure/setup-storage-cors.sh

# Or manually add a CORS rule:
az storage cors add --account-name sabcagentdev --services b \
  --methods "GET POST PUT DELETE OPTIONS" \
  --origins "http://localhost:3000" \
  --allowed-headers "*" --exposed-headers "*" --max-age 3600
```

**Verify CORS rules:**
```bash
az storage cors list --account-name sabcagentdev --services b
```

**Note:** CORS is required for browser-based uploads. The backend uses SAS URLs that let browsers upload directly to Azure Blob Storage. Without CORS, browsers block these cross-origin requests.

---

## Troubleshooting the Scripts

### "Error: Not authenticated to Azure"
```bash
az login
az account set --subscription "<subscription-id>"
```

### "Error: jq command not found"
Install jq:
```bash
# Windows
choco install jq

# macOS
brew install jq

# Linux
sudo apt-get install jq
```

### "Error: Permission denied"
Make scripts executable:
```bash
chmod +x *.sh
```

### "Error: Resource group not found"
Update the resource group names in the script headers if your environment uses different names.

---

## Next Steps

For advanced diagnostics, see:
- **`backend/scripts/diagnostics/`** - TypeScript diagnostic scripts (Phase 4)
- **`docs/operations/runbooks/`** - Detailed runbooks for specific issues (Phase 5)
- **Application Insights queries** - Kusto queries for Log Analytics (Phase 6)

---

## Support

If you encounter issues with these scripts, please:
1. Check the Prerequisites section
2. Verify your Azure permissions
3. Review the error messages carefully
4. Contact the DevOps team with the full error output
