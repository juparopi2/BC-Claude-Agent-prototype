# Stateful Agent Execution

```typescript
class StatefulAgent {
  private state: AgentState;
  
  async execute(action: Action): Promise<Result> {
    // Load state
    this.state = await this.loadState();
    
    // Execute
    const result = await this.performAction(action);
    
    // Save state
    await this.saveState(this.state);
    
    return result;
  }
}
```
