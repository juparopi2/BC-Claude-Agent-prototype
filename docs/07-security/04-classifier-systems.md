# Anti-Prompt Injection

```typescript
async function detectPromptInjection(input: string): Promise<boolean> {
  const patterns = [
    /ignore previous instructions/i,
    /you are now/i,
    /system: /i
  ];
  
  return patterns.some(p => p.test(input));
}
```
