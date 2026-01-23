/**
 * Pino Application Insights Transport
 *
 * Custom Pino transport that sends logs to Azure Application Insights.
 * Transforms Pino log format into App Insights traces with custom dimensions.
 *
 * Key Features:
 * - Maps Pino log levels to Application Insights severity levels
 * - Extracts userId, sessionId, service into custom dimensions for filtering
 * - Batches logs for performance (configurable)
 * - Graceful error handling - never crashes the app
 * - Includes error serialization with stack traces
 *
 * IMPORTANT: This transport runs in a separate worker thread (Pino's architecture).
 * It cannot access the main thread's Application Insights client, so it initializes
 * its own TelemetryClient using the connection string passed via options.
 *
 * @module infrastructure/telemetry
 */

import build from 'pino-abstract-transport';
import * as appInsights from 'applicationinsights';
import type { SeverityLevel } from 'applicationinsights/out/Declarations/Contracts';
import type { TelemetryClient } from 'applicationinsights';

/**
 * Pino log levels mapped to numeric values
 */
const PINO_LEVELS = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
} as const;

/**
 * Maps Pino log level to Application Insights SeverityLevel
 *
 * Pino levels: trace(10), debug(20), info(30), warn(40), error(50), fatal(60)
 * App Insights levels: Verbose(0), Information(1), Warning(2), Error(3), Critical(4)
 *
 * @param pinoLevel - Pino numeric log level
 * @returns Application Insights SeverityLevel
 */
function mapPinoLevelToSeverity(pinoLevel: number): SeverityLevel {
  if (pinoLevel >= PINO_LEVELS.fatal) {
    return 4; // Critical
  }
  if (pinoLevel >= PINO_LEVELS.error) {
    return 3; // Error
  }
  if (pinoLevel >= PINO_LEVELS.warn) {
    return 2; // Warning
  }
  if (pinoLevel >= PINO_LEVELS.info) {
    return 1; // Information
  }
  return 0; // Verbose (for trace/debug)
}

/**
 * Extracts custom dimensions from a Pino log object.
 *
 * Custom dimensions enable filtering in Application Insights Log Analytics:
 * - userId: Filter logs by specific user
 * - sessionId: Correlate logs within a session
 * - service: Filter by component (e.g., FileUploadService)
 * - jobId: Track background job execution
 * - correlationId: Distributed tracing across services
 *
 * @param logObj - Pino log object
 * @returns Custom dimensions object
 */
function extractCustomDimensions(logObj: unknown): Record<string, string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = logObj as any;
  const dimensions: Record<string, string> = {};

  // Core identifiers
  if (obj.userId) dimensions.userId = String(obj.userId);
  if (obj.sessionId) dimensions.sessionId = String(obj.sessionId);
  if (obj.service) dimensions.service = String(obj.service);

  // Background job context
  if (obj.jobId) dimensions.jobId = String(obj.jobId);
  if (obj.jobName) dimensions.jobName = String(obj.jobName);

  // Distributed tracing
  if (obj.correlationId)
    dimensions.correlationId = String(obj.correlationId);

  // HTTP request context
  if (obj.req?.id) dimensions.requestId = String(obj.req.id);
  if (obj.req?.method) dimensions.httpMethod = String(obj.req.method);
  if (obj.req?.url) dimensions.httpUrl = String(obj.req.url);

  // File context
  if (obj.fileId) dimensions.fileId = String(obj.fileId);
  if (obj.fileName) dimensions.fileName = String(obj.fileName);
  if (obj.mimeType) dimensions.mimeType = String(obj.mimeType);

  // Error context
  if (obj.error) {
    if (obj.error.name) dimensions.errorName = String(obj.error.name);
    if (obj.error.code) dimensions.errorCode = String(obj.error.code);
  }

  // Performance metrics
  if (obj.durationMs !== undefined)
    dimensions.durationMs = String(obj.durationMs);
  if (obj.responseTime !== undefined)
    dimensions.responseTime = String(obj.responseTime);

  // Agent context
  if (obj.agentType) dimensions.agentType = String(obj.agentType);
  if (obj.model) dimensions.model = String(obj.model);
  if (obj.inputTokens !== undefined)
    dimensions.inputTokens = String(obj.inputTokens);
  if (obj.outputTokens !== undefined)
    dimensions.outputTokens = String(obj.outputTokens);

  return dimensions;
}

/**
 * Formats error object for Application Insights.
 *
 * Extracts message, stack trace, and additional properties.
 *
 * @param error - Error object from log
 * @returns Formatted error string
 */
function formatError(error: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const err = error as any;
  if (!err) return '';

  const parts: string[] = [];

  if (err.message) {
    parts.push(`Message: ${err.message}`);
  }

  if (err.name && err.name !== 'Error') {
    parts.push(`Type: ${err.name}`);
  }

  if (err.code) {
    parts.push(`Code: ${err.code}`);
  }

  if (err.stack) {
    parts.push(`Stack:\n${err.stack}`);
  }

  return parts.join('\n');
}

/**
 * Transport options interface
 */
interface TransportOptions {
  connectionString?: string;
}

/**
 * Creates a TelemetryClient for this worker thread.
 *
 * IMPORTANT: We cannot use the main thread's Application Insights client
 * because Pino transports run in isolated worker threads.
 * This function creates a dedicated client for the transport worker.
 *
 * @param connectionString - Application Insights connection string
 * @returns TelemetryClient or undefined if not configured
 */
function createWorkerClient(connectionString?: string): TelemetryClient | undefined {
  if (!connectionString) {
    console.warn('[PinoApplicationInsightsTransport] No connection string provided, traces will not be sent');
    return undefined;
  }

  try {
    // Create a new TelemetryClient for this worker thread
    const client = new appInsights.TelemetryClient(connectionString);

    // Configure for backend logging
    client.context.tags[client.context.keys.cloudRole] = 'bcagent-backend';
    client.context.tags[client.context.keys.cloudRoleInstance] =
      process.env.HOSTNAME || process.env.COMPUTERNAME || 'pino-worker';

    // Enable tracking
    client.config.disableAppInsights = false;

    console.log('[PinoApplicationInsightsTransport] ✅ Worker TelemetryClient initialized');
    return client;
  } catch (error) {
    console.error('[PinoApplicationInsightsTransport] Failed to create TelemetryClient:', error);
    return undefined;
  }
}

/**
 * Creates a Pino transport that sends logs to Application Insights.
 *
 * This transport runs in a worker thread (Pino's default behavior).
 * It receives log objects, transforms them, and sends to App Insights.
 *
 * IMPORTANT: This creates its own TelemetryClient because worker threads
 * cannot access the main thread's Application Insights SDK state.
 *
 * @param options - Transport options including connectionString
 * @returns Pino transport
 */
export default async function (options: TransportOptions) {
  // Initialize client for this worker thread
  const client = createWorkerClient(options.connectionString);

  return build(
    async function (source) {
      // If App Insights not initialized, just consume logs without processing
      if (!client) {
        for await (const _obj of source) {
          // Silently consume - App Insights disabled or failed to initialize
        }
        return;
      }

      // Process logs
      for await (const logObj of source) {
        try {
          // Extract log properties
          const level = logObj.level || PINO_LEVELS.info;
          const timestamp = logObj.time
            ? new Date(logObj.time)
            : new Date();
          const message = logObj.msg || logObj.message || '';

          // Map Pino level to App Insights severity
          const severity = mapPinoLevelToSeverity(level);

          // Extract custom dimensions
          const customDimensions = extractCustomDimensions(logObj);

          // Build trace message
          let traceMessage = message;

          // Append error details if present
          if (logObj.error) {
            const errorDetails = formatError(logObj.error);
            if (errorDetails) {
              traceMessage += `\n${errorDetails}`;
            }
          }

          // Send trace to Application Insights
          client.trackTrace({
            message: traceMessage,
            severity: severity as number,
            time: timestamp,
            properties: customDimensions,
          });

          // If this is an error or fatal, also track as exception
          if (level >= PINO_LEVELS.error && logObj.error) {
            const exception =
              logObj.error instanceof Error
                ? logObj.error
                : new Error(
                    logObj.error.message || JSON.stringify(logObj.error)
                  );

            client.trackException({
              exception,
              severity: severity as number,
              time: timestamp,
              properties: customDimensions,
            });
          }
        } catch (transportError) {
          // NEVER let transport errors crash the app
          // Just log to stderr and continue
          console.error(
            '[PinoApplicationInsightsTransport] Error processing log:',
            transportError
          );
        }
      }
    },
    {
      // Transport options
      parse: 'lines', // Parse newline-delimited JSON
      close: async () => {
        // Flush any pending telemetry on shutdown
        if (client) {
          try {
            await client.flush();
            console.log('[PinoApplicationInsightsTransport] Telemetry flushed on shutdown');
          } catch (flushError) {
            console.error('[PinoApplicationInsightsTransport] Error flushing telemetry:', flushError);
          }
        }
      },
    }
  );
}
