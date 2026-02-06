import { PrismaClient } from '@prisma/client';
import { createChildLogger } from '@/shared/utils/logger';
import { prisma as defaultPrisma } from '@/infrastructure/database/prisma';
import type { ILoggerMinimal } from '@/infrastructure/queue/IMessageQueueDependencies';

export interface AgentInvocationMetrics {
  agentId: string;
  success: boolean;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface AgentUsageSummary {
  agentId: string;
  totalInvocations: number;
  totalSuccesses: number;
  totalErrors: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgLatencyMs: number;
}

export interface DailyUsage {
  date: string; // ISO date string
  invocationCount: number;
  successCount: number;
  errorCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgLatencyMs: number;
}

interface AgentAnalyticsServiceDeps {
  prisma?: PrismaClient;
  logger?: ILoggerMinimal;
}

export class AgentAnalyticsService {
  private prisma: PrismaClient;
  private logger: ILoggerMinimal;

  constructor(deps?: AgentAnalyticsServiceDeps) {
    this.prisma = deps?.prisma ?? defaultPrisma;
    this.logger = deps?.logger ?? createChildLogger({ service: 'AgentAnalyticsService' });
  }

  /**
   * Record an agent invocation (fire-and-forget).
   * Catches errors internally and logs warnings.
   */
  async recordInvocation(metrics: AgentInvocationMetrics): Promise<void> {
    try {
      const date = new Date();
      // Reset time to midnight for daily aggregation
      date.setUTCHours(0, 0, 0, 0);

      const successIncr = metrics.success ? 1 : 0;
      const errorIncr = metrics.success ? 0 : 1;

      // Use MERGE for atomic upsert with increment
      await this.prisma.$executeRaw`
        MERGE agent_usage_analytics AS target
        USING (SELECT ${date} AS date, ${metrics.agentId} AS agent_id) AS source
        ON target.date = source.date AND target.agent_id = source.agent_id
        WHEN MATCHED THEN UPDATE SET
          invocation_count = invocation_count + 1,
          success_count = success_count + ${successIncr},
          error_count = error_count + ${errorIncr},
          total_input_tokens = total_input_tokens + ${BigInt(metrics.inputTokens)},
          total_output_tokens = total_output_tokens + ${BigInt(metrics.outputTokens)},
          total_latency_ms = total_latency_ms + ${BigInt(metrics.latencyMs)},
          min_latency_ms = CASE
            WHEN min_latency_ms IS NULL OR ${metrics.latencyMs} < min_latency_ms
            THEN ${metrics.latencyMs}
            ELSE min_latency_ms
          END,
          max_latency_ms = CASE
            WHEN max_latency_ms IS NULL OR ${metrics.latencyMs} > max_latency_ms
            THEN ${metrics.latencyMs}
            ELSE max_latency_ms
          END,
          updated_at = getutcdate()
        WHEN NOT MATCHED THEN INSERT (
          date,
          agent_id,
          invocation_count,
          success_count,
          error_count,
          total_input_tokens,
          total_output_tokens,
          total_latency_ms,
          min_latency_ms,
          max_latency_ms
        )
        VALUES (
          ${date},
          ${metrics.agentId},
          1,
          ${successIncr},
          ${errorIncr},
          ${BigInt(metrics.inputTokens)},
          ${BigInt(metrics.outputTokens)},
          ${BigInt(metrics.latencyMs)},
          ${metrics.latencyMs},
          ${metrics.latencyMs}
        );
      `;

      this.logger.debug(
        {
          agentId: metrics.agentId,
          success: metrics.success,
          inputTokens: metrics.inputTokens,
          outputTokens: metrics.outputTokens,
          latencyMs: metrics.latencyMs,
        },
        'Agent invocation recorded'
      );
    } catch (error) {
      const errorInfo =
        error instanceof Error
          ? { message: error.message, stack: error.stack, name: error.name }
          : { value: String(error) };
      this.logger.warn(
        { error: errorInfo, metrics },
        'Failed to record agent invocation'
      );
    }
  }

  /**
   * Get usage summary aggregated by agent for a date range.
   */
  async getUsageSummary(
    startDate: Date,
    endDate: Date
  ): Promise<AgentUsageSummary[]> {
    // Normalize dates to midnight UTC
    const start = new Date(startDate);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setUTCHours(23, 59, 59, 999);

    const results = await this.prisma.agent_usage_analytics.groupBy({
      by: ['agent_id'],
      where: {
        date: {
          gte: start,
          lte: end,
        },
      },
      _sum: {
        invocation_count: true,
        success_count: true,
        error_count: true,
        total_input_tokens: true,
        total_output_tokens: true,
        total_latency_ms: true,
      },
    });

    return results.map((result) => {
      const totalInvocations = result._sum.invocation_count ?? 0;
      const totalLatencyMs = Number(result._sum.total_latency_ms ?? 0n);
      const avgLatencyMs =
        totalInvocations > 0 ? Math.round(totalLatencyMs / totalInvocations) : 0;

      return {
        agentId: result.agent_id,
        totalInvocations,
        totalSuccesses: result._sum.success_count ?? 0,
        totalErrors: result._sum.error_count ?? 0,
        totalInputTokens: Number(result._sum.total_input_tokens ?? 0n),
        totalOutputTokens: Number(result._sum.total_output_tokens ?? 0n),
        avgLatencyMs,
      };
    });
  }

  /**
   * Get daily usage for a specific agent.
   */
  async getDailyUsage(agentId: string, days = 30): Promise<DailyUsage[]> {
    const endDate = new Date();
    endDate.setUTCHours(23, 59, 59, 999);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setUTCHours(0, 0, 0, 0);

    const results = await this.prisma.agent_usage_analytics.findMany({
      where: {
        agent_id: agentId,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: {
        date: 'asc',
      },
    });

    return results.map((row) => {
      const invocationCount = row.invocation_count;
      const totalLatencyMs = Number(row.total_latency_ms);
      const avgLatencyMs =
        invocationCount > 0 ? Math.round(totalLatencyMs / invocationCount) : 0;

      return {
        date: row.date.toISOString().split('T')[0], // YYYY-MM-DD format
        invocationCount,
        successCount: row.success_count,
        errorCount: row.error_count,
        totalInputTokens: Number(row.total_input_tokens),
        totalOutputTokens: Number(row.total_output_tokens),
        avgLatencyMs,
      };
    });
  }
}
