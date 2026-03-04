# API Strategy — LLM Provider Configuration

## Current Setup

| Setting | Value |
|---------|-------|
| Provider | Anthropic (direct) |
| API Key | `sk-ant-...` from console.anthropic.com |
| Model | `claude-haiku-4-5-20251001` (all roles) |
| Estimated Tier | Tier 1 (50 RPM) |
| Key Storage (dev) | `.env` local |
| Key Storage (prod) | Azure Key Vault |

### Known Limitations

- **Tier 1** has a 50 RPM limit — the primary cause of `overloaded_error` (529) during testing
- No provisioned throughput or priority access
- Azure already in use for: OpenAI embeddings, AI Search, Vision, Doc Intelligence, Key Vault

---

## Tier Roadmap

| Phase | Tier | Deposit | RPM | Monthly Limit | When |
|-------|------|---------|-----|---------------|------|
| Dev | Tier 1 | $5 | 50 | $100/mo | Current |
| Alpha | Tier 2 | $40 | 1,000 | $500/mo | Internal users |
| Beta | Tier 3 | $200 | 2,000 | $1,000/mo | Closed beta |
| Launch | Tier 4 | $400 | 4,000 | $5,000+/mo | GA launch |
| Scale | Enterprise | Custom | Custom | Custom | High-volume |

**Action**: Upgrade to Tier 2 ($40 deposit) before alpha testing.

---

## Provider Comparison: Anthropic Direct vs Azure AI Foundry vs AWS Bedrock

| Factor | Anthropic Direct | Azure AI Foundry | AWS Bedrock |
|--------|------------------|------------------|-------------|
| Pricing | Base rate | Same | Same |
| Feature availability | Day-0 access | Full parity | 2-4 week delay |
| Regions | Global | East US 2, Sweden Central | Multiple |
| Authentication | API key | API key + Entra ID | IAM roles |
| Rate limits | Auto-advance (deposit) | Request via portal | Request |
| SDK integration | `@langchain/anthropic` | Same (change `baseURL`) | `@langchain/aws` |
| Prerequisite | None | Enterprise/MCA-E subscription | AWS account |
| Billing | Separate Anthropic invoice | Consolidated Azure invoice | Consolidated AWS invoice |
| Governance | Manual | Azure Policy, RBAC, audit logs | CloudTrail, IAM |

### Recommendation

- **Short term (dev/alpha)**: Stay with Anthropic direct. Upgrade to Tier 2 ($40 deposit).
- **Production**: Evaluate Azure AI Foundry for unified billing, Entra ID auth, and governance.
- **Migration effort**: Minimal — only change `baseURL` in `ModelFactory.ts`. No SDK or code changes needed.

---

## API Keys Structure

| Environment | Key Source | Storage |
|-------------|-----------|---------|
| Dev | console.anthropic.com | `.env` local |
| Staging | console.anthropic.com | Azure Key Vault (dev) |
| Production | Anthropic or Azure Foundry | Azure Key Vault (prod) |

**Security**:
- Keys are never committed to git (`.env` in `.gitignore`)
- Production keys are stored encrypted in Azure Key Vault
- Key rotation: manual via console.anthropic.com or Azure Foundry portal

---

## Error Types Reference

| Error | HTTP Status | Cause | Retryable | Retry Delay |
|-------|-------------|-------|-----------|-------------|
| `overloaded_error` | 529 | Anthropic servers busy | Yes | 15s |
| Rate limit | 429 | RPM/TPM exceeded | Yes | `retry-after` header or 30s |
| Auth error | 401 | Invalid/expired key | No | — |
| Bad request | 400 | Invalid parameters (bug) | No | — |
| Server error | 500+ | Anthropic internal | Yes | 10s |
| Connection error | — | Network/DNS failure | Yes | 3s |
| Timeout | — | Request exceeded time limit | Yes | 5s |

### Error Handling Architecture

The system uses a centralized `LlmErrorClassifier` (`backend/src/shared/errors/LlmErrorClassifier.ts`) that:

1. **Classifies** errors using Anthropic SDK types (`instanceof`) with string fallback for LangChain-wrapped errors
2. **Maps** to user-friendly `ErrorCode` values defined in `@bc-agent/shared`
3. **Includes** retry metadata (`retryable`, `retryAfterMs`) for future UI retry buttons

Retry is handled at the `GraphExecutor` level:
- 2 retries (3 total attempts) with exponential backoff (1.5s → 3s)
- Only retries transient errors (overloaded, rate limit, server errors, timeouts)
- Non-retryable errors (auth, bad request) fail immediately

---

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/infrastructure/config/models.ts` | Model and role configuration |
| `backend/src/core/langchain/ModelFactory.ts` | LLM client creation (future: `baseURL` change for Azure) |
| `backend/src/shared/errors/LlmErrorClassifier.ts` | Centralized error classification |
| `backend/src/shared/utils/retry.ts` | Exponential backoff utility |
| `backend/src/domains/agent/orchestration/execution/GraphExecutor.ts` | Retry integration point |
| `packages/shared/src/constants/errors.ts` | ErrorCode definitions (LLM_*) |
