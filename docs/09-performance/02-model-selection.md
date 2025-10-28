# Model Selection

- **Haiku**: Simple tasks ($0.001)
- **Sonnet**: Balanced ($0.01)
- **Opus**: Complex ($0.05)

```typescript
function selectModel(complexity: number): Model {
  if (complexity < 3) return 'haiku';
  if (complexity < 7) return 'sonnet';
  return 'opus';
}
```
