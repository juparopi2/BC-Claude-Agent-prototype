# Core LangChain Module - Model Factory

## Purpose

Universal chat model initialization across LLM providers (Anthropic, OpenAI, Google).
Role-based configuration with intelligent caching and provider-specific constraint handling.

## Architecture

```
core/langchain/
├── FirstCallToolEnforcer.ts   # Hybrid tool_choice enforcement for ReAct agents
├── ModelFactory.ts            # Universal factory with cache
├── ModelFactory.example.ts    # Usage examples
└── CLAUDE.md                  # This file

Related: infrastructure/config/models.ts (source of truth for roles)
```

## Key Concepts

### Role-Based Selection

- Models are selected by ROLE, not by name
- Changing model = changing config, not business logic
- All roles defined in `infrastructure/config/models.ts` → `ModelRoleConfigs`

### Direct Constructors (NOT initChatModel)

- `initChatModel()` wraps in ConfigurableModel → JSON.stringify → crash with circular refs from LangGraph checkpointer
- ALWAYS use direct constructors: `new ChatAnthropic()`, `new ChatOpenAI()`

### Cache Strategy

- Key format: `provider:model:t{temp}:m{maxTokens}:s{streaming}:th{thinking}`
- In-memory, per-process, cleared on restart
- `ModelFactory.clearCache()` available for testing

## Critical Provider Constraints

### Anthropic: Temperature + Thinking Mutual Exclusion

- **CRITICAL**: thinking enabled → temperature MUST be omitted
- API defaults to temperature=1 internally when thinking is enabled
- Violation causes runtime crash: `"temperature is not supported when thinking is enabled"`
- Implementation in ModelFactory.ts: `...(thinking ? {} : { temperature })`
- Prevention: parameterized test iterates ALL roles from ModelRoleConfigs

### Anthropic: max_tokens > budget_tokens

- **CRITICAL**: when thinking is enabled, `maxTokens` MUST be greater than `thinking.budget_tokens`
- Violation causes: `"max_tokens must be greater than thinking.budget_tokens"`
- Supervisor raised from 2048 → 16384 to accommodate budget_tokens: 5000

### Anthropic: tool_choice + Thinking Mutual Exclusion

- **CRITICAL**: thinking enabled → tool_choice MUST be 'auto' (default)
- Using tool_choice: 'any' with thinking causes API rejection
- Guarded in `agent-builders.ts`: throws at startup if agent has thinking + tools
- `FirstCallToolEnforcer.ts` only applies to worker agents (thinking disabled)
- Prevention: parameterized test in `agent-builders.test.ts` validates all agents

### FirstCallToolEnforcer

- **Location**: `core/langchain/FirstCallToolEnforcer.ts`
- **Purpose**: Forces tool_choice: 'any' on first LLM call, then 'auto' for subsequent calls
- **Mechanism**: Overrides `invoke()` on a pre-bound `RunnableBinding`, switching between forced/auto models based on call count per thread_id
- **Thread safety**: Uses Map<thread_id, callCount> for concurrent invocations (evicts at 100 entries)
- **Integration**: `agent-builders.ts` wraps each worker model with `createFirstCallEnforcer(model, tools)`
- **Why RunnableBinding**: createReactAgent's `_shouldBindTools()` checks `RunnableBinding.isRunnableBinding(llm)` and `kwargs.tools` — pre-bound models skip re-binding

### Adding a New Role

1. Edit `infrastructure/config/models.ts` → add to `ModelRoleConfigs`
2. If `thinking.type === 'enabled'` → do NOT add temperature to config
3. If agent has tools + thinking enabled → `agent-builders.ts` will throw (guard)
4. Run `npm run -w backend test:unit` to verify parameterized tests pass
5. ModelFactory handles temperature exclusion automatically, but config should not create conflicts

## Testing Patterns

- Use `expect.objectContaining()` for constructor assertions (resilient to new fields)
- Parameterized tests: iterate `ModelRoleConfigs` to cover future roles automatically
- Tests location: `__tests__/unit/core/langchain/` (NOT co-located with source)
- Always run via workspace: `npm run -w backend test:unit -- -t "ModelFactory"`

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `temperature is not supported when thinking is enabled` | Config has both temperature and thinking enabled | Remove temperature from role config in models.ts |
| `max_tokens must be greater than thinking.budget_tokens` | maxTokens is less than or equal to budget_tokens | Increase maxTokens in models.ts to be > budget_tokens |
| `Cannot read property of undefined` in tests | Running `npx vitest` from root | Use `npm run -w backend test:unit` instead |
| Cache key collision | Same provider+model but different thinking config | Verify cache key includes `:th{thinking}` suffix |

## Related Documentation

- Root CLAUDE.md: Section 11.7 (Provider Constraints)
- Root CLAUDE.md: Section 4.4 (Test Conventions)
- Config: `backend/src/infrastructure/config/models.ts`
