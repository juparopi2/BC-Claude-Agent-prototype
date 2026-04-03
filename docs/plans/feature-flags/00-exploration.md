# Exploration: Feature Flags System for MyWorkMate

**Status**: Completed  
**Date**: 2026-04-02  
**SDD Phase**: Explore  
**Change name**: `feature-flags`

---

## Current State

### What already exists

The backend **already has a Layer 1 feature flags system** in `backend/src/infrastructure/config/feature-flags.ts`. It is a static, env-var-based flag loader evaluated **once at startup** and exported as a singleton `featureFlags`. It covers:

| Flag | Env Var | Default | Type |
|------|---------|---------|------|
| `agent.promptCaching` | `ENABLE_PROMPT_CACHING` | `true` | boolean |
| `agent.extendedThinking` | `ENABLE_EXTENDED_THINKING` | `true` | boolean |
| `agent.maxContextTokens` | `MAX_CONTEXT_TOKENS` | `100000` | number |
| `testing.skipClaudeTests` | computed: `!isProduction()` | — | boolean |
| `testing.skipBCTests` | hardcoded | `true` | boolean |
| `logging.fileLogging` | `ENABLE_FILE_LOGGING` | `false` | boolean |
| `logging.logLevel` | `LOG_LEVEL` | `'info'` | LogLevel |

These flags flow through an `EnvironmentFacade` (`backend/src/infrastructure/config/EnvironmentFacade.ts`) that combines env detection, feature flags, and Zod-validated env vars into a single import.

The infrastructure already has **blue-green deployment** via Azure Container Apps multi-revision mode — this is a separate, infrastructure-level "traffic flag" used for full-version canary deployments.

### What does NOT exist

- Per-user or per-org targeting
- Gradual rollout (0% → 100%) without redeploy
- Runtime kill switches (disable feature without pushing code)
- A/B testing with exposure logging
- Frontend-side flag consumption
- Any flag definitions in `@bc-agent/shared`

---

## Affected Areas

| File / Location | Why it's affected |
|-----------------|-------------------|
| `backend/src/infrastructure/config/feature-flags.ts` | Extend or supersede with runtime-capable flags |
| `backend/src/infrastructure/config/EnvironmentFacade.ts` | Add `flags` namespace for runtime flags alongside existing `features` |
| `packages/shared/src/constants/` | Add `feature-flag-keys.ts` — shared enum of all flag names |
| `packages/shared/src/index.ts` | Barrel-export the new constants |
| `backend/src/infrastructure/config/index.ts` | Re-export new FlagService |
| `frontend/src/` | New `featureFlagStore` (Zustand) + `useFeatureFlag` hook |
| `frontend/src/infrastructure/` | Flag initialization on app load via API or SSR |
| `.github/workflows/production-deploy.yml` | Add GrowthBook API key to Key Vault + env vars |
| `infrastructure/bicep/modules/keyvault-secrets.bicep` | Add `GROWTHBOOK_CLIENT_KEY` secret |

---

## The Three-Layer Architecture (Adapted to Our Stack)

The reference architecture (Claude Code) uses three distinct layers. Here is how each maps to MyWorkMate:

### Layer 1 — Static Env-Var Flags (EXISTS TODAY)

**What**: `featureFlags.ts` — loaded once at startup from env vars.  
**Use for**: LLM behavior (prompt caching, thinking budget), infrastructure config, logging levels, CI/CD test skipping.  
**Change requires**: Redeploy to take effect.  
**Example flags now**: `promptCaching`, `extendedThinking`, `maxContextTokens`.

**Assessment**: This layer is CORRECT and COMPLETE for its current purpose. No changes needed to the existing structure.

### Layer 2 — Runtime Dynamic Flags (MISSING — to add)

**What**: GrowthBook SDK — evaluated at request time, can change without redeploy.  
**Use for**: Feature rollout (0→100%), kill switches, user/org targeting, experimental features.  
**Change requires**: GrowthBook dashboard → takes effect within seconds (SDK polls).  
**Example flags to add**: `interleaved_thinking`, `deep_research_mode`, `artifacts_ui`, `dynamic_model_selection`.

### Layer 3 — Infrastructure Traffic Splitting (EXISTS TODAY)

**What**: `az containerapp ingress traffic set` — already used in production pipeline.  
**Use for**: Full-version canary deployments (new container image, not just a feature).  
**Change requires**: CI/CD pipeline run.  
**Assessment**: Already in place. No changes needed.

### The Build-Time Layer (SKIP — does not apply)

Claude Code uses `bun:bundle feature()` for **binary dead-code elimination** — code that must not ship in external distributions. This is not relevant to MyWorkMate:

- We deploy server-side containers, not distributed binaries
- SWC/Vite/Turbopack don't expose an equivalent of `bun:bundle feature()`  
- Next.js `NEXT_PUBLIC_*` bakes values at image build time but does not eliminate dead code
- The security/size benefit of DCE doesn't apply to a SaaS web app

**Decision**: Skip the build-time layer entirely. Layer 1 (static env-var) already provides the equivalent for our use case: a value is fixed for the lifetime of a container revision and changes require a deploy. That's the same lifecycle as a build-time flag, without the complexity of a special build tool.

---

## Approaches for Layer 2 (Runtime Flags)

### Option A — GrowthBook Cloud (Free Tier)

**Description**: Use GrowthBook's hosted service. The SDK (Node.js + React) polls the GrowthBook CDN for feature definitions. Free tier supports unlimited flags and environments.

| | |
|--|--|
| **Pros** | No infra to operate; zero-downtime flag changes; A/B testing built-in; org-level targeting; React SDK available; free at current scale |
| **Cons** | External SaaS dependency; flag definitions live outside our Azure environment; free tier has usage limits on experiments |
| **Effort** | Low (1–2 days to integrate SDK + wire up) |

### Option B — GrowthBook Self-Hosted (Azure Container Apps)

**Description**: Deploy the open-source GrowthBook server as a separate Container App in Azure. SDK connects to our own instance.

| | |
|--|--|
| **Pros** | Data stays in Azure; no external SaaS cost at scale; same API/SDK as Cloud option; compliant with our Azure-native architecture |
| **Cons** | Extra Container App to maintain (Azure SQL or MongoDB needed for GrowthBook); operational overhead; slower to get started |
| **Effort** | Medium (3–5 days including infrastructure provisioning) |

### Option C — Flagsmith (SaaS or self-hosted)

**Description**: Alternative open-source feature flag service.

| | |
|--|--|
| **Pros** | GDPR-friendly EU hosting option; similar capabilities to GrowthBook |
| **Cons** | Less mature React SDK; adds unfamiliar tooling with no migration path from existing `featureFlags.ts` |
| **Effort** | Medium |

### Option D — Custom Redis-Based Flags

**Description**: Store flag values in Redis. A `FlagService` reads them, exposes an API to toggle them.

| | |
|--|--|
| **Pros** | Zero external dependencies; fully in our control; Redis already present |
| **Cons** | We build and maintain the UI, API, targeting logic, and percentage rollout ourselves; weeks of work to match GrowthBook's features |
| **Effort** | High (weeks to build a production-ready system) |

### Option E — Keep Only Static Flags (no Layer 2)

**Description**: Continue with env-var flags only. Add more flags to `feature-flags.ts`.

| | |
|--|--|
| **Pros** | No new dependencies; simpler |
| **Cons** | Cannot kill-switch in production without redeploy (~5 min pipeline); cannot target individual users/orgs; no A/B testing |
| **Effort** | None — but the gap remains |

---

## Recommendation

**Start with Option A (GrowthBook Cloud) → Migrate to Option B when needed.**

The GrowthBook free tier is sufficient for our current scale and provides everything we need:
- Per-user and per-org flag evaluation
- Runtime kill switches (sub-second response to incidents)
- Gradual rollout
- A/B testing for future experiments

The SDK is provider-agnostic between Cloud and self-hosted — migrating from Cloud to self-hosted in the future is a config change (change `apiHost`), not a code change. Start lean.

---

## Recommended Architecture Design

### Flag definition location

```
packages/shared/src/constants/feature-flag-keys.ts
```

```typescript
export const FEATURE_FLAG = {
  // Experimental features (runtime-only, GrowthBook)
  INTERLEAVED_THINKING:     'interleaved_thinking_2025',
  DEEP_RESEARCH_MODE:       'deep_research_mode',
  ARTIFACTS_UI:             'artifacts_ui',
  DYNAMIC_MODEL_SELECTION:  'dynamic_model_selection',
  ANTHROPIC_FILES_API:      'anthropic_files_api',
  // Future: more flags as features are developed
} as const;

export type FeatureFlagKey = typeof FEATURE_FLAG[keyof typeof FEATURE_FLAG];
```

This mirrors the pattern already used by `AGENT_ID`, `AGENT_DISPLAY_NAME`, etc. in `agent-registry.constants.ts`. It's the ONLY thing shared between backend and frontend.

### Backend: FlagService

```
backend/src/infrastructure/config/FlagService.ts
```

```typescript
// Wraps @growthbook/growthbook Node SDK
// - Initialized once at app startup (GrowthBook.loadFeatures())
// - Per-request evaluation: FlagService.isOn(key, attributes)
// - Attributes: { id: userId, organizationId, plan, environment }
// - Supports test overrides via FEATURE_FLAG_OVERRIDES_JSON env var
```

Priority resolution (analogous to Claude Code's chain):
1. `FEATURE_FLAG_OVERRIDES_JSON` env var → test overrides (dev/CI only)
2. GrowthBook SDK evaluation (per-request, cached 60s)
3. Hardcoded default (safe fallback if GrowthBook unreachable)

### Backend: Flag exposure to frontend

A new field in the session/me endpoint (or a dedicated `/api/feature-flags` endpoint) returns the current user's evaluated flags as a flat object:

```typescript
GET /api/feature-flags
Authorization: required (uses session userId/orgId as GrowthBook attributes)
→ { interleaved_thinking_2025: false, deep_research_mode: false, artifacts_ui: false }
```

### Frontend: featureFlagStore + hook

```
frontend/src/domains/ui/featureFlagStore.ts     (Zustand)
frontend/src/hooks/useFeatureFlag.ts             (consumer)
```

```typescript
// Hydrated on login, alongside other session data
const featureFlagStore = create<FeatureFlagState>(() => ({
  flags: {} as Record<FeatureFlagKey, boolean>,
  hydrate: (flags) => set({ flags }),
}));

// Hook
function useFeatureFlag(key: FeatureFlagKey): boolean {
  return useFeatureFlagStore((s) => s.flags[key] ?? false);
}
```

This mirrors the existing pattern: `agentWorkflowStore`, `uiPreferencesStore` etc. all live in `frontend/src/domains/ui/`.

---

## Multi-Tenant Targeting Design

GrowthBook uses **attributes** to evaluate targeting rules. Our context:

| Attribute | Source | Use |
|-----------|--------|-----|
| `id` | `socket.userId` (UUID, UPPERCASE) | Per-user rollout |
| `organizationId` | future `user.orgId` | Per-org rollout (B2B) |
| `plan` | future billing tier | Plan-gated features |
| `environment` | `NODE_ENV` | `production` vs `development` |

For now (pre-billing): use only `id` and `environment`. When org/plan concepts mature, add them to GrowthBook attributes — no SDK or flag redefinition required.

**Security**: Flag evaluation happens server-side, so `userId` is always the authenticated session user. Multi-tenant isolation is preserved — a user cannot spoof their attributes.

---

## Flag Lifecycle (matching Claude Code's documented lifecycle)

```
1. Define flag in FEATURE_FLAG constant (@bc-agent/shared)
2. Add to GrowthBook dashboard at 0% rollout
3. Gate feature in code:
   if (FlagService.isOn(FEATURE_FLAG.DEEP_RESEARCH_MODE, attrs)) { ... }
4. Gradual rollout (10% → 50% → 100%) in GrowthBook dashboard
5. Monitor errors/metrics in Application Insights
6. Promote: remove GrowthBook gate, hardcode true, delete env-var
   OR revert: set to 0% in GrowthBook, then remove code + constant
```

---

## First Flags to Implement

Priority order based on risk and backlog:

| Flag | Why | Risk without flag |
|------|-----|-------------------|
| `interleaved_thinking_2025` | Beta header, requires Claude 4+, complex normalizer changes | API rejection crash |
| `deep_research_mode` | Agentic loop, potential infinite loops, high cost | Runaway costs |
| `artifacts_ui` | New rendering paradigm, sandboxed iframe, complex | Chat UI regression |
| `dynamic_model_selection` | User controls which LLM — quality/cost impact | Unexpected LLM costs |
| `anthropic_files_api` | Beta feature, 500MB limit, cleanup job required | Storage leaks |

Existing `ENABLE_PROMPT_CACHING` and `ENABLE_EXTENDED_THINKING` should REMAIN as Layer 1 (static env-var flags) — they are infrastructure-level LLM controls already wired to the deploy pipeline, and changing them requires careful coordination with the model config.

---

## What NOT to Do (Anti-Patterns)

1. **Do not replace `feature-flags.ts` with GrowthBook** — the existing system is correct for LLM behavior flags. The two systems serve different purposes.

2. **Do not evaluate GrowthBook flags in `@bc-agent/shared`** — shared has no runtime context (userId, env). It only holds the KEY constants.

3. **Do not expose the GrowthBook `clientKey` to the browser** — even though GrowthBook has a browser SDK, our user context lives in the backend session. Evaluate server-side, deliver to frontend as evaluated values.

4. **Do not use Azure Container Apps traffic splitting for feature-level rollout** — it's for full-version canary, not per-feature per-user targeting.

5. **Do not add more static env-var flags for features that benefit from per-user targeting** — if a feature needs "roll out to 10% of users", it must go in Layer 2, not Layer 1.

6. **Do not skip the shared constant** — always define flag names in `FEATURE_FLAG` before using them. Prevents magic strings and gives a single place to audit active flags.

---

## Risks

- **GrowthBook Cloud outage**: SDK falls back to hardcoded defaults. All features default to `false` (safe-off). No prod incident.
- **Evaluation performance**: GrowthBook SDK caches feature definitions in memory (TTL 60s). Per-request evaluation is microsecond-scale. No latency impact on requests.
- **Flag proliferation**: Flags that are never promoted or retired accumulate technical debt. Lifecycle discipline (promote or revert within 2 sprints of 100% rollout) must be enforced.
- **Session data gap (orgId/plan)**: Until billing and org concepts are implemented, targeting is limited to `userId` + `environment`. This limits A/B testing granularity but does not block kill-switch or rollout use cases.
- **`FEATURE_FLAG_OVERRIDES_JSON` exposure**: This override mechanism must be blocked in production (guard in `FlagService.ts` using `isProduction()`).

---

## Ready for Proposal

**Yes.** The exploration is complete and the path is clear:

1. **No new infrastructure** needed for Phase 1 (GrowthBook Cloud free tier)
2. **Minimal code surface**: shared constants + backend service + frontend store + hook
3. **Non-breaking**: existing `featureFlags.ts` continues unchanged
4. **Incremental**: start with 1–2 flags, expand as features are developed
5. **Migration path exists**: Cloud → self-hosted is a single config change

The orchestrator should present this to the user and propose proceeding to the SDD proposal phase (`sdd-propose`) when ready.
