# Progressive Disclosure

## Concept

Expose information and capabilities gradually, only when needed.

## Tool Disclosure

```typescript
class ProgressiveToolManager {
  getRelevantTools(context: Context, intent: Intent): Tool[] {
    const allTools = this.getAllTools();
    
    // Filter by intent
    let relevant = allTools.filter(tool => 
      tool.categories.includes(intent.category)
    );
    
    // Filter by permissions
    relevant = relevant.filter(tool =>
      context.hasPermission(tool.requiredPermission)
    );
    
    // Sort by usage history
    relevant.sort((a, b) => 
      context.toolUsage[b.name] - context.toolUsage[a.name]
    );
    
    // Return top 10-15
    return relevant.slice(0, 15);
  }
}
```

## Context Disclosure

Don't send everything at once:

```typescript
// ❌ BAD: Send all data
const allCustomers = await fetchAll();
// → 100K tokens

// ✅ GOOD: Send summary + resource URI
const summary = {
  totalCustomers: 1000,
  resourceUri: 'bc://entities/Customer',
  hint: 'Use bc_query_entity to fetch specific customers'
};
// → 100 tokens
```

## Skill Disclosure (Cloud Skills)

Skills become available as user progresses:

- **Level 1**: Basic CRUD operations
- **Level 2**: Batch operations
- **Level 3**: Analysis & reporting
- **Level 4**: Automation & workflows

## Benefits

- ✅ Reduced token usage (70-90%)
- ✅ Faster responses
- ✅ Better model focus
- ✅ Lower costs

---

**Versión**: 1.0
