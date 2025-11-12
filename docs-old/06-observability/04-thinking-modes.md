# Thinking Modes

## Extended Thinking

```typescript
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4',
  messages: [...],
  thinking: {
    type: 'extended',
    budget_tokens: 10000
  }
});

// Response includes thinking blocks
response.content.filter(block => block.type === 'thinking');
```

## Interleaved Thinking

Visible reasoning throughout response.

```
<thinking>
The user wants to create 5 users. I need to:
1. Get the data source
2. Validate each user
3. Request approval
4. Create them
</thinking>

I'll help you create 5 users. First, where is the data?
```

---

**Versión**: 1.0
