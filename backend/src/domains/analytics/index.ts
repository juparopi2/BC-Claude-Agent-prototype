export { AgentAnalyticsService } from './AgentAnalyticsService';
export type { AgentInvocationMetrics, AgentUsageSummary, DailyUsage } from './AgentAnalyticsService';

// Singleton
let instance: AgentAnalyticsService | null = null;

export function getAgentAnalyticsService(): AgentAnalyticsService {
  if (!instance) {
    instance = new AgentAnalyticsService();
  }
  return instance;
}

/** @internal - for testing */
export function __resetAgentAnalyticsService(): void {
  instance = null;
}
