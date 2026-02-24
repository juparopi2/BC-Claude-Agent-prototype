/**
 * Research & Analysis Agent Tools
 *
 * Anthropic server-side tools for web research, content fetching, and code execution.
 * These tools are executed on Anthropic's servers — no local callback needed.
 *
 * @module modules/agents/research/tools
 */

import { tools } from '@langchain/anthropic';

/**
 * Web Search tool — searches the web for real-time information.
 * Cost: $10 per 1,000 searches.
 * Limit: max 10 uses per request to control costs.
 */
export const webSearchTool = tools.webSearch_20250305({
  maxUses: 10,
});

/**
 * Web Fetch tool — fetches and parses content from a specific URL.
 * Cost: FREE.
 */
export const webFetchTool = tools.webFetch_20250910();

/**
 * Code Execution tool — executes Python code in a sandboxed environment.
 * Cost: 1,550 hours free per month.
 */
export const codeExecutionTool = tools.codeExecution_20250825();
