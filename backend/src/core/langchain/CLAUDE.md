# Core LangChain Module - Model Factory

## Purpose

Universal chat model initialization across LLM providers (Anthropic, OpenAI, Google).
Role-based configuration with intelligent caching and provider-specific constraint handling.

## Architecture

```
core/langchain/
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

### Adding a New Role

1. Edit `infrastructure/config/models.ts` → add to `ModelRoleConfigs`
2. If `thinking.type === 'enabled'` → do NOT add temperature to config
3. Run `npm run -w backend test:unit` to verify parameterized tests pass
4. ModelFactory handles the exclusion automatically, but config should not create conflicts

## Testing Patterns

- Use `expect.objectContaining()` for constructor assertions (resilient to new fields)
- Parameterized tests: iterate `ModelRoleConfigs` to cover future roles automatically
- Tests location: `__tests__/unit/core/langchain/` (NOT co-located with source)
- Always run via workspace: `npm run -w backend test:unit -- -t "ModelFactory"`

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `temperature is not supported when thinking is enabled` | Config has both temperature and thinking enabled | Remove temperature from role config in models.ts |
| `Cannot read property of undefined` in tests | Running `npx vitest` from root | Use `npm run -w backend test:unit` instead |
| Cache key collision | Same provider+model but different thinking config | Verify cache key includes `:th{thinking}` suffix |

## Related Documentation

- Root CLAUDE.md: Section 11.7 (Provider Constraints)
- Root CLAUDE.md: Section 4.4 (Test Conventions)
- Config: `backend/src/infrastructure/config/models.ts`
