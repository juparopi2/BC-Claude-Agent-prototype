# Deployment Checklist: Phases 1 & 2

## Summary of Changes

### Phase 1: Diagnostic Scripts ✅
Created immediate troubleshooting tools in `infrastructure/diagnostics/`:
- `check-file-upload-health.sh` - Azure Storage infrastructure health check
- `fetch-container-logs.sh` - Smart log fetcher with filtering
- `verify-azure-config.sh` - Container App configuration validator
- `README.md` - Complete usage documentation

### Phase 2: Application Insights Integration ✅
Implemented centralized logging infrastructure:
- `setup-application-insights.sh` - Azure provisioning script
- `ApplicationInsightsSetup.ts` - Telemetry initialization
- `PinoApplicationInsightsTransport.ts` - Custom Pino → App Insights bridge
- Updated environment config, logger, server.ts, and GitHub workflow
- Added npm packages: `applicationinsights`, `pino-abstract-transport`

---

## Pre-Deployment Steps

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Test Diagnostic Scripts (No Deployment Needed)
```bash
cd infrastructure/diagnostics
chmod +x *.sh

# Health check
./check-file-upload-health.sh

# Fetch recent logs
./fetch-container-logs.sh --since 2h --errors-only

# Verify config
./verify-azure-config.sh
```

**Goal:** Identify file upload issue root cause before deploying Phase 2.

---

## Deployment Steps

### Step 1: Provision Application Insights
```bash
cd infrastructure
chmod +x setup-application-insights.sh
./setup-application-insights.sh
```

**Expected output:**
- Creates `law-bcagent-dev` (Log Analytics Workspace)
- Creates `ai-bcagent-dev` (Application Insights)
- Stores connection string in Key Vault

**Verify:**
```bash
az keyvault secret show \
  --vault-name kv-bcagent-dev \
  --name ApplicationInsights-ConnectionString
```

### Step 2: Commit and Push Changes
```bash
git add .
git commit -m "feat: Add production diagnostic infrastructure (Phases 1-2)

Phase 1 - Immediate Diagnostics:
- Health check scripts for file upload troubleshooting
- Smart log fetching with user/service filtering
- Azure configuration validator

Phase 2 - Centralized Logging:
- Application Insights integration with Pino
- User-scoped log filtering in production
- Distributed tracing foundation
- 365-day retention for GDPR compliance"

git push origin main
```

### Step 3: Monitor Deployment
```bash
# Watch GitHub Actions
gh run watch

# Or check in browser
# https://github.com/your-org/your-repo/actions
```

**Deployment takes ~5-10 minutes**

### Step 4: Verify Deployment
```bash
# Check Container App is running
az containerapp show \
  --name app-bcagent-backend-dev \
  --resource-group rg-BCAgentPrototype-app-dev \
  --query "properties.runningStatus"
# Expected: "Running"

# Check environment variables
az containerapp show \
  --name app-bcagent-backend-dev \
  --resource-group rg-BCAgentPrototype-app-dev \
  --query "properties.template.containers[0].env" | \
  grep -i "APPLICATIONINSIGHTS"
# Should see:
# - APPLICATIONINSIGHTS_ENABLED=true
# - APPLICATIONINSIGHTS_CONNECTION_STRING=secretref:...
```

---

## Post-Deployment Validation

### 1. Check Backend Logs for Telemetry Initialization
```bash
cd infrastructure/diagnostics
./fetch-container-logs.sh --tail 50 | grep -i "ApplicationInsights"
```

**Expected:**
```
[ApplicationInsights] ✅ Initialized successfully
```

**If you see errors:**
- Connection string invalid → Verify Key Vault secret
- Module not found → npm install may have failed during build
- Permission denied → Managed identity needs Key Vault access

### 2. Verify Logs Flow to Application Insights

Wait 5 minutes, then check Azure Portal:

1. Open **Application Insights** → `ai-bcagent-dev`
2. Navigate to **Logs**
3. Run query:
   ```kusto
   traces
   | where timestamp > ago(15m)
   | order by timestamp desc
   | take 20
   ```

**Expected:**
- Logs appear with recent timestamps
- `customDimensions` includes: `service`, `environment`, `version`
- HTTP requests tracked automatically

### 3. Test User-Scoped Filtering

**Scenario:** Upload a file or send a chat message

Then query:
```kusto
traces
| where timestamp > ago(5m)
| where customDimensions.service == "FileUploadService"
| order by timestamp desc
```

**Expected:**
- See logs from FileUploadService
- Logs include userId if available in context

**Note:** Background workers won't have userId yet (that's Phase 3).

---

## Troubleshooting

### Issue: "ApplicationInsights not initialized"

**Cause:** Connection string missing or invalid

**Fix:**
```bash
# Verify secret exists
az keyvault secret show \
  --vault-name kv-bcagent-dev \
  --name ApplicationInsights-ConnectionString

# If missing, run setup script again
cd infrastructure
./setup-application-insights.sh
```

### Issue: Logs not appearing in App Insights

**Possible causes:**
1. **Wait 5-10 minutes** - Ingestion has latency
2. **Sampling too low** - Check `APPLICATIONINSIGHTS_SAMPLING_PERCENTAGE=100`
3. **Backend not restarted** - Force restart:
   ```bash
   az containerapp restart \
     --name app-bcagent-backend-dev \
     --resource-group rg-BCAgentPrototype-app-dev
   ```

### Issue: Build fails during deployment

**Cause:** npm dependencies not installed

**Fix:**
- Check GitHub Actions logs for specific error
- Most common: `applicationinsights` module not found
- Verify `backend/package.json` has dependencies

---

## Rollback Plan

If Application Insights causes issues:

### Option 1: Disable via Environment Variable
```bash
az containerapp update \
  --name app-bcagent-backend-dev \
  --resource-group rg-BCAgentPrototype-app-dev \
  --set-env-vars "APPLICATIONINSIGHTS_ENABLED=false"
```

**Impact:** Logs still go to Container Apps stdout (no data loss)

### Option 2: Revert Code Changes
```bash
git revert HEAD
git push origin main
```

**Impact:** Redeploys previous version without App Insights

---

## Success Criteria

### Phase 1 ✅
- [ ] All diagnostic scripts run successfully
- [ ] File upload issue diagnosed (root cause identified)
- [ ] Scripts documented and team trained

### Phase 2 ✅
- [ ] Application Insights provisioned in Azure
- [ ] Backend deploys successfully with telemetry
- [ ] Logs appear in App Insights within 10 minutes
- [ ] HTTP requests automatically tracked
- [ ] Can filter logs by service and timestamp
- [ ] No telemetry errors in production

### Ready for Phase 3 ✅
- [ ] All above checks pass
- [ ] Team comfortable querying Application Insights
- [ ] File upload issue resolved or understood

---

## Next Steps: Phase 3

Once validation passes:

1. **Modify 11 background workers** to add job-scoped logger with userId
2. **Update job types** to include correlationId
3. **Test end-to-end tracing**: HTTP → WebSocket → Background Job
4. **Enable full distributed tracing** across the stack

**Estimated time:** 2-3 hours

---

## Quick Reference Commands

```bash
# Diagnostic Scripts
cd infrastructure/diagnostics
./check-file-upload-health.sh          # Health check
./fetch-container-logs.sh --errors-only --since 2h  # Recent errors
./verify-azure-config.sh                # Config validation

# Deployment
cd infrastructure
./setup-application-insights.sh         # Provision App Insights
git push origin main                    # Deploy

# Verification
az containerapp show --name app-bcagent-backend-dev --resource-group rg-BCAgentPrototype-app-dev
az monitor app-insights component show --app ai-bcagent-dev --resource-group rg-BCAgentPrototype-app-dev

# Troubleshooting
az containerapp logs show --name app-bcagent-backend-dev --resource-group rg-BCAgentPrototype-app-dev --tail 100
az containerapp restart --name app-bcagent-backend-dev --resource-group rg-BCAgentPrototype-app-dev
```

---

## Documentation

- **Testing Guide:** `docs/operations/PHASE_1_2_TESTING_GUIDE.md`
- **Diagnostic Scripts:** `infrastructure/diagnostics/README.md`
- **Architecture:** `CLAUDE.md` (Section 11: Logging Pattern)
- **Plan:** Original plan document with all 6 phases

---

## Support

**Questions or issues?**
1. Check troubleshooting section above
2. Review testing guide for detailed scenarios
3. Consult Azure Portal → Application Insights → Logs
4. Contact DevOps team with specific error messages
