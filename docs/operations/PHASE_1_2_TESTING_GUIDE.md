# Phase 1-2 Testing Guide: Diagnostic Infrastructure

This guide walks you through testing the diagnostic scripts (Phase 1) and Application Insights integration (Phase 2).

## Prerequisites

Before starting, ensure you have:

1. **Azure CLI** installed and authenticated:
   ```bash
   az login
   az account set --subscription "<your-subscription-id>"
   ```

2. **Permissions**:
   - Reader access to resource groups
   - Key Vault Secrets User role
   - Storage Blob Data Contributor role

3. **jq** installed (for JSON parsing in bash scripts)

4. **Git Bash** (on Windows) or native bash (Linux/Mac)

---

## Phase 1: Test Diagnostic Scripts (No Deployment Required)

These scripts work immediately against your existing Azure infrastructure.

### Test 1: File Upload Health Check

This script performs a comprehensive health check of the file upload infrastructure.

```bash
cd infrastructure/diagnostics

# Make scripts executable (first time only)
chmod +x *.sh

# Run health check
./check-file-upload-health.sh
```

**Expected Output:**
- ✅ Green checkmarks for passing checks
- ⚠️ Yellow warnings for non-critical issues
- ❌ Red X for critical failures

**What it checks:**
1. Azure Storage account exists and is accessible
2. Container `user-files` exists
3. Network firewall rules
4. CORS configuration
5. Managed identity permissions
6. Key Vault secrets
7. Container App environment variables
8. Live connection test (uploads a test file)

**Action Items from Health Check:**
- If any checks fail, follow the remediation steps in the output
- Most common issue: Managed identity missing "Storage Blob Data Contributor" role

---

### Test 2: Fetch Container Logs

Test the log fetching script to diagnose current issues.

```bash
cd infrastructure/diagnostics

# Get last 100 logs (basic)
./fetch-container-logs.sh

# Get logs from last 2 hours
./fetch-container-logs.sh --since 2h --tail 200

# Show only errors from last 6 hours
./fetch-container-logs.sh --errors-only --since 6h

# Filter by service
./fetch-container-logs.sh --service FileUploadService --since 1h

# If you know a specific userId, filter by that
./fetch-container-logs.sh --user-id BCD5A31B-C560-40D5-972F-50E134A8389D --since 2h
```

**Expected Output:**
- Colored, formatted logs with timestamps
- Error logs highlighted in red
- Warnings in yellow
- Info logs in green

**What to look for:**
- Any recent errors related to file uploads
- Connection failures to Storage, Redis, or SQL
- Authentication errors
- Timeout errors

**Debugging the File Upload Issue:**
Based on the health check and logs, identify:
1. Is `STORAGE_CONNECTION_STRING` valid?
2. Is the managed identity properly configured?
3. Are there firewall blocks?
4. Are there errors in FileUploadService logs?

---

### Test 3: Verify Azure Configuration

This validates that all environment variables and secrets are correctly configured.

```bash
cd infrastructure/diagnostics

./verify-azure-config.sh
```

**Expected Output:**
- Complete inventory of environment variables
- Validation against expected values
- Secret existence checks in Key Vault
- Managed identity verification

**What to look for:**
- All required environment variables present
- Secrets properly referenced via `secretRef:`
- Managed identity assigned
- Key Vault access configured

---

## Phase 2: Test Application Insights Integration (Requires Deployment)

Phase 2 requires deploying code changes to Azure.

### Step 1: Build and Verify Locally

First, ensure the code compiles without errors.

```bash
# From project root
cd backend

# Install new dependencies
npm install

# Type check (should pass)
npm run type-check

# Build (should succeed)
npm run build
```

**Expected:**
- No TypeScript errors
- Build completes successfully
- `dist/` directory contains compiled JavaScript

**If build fails:**
- Check for missing type definitions
- Ensure `applicationinsights` and `pino-abstract-transport` packages installed
- Review error messages carefully

---

### Step 2: Test Application Insights Locally (Optional)

You can test App Insights integration locally before deploying.

```bash
# Set up local environment variables
# Edit backend/.env and add:
# APPLICATIONINSIGHTS_CONNECTION_STRING=<your-connection-string>
# APPLICATIONINSIGHTS_ENABLED=true

# Run backend locally
npm run dev

# In another terminal, trigger some actions
# Upload a file, send a chat message, etc.
```

**What to check:**
- Server starts without errors
- Console shows: `[ApplicationInsights] ✅ Initialized successfully`
- No errors related to telemetry

**To get connection string for local testing:**
```bash
# Run setup script first (see Step 3)
az monitor app-insights component show \
  --app ai-bcagent-dev \
  --resource-group rg-BCAgentPrototype-app-dev \
  --query connectionString -o tsv
```

---

### Step 3: Provision Application Insights in Azure

Run the setup script to create Log Analytics Workspace and Application Insights.

```bash
cd infrastructure

# Make script executable
chmod +x setup-application-insights.sh

# Run setup
./setup-application-insights.sh
```

**Expected Output:**
- Creates Log Analytics Workspace: `law-bcagent-dev`
- Creates Application Insights: `ai-bcagent-dev`
- Stores connection string in Key Vault: `ApplicationInsights-ConnectionString`
- Configures 365-day retention (GDPR compliance)
- Sets sampling to 100%

**What to verify:**
1. Check Azure Portal:
   - Log Analytics Workspace exists
   - Application Insights exists and linked to workspace

2. Check Key Vault:
   ```bash
   az keyvault secret show \
     --vault-name kv-bcagent-dev \
     --name ApplicationInsights-ConnectionString \
     --query value -o tsv
   ```
   Should return a connection string starting with `InstrumentationKey=...`

---

### Step 4: Deploy Backend with Application Insights

Commit and push changes to trigger deployment.

```bash
# From project root
git add .
git commit -m "feat: Add Application Insights integration for centralized logging

- Phase 1: Diagnostic scripts for immediate troubleshooting
- Phase 2: Application Insights with Pino transport
- Enable user-scoped log filtering in production
- Add health check scripts for file upload infrastructure"

git push origin main
```

**What happens:**
- GitHub Actions workflow triggers
- Backend builds with new Application Insights code
- Container App updates with new environment variables
- Application Insights connection string injected from Key Vault

**Monitor deployment:**
```bash
# Watch GitHub Actions
# https://github.com/your-org/your-repo/actions

# Or use GitHub CLI
gh run watch
```

---

### Step 5: Verify Application Insights is Working

After deployment completes (5-10 minutes), verify logs are flowing.

**Method 1: Azure Portal (Easiest)**

1. Open Azure Portal → Application Insights → `ai-bcagent-dev`
2. Navigate to **Logs** (left sidebar)
3. Run this query:
   ```kusto
   traces
   | where timestamp > ago(15m)
   | order by timestamp desc
   | take 100
   ```

**Expected:**
- See recent logs from backend
- Logs should have `customDimensions` with:
  - `service` (e.g., "FileUploadService")
  - `userId` (if available in context)
  - `sessionId` (if available)
  - `environment` ("production")

**Method 2: Azure CLI**

```bash
# Get workspace ID
WORKSPACE_ID=$(az monitor log-analytics workspace show \
  --workspace-name law-bcagent-dev \
  --resource-group rg-BCAgentPrototype-app-dev \
  --query id -o tsv)

# Query recent logs
az monitor log-analytics query \
  --workspace "$WORKSPACE_ID" \
  --analytics-query "traces | where timestamp > ago(15m) | take 10" \
  --output table
```

---

### Step 6: Test User-Scoped Filtering

The real power of this setup is filtering logs by specific users.

**Scenario:** A user "Juan Pablo" reports a file upload failure.

1. **Get userId from email** (requires DB query or admin panel)

2. **Query logs for that user in Azure Portal:**
   ```kusto
   traces
   | where timestamp > ago(24h)
   | where customDimensions.userId == "BCD5A31B-C560-40D5-972F-50E134A8389D"
   | order by timestamp desc
   | project timestamp, severityLevel, message, customDimensions
   ```

3. **Filter by service:**
   ```kusto
   traces
   | where timestamp > ago(24h)
   | where customDimensions.userId == "BCD5A31B-C560-40D5-972F-50E134A8389D"
   | where customDimensions.service == "FileUploadService"
   | order by timestamp desc
   ```

4. **Find errors only:**
   ```kusto
   traces
   | where timestamp > ago(24h)
   | where customDimensions.userId == "BCD5A31B-C560-40D5-972F-50E134A8389D"
   | where severityLevel >= 3  // Error or Critical
   | order by timestamp desc
   ```

**What to verify:**
- Logs can be filtered by userId
- customDimensions contain expected fields
- Errors are properly logged with stack traces

---

### Step 7: Test Distributed Tracing (Future)

Once Phase 3 is complete (background workers with user context), you'll be able to trace a request across:
1. HTTP request → WebSocket → Agent execution → Background job

For now, verify HTTP requests are logged:

```kusto
requests
| where timestamp > ago(15m)
| order by timestamp desc
| take 20
```

---

## Validation Checklist

### Phase 1: Diagnostic Scripts ✅
- [ ] `check-file-upload-health.sh` runs without errors
- [ ] Health check identifies any infrastructure issues
- [ ] `fetch-container-logs.sh` retrieves recent logs
- [ ] Logs can be filtered by service and level
- [ ] `verify-azure-config.sh` shows all environment variables
- [ ] Configuration validation passes or shows clear issues

### Phase 2: Application Insights ✅
- [ ] Backend code compiles without errors (`npm run build`)
- [ ] Application Insights resources created in Azure
- [ ] Connection string stored in Key Vault
- [ ] Deployment to Container App succeeds
- [ ] Backend starts without telemetry errors
- [ ] Logs appear in Application Insights within 5 minutes
- [ ] Logs contain `customDimensions` (service, environment)
- [ ] Can query logs by timestamp and severity
- [ ] HTTP requests tracked automatically

### Phase 2 - User Context (Partial) ⚠️
- [ ] HTTP request logs include userId (from session)
- [ ] WebSocket logs include userId
- [ ] Background job logs DO NOT yet include userId ❌ (Phase 3)

---

## Troubleshooting

### Issue: Application Insights logs not appearing

**Possible causes:**
1. **Connection string invalid**
   - Verify: `az keyvault secret show --vault-name kv-bcagent-dev --name ApplicationInsights-ConnectionString`
   - Should start with `InstrumentationKey=`

2. **APPLICATIONINSIGHTS_ENABLED=false**
   - Check Container App environment variables
   - Should be `true`

3. **Sampling too low**
   - Check `APPLICATIONINSIGHTS_SAMPLING_PERCENTAGE`
   - Should be `100` for initial testing

4. **Telemetry ingestion delay**
   - Wait 5-10 minutes after first request
   - App Insights has some latency

5. **Backend not restarted**
   - Force restart: `az containerapp restart --name app-bcagent-backend-dev --resource-group rg-BCAgentPrototype-app-dev`

**Debug steps:**
```bash
# Check Container App logs for telemetry errors
./infrastructure/diagnostics/fetch-container-logs.sh --service ApplicationInsights --errors-only

# Check if telemetry is being sent
./infrastructure/diagnostics/fetch-container-logs.sh | grep -i "initialized successfully"
# Should see: [ApplicationInsights] ✅ Initialized successfully
```

---

### Issue: Build fails with TypeScript errors

**Possible causes:**
1. **Missing dependencies**
   ```bash
   cd backend
   npm install
   ```

2. **Type definition conflicts**
   - Check `@types/node` version
   - Ensure `applicationinsights` types are installed

3. **Path alias issues**
   - Verify `tsconfig.json` paths configuration
   - Run: `npm run build` (should show specific errors)

---

### Issue: Diagnostic scripts fail with "Not authenticated"

**Solution:**
```bash
az login
az account set --subscription "<your-subscription-id>"
az account show  # Verify correct subscription
```

---

## Next Steps: Phase 3

Once Phase 1-2 are validated:

1. **Identify file upload root cause** using diagnostic scripts
2. **Fix the immediate issue** (most likely: managed identity permissions or firewall)
3. **Proceed to Phase 3**: Add user context to background workers
4. **Continue to Phase 4-6**: TypeScript diagnostic scripts, runbooks, monitoring

---

## Success Criteria

**Phase 1 Complete When:**
- All diagnostic scripts run successfully
- File upload issue diagnosed (root cause identified)
- Team can use scripts to troubleshoot production issues

**Phase 2 Complete When:**
- Logs flow to Application Insights within 5 minutes of activity
- HTTP requests include userId in custom dimensions
- Can filter logs by service, level, and user
- No telemetry errors in Container App logs

**Ready for Phase 3 When:**
- All Phase 1-2 validation checks pass ✅
- File upload issue resolved or understood ✅
- Team comfortable with Application Insights queries ✅

---

## Support Resources

- **Azure Portal**: https://portal.azure.com
- **Application Insights Kusto Query Language**: https://learn.microsoft.com/en-us/azure/data-explorer/kusto/query/
- **Diagnostic Scripts README**: `infrastructure/diagnostics/README.md`
- **CLAUDE.md**: Project architecture and conventions

**Questions?** Check the troubleshooting section or consult the DevOps team.
