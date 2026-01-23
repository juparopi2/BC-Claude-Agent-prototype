/**
 * Application Insights Setup
 *
 * Initializes Azure Application Insights for centralized logging and telemetry.
 * Must be called BEFORE any other imports in server.ts to ensure proper instrumentation.
 *
 * Features:
 * - Auto-collection of HTTP requests, dependencies, exceptions, and performance metrics
 * - Distributed tracing with W3C correlation
 * - Custom properties for environment and version tagging
 * - Graceful degradation if not configured
 *
 * @module infrastructure/telemetry
 */

import * as appInsights from 'applicationinsights';
import { env } from '@/infrastructure/config/environment';

let initialized = false;

/**
 * Initializes Application Insights with production-ready configuration.
 *
 * This function is idempotent - calling it multiple times is safe.
 * It will only initialize once and skip subsequent calls.
 *
 * Configuration is controlled via environment variables:
 * - APPLICATIONINSIGHTS_ENABLED: Enable/disable App Insights (default: false)
 * - APPLICATIONINSIGHTS_CONNECTION_STRING: Connection string from Azure Portal
 * - APPLICATIONINSIGHTS_SAMPLING_PERCENTAGE: Sampling rate 0-100 (default: 100)
 *
 * @returns void
 */
export function initializeApplicationInsights(): void {
  // Skip if already initialized
  if (initialized) {
    return;
  }

  // Skip if explicitly disabled
  if (!env.APPLICATIONINSIGHTS_ENABLED) {
    console.log('[ApplicationInsights] Disabled via APPLICATIONINSIGHTS_ENABLED=false');
    return;
  }

  // Require connection string
  const connectionString = env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!connectionString) {
    console.warn(
      '[ApplicationInsights] APPLICATIONINSIGHTS_CONNECTION_STRING not set. Skipping initialization.'
    );
    return;
  }

  try {
    // Setup Application Insights SDK
    appInsights
      .setup(connectionString)
      // Correlation
      .setAutoDependencyCorrelation(true) // Correlate requests with dependencies
      .setAutoCollectRequests(true) // HTTP requests
      .setAutoCollectPerformance(true, true) // Performance counters + extended metrics
      .setAutoCollectExceptions(true) // Unhandled exceptions
      .setAutoCollectDependencies(true) // External calls (SQL, Redis, HTTP)
      .setAutoCollectConsole(false) // Disable console collection (we use Pino transport instead)
      .setUseDiskRetryCaching(true) // Retry failed telemetry uploads
      .setSendLiveMetrics(false) // Disable live metrics (resource intensive)
      .setDistributedTracingMode(
        appInsights.DistributedTracingModes.AI_AND_W3C
      ) // W3C trace context
      .start();

    const client = appInsights.defaultClient;

    // Set cloud role for distributed tracing
    client.context.tags[client.context.keys.cloudRole] = 'bcagent-backend';
    client.context.tags[client.context.keys.cloudRoleInstance] =
      process.env.HOSTNAME || process.env.COMPUTERNAME || 'unknown';

    // Add common properties to all telemetry
    client.commonProperties = {
      environment: env.NODE_ENV,
      version: process.env.npm_package_version || 'unknown',
      nodeVersion: process.version,
    };

    // Configure sampling if specified
    const samplingPercentage = env.APPLICATIONINSIGHTS_SAMPLING_PERCENTAGE;
    if (samplingPercentage !== undefined && samplingPercentage < 100) {
      client.config.samplingPercentage = samplingPercentage;
      console.log(
        `[ApplicationInsights] Sampling enabled at ${samplingPercentage}%`
      );
    }

    // Mark as initialized
    initialized = true;

    console.log('[ApplicationInsights] ✅ Initialized successfully');
    console.log(
      `[ApplicationInsights]    Cloud Role: ${client.context.tags[client.context.keys.cloudRole]}`
    );
    console.log(
      `[ApplicationInsights]    Environment: ${env.NODE_ENV}`
    );
  } catch (error) {
    console.error('[ApplicationInsights] ❌ Initialization failed:', error);
    // Don't throw - graceful degradation
  }
}

/**
 * Gets the Application Insights client instance.
 * Returns undefined if not initialized.
 *
 * Use this to manually track custom events, metrics, or traces.
 *
 * @example
 * const client = getApplicationInsightsClient();
 * if (client) {
 *   client.trackEvent({ name: 'UserAction', properties: { action: 'upload' } });
 * }
 *
 * @returns TelemetryClient instance or undefined
 */
export function getApplicationInsightsClient():
  | appInsights.TelemetryClient
  | undefined {
  if (!initialized || !appInsights.defaultClient) {
    return undefined;
  }
  return appInsights.defaultClient;
}

/**
 * Checks if Application Insights is initialized and active.
 *
 * @returns true if initialized, false otherwise
 */
export function isApplicationInsightsEnabled(): boolean {
  return initialized && appInsights.defaultClient !== undefined;
}

/**
 * Flushes any pending telemetry to Application Insights.
 * Useful before process shutdown.
 *
 * @param callback Optional callback invoked after flush completes
 */
export function flushApplicationInsights(callback?: (v: string) => void): void {
  if (!initialized || !appInsights.defaultClient) {
    callback?.('Not initialized');
    return;
  }

  appInsights.defaultClient.flush({
    callback: (response) => {
      console.log('[ApplicationInsights] Telemetry flushed:', response);
      callback?.(response);
    },
  });
}
