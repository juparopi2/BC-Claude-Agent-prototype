# Subagents

## Specialized Subagents

### BC Query Subagent
```typescript
class BCQuerySubagent extends BaseAgent {
  async execute(task: QueryTask): Promise<QueryResult> {
    // 1. Build query
    const query = this.buildQuery(task);
    
    // 2. Execute via MCP
    const result = await mcpClient.call('bc_query_entity', query);
    
    // 3. Format response
    return this.formatResult(result);
  }
}
```

### BC Write Subagent
```typescript
class BCWriteSubagent extends BaseAgent {
  async execute(task: WriteTask): Promise<WriteResult> {
    // 1. Validate data
    await this.validate(task.data);
    
    // 2. Request approval
    const approved = await this.requestApproval(task);
    if (!approved) return { cancelled: true };
    
    // 3. Create checkpoint
    const checkpointId = await this.createCheckpoint();
    
    // 4. Execute
    try {
      const result = await mcpClient.call('bc_create_entity', task.data);
      return { success: true, result };
    } catch (error) {
      await this.rollback(checkpointId);
      throw error;
    }
  }
}
```

### Analysis Subagent
```typescript
class AnalysisSubagent extends BaseAgent {
  async execute(task: AnalysisTask): Promise<AnalysisResult> {
    // 1. Fetch data
    const data = await this.fetchData(task);
    
    // 2. Analyze with Claude
    const insights = await this.analyzeData(data);
    
    // 3. Generate visualizations
    const charts = await this.generateCharts(data);
    
    return { insights, charts };
  }
}
```

## Context Isolation

Each subagent has isolated context:
- Own memory
- Own tools
- Own cache

## Delegation Patterns

- **Sequential**: Steps depend on each other
- **Parallel**: Independent steps
- **Conditional**: Based on results

---

**Versión**: 1.0
