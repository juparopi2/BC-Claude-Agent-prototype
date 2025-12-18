#!/usr/bin/env tsx
/**
 * Mock Validation Script
 *
 * Validates FakeAnthropicClient against captured real Anthropic API responses.
 * Detects discrepancies and suggests fixes.
 *
 * Usage:
 *   npx tsx scripts/validate-mocks.ts
 *   npx tsx scripts/validate-mocks.ts --scenario=thinking
 *   npx tsx scripts/validate-mocks.ts --verbose
 *   npx tsx scripts/validate-mocks.ts --json
 *
 * Output:
 *   ✓ simple: 100% match (23 events)
 *   ✓ thinking: 98% match (45 events, 1 warning)
 *   ⚠ thinking-tools: 85% match - NEEDS ATTENTION
 *     - Missing: signature field in thinking_delta
 *
 * @module scripts/validate-mocks
 */

import {
  listCapturedResponses,
  loadCapturedResponse,
  validateScenario,
  detectSDKChanges,
  type CapturedResponse,
  type ValidationResult,
  type DiscrepancyFix,
  type SDKChangeReport,
} from '../src/__tests__/e2e/helpers/CapturedResponseValidator';
import { ANTHROPIC_SDK_VERSION } from '../src/types/sdk';

// ============================================================================
// CLI Colors
// ============================================================================

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

function colorize(color: keyof typeof colors, text: string): string {
  return `${colors[color]}${text}${colors.reset}`;
}

// ============================================================================
// CLI Arguments
// ============================================================================

interface CLIArgs {
  scenario?: string;
  verbose: boolean;
  json: boolean;
  help: boolean;
}

function parseArgs(): CLIArgs {
  const args: CLIArgs = {
    verbose: false,
    json: false,
    help: false,
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--verbose' || arg === '-v') {
      args.verbose = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg.startsWith('--scenario=')) {
      args.scenario = arg.split('=')[1];
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`
${colorize('bold', 'Mock Validation Script')}

Validates FakeAnthropicClient against captured real Anthropic API responses.

${colorize('bold', 'Usage:')}
  npx tsx scripts/validate-mocks.ts [options]

${colorize('bold', 'Options:')}
  --scenario=<name>   Validate specific scenario only
  --verbose, -v       Show detailed validation information
  --json              Output results as JSON
  --help, -h          Show this help

${colorize('bold', 'Examples:')}
  npx tsx scripts/validate-mocks.ts
  npx tsx scripts/validate-mocks.ts --scenario=thinking
  npx tsx scripts/validate-mocks.ts --verbose
  npx tsx scripts/validate-mocks.ts --json > results.json

${colorize('bold', 'Scenarios:')}
  Captured scenarios are stored in:
  backend/src/__tests__/fixtures/captured/

  Run capture script first:
  npx tsx scripts/capture-anthropic-response.ts --scenario=thinking
`);
}

// ============================================================================
// Result Display
// ============================================================================

interface ScenarioResult {
  scenario: string;
  captured: CapturedResponse | null;
  validation: ValidationResult | null;
  fixes: DiscrepancyFix[];
  sdkChanges: SDKChangeReport | null;
}

function displayResults(results: ScenarioResult[], verbose: boolean): void {
  console.log('\n' + '═'.repeat(60));
  console.log(colorize('bold', '  Mock Validation Results'));
  console.log('═'.repeat(60) + '\n');

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const result of results) {
    if (!result.captured) {
      console.log(colorize('dim', `  ○ ${result.scenario}: No captured response`));
      skipped++;
      continue;
    }

    if (!result.validation) {
      console.log(colorize('dim', `  ○ ${result.scenario}: Validation failed to run`));
      skipped++;
      continue;
    }

    const { validation, fixes, sdkChanges } = result;
    const eventCount = result.captured.streamingEvents.length;

    // Status symbol and color
    let symbol: string;
    let statusColor: keyof typeof colors;

    if (validation.valid && validation.score >= 95) {
      symbol = '✓';
      statusColor = 'green';
      passed++;
    } else if (validation.score >= 70) {
      symbol = '⚠';
      statusColor = 'yellow';
      failed++;
    } else {
      symbol = '✗';
      statusColor = 'red';
      failed++;
    }

    // Main status line
    const warningCount = validation.warnings.length;
    const errorCount = validation.errors.length;
    let statusSuffix = `(${eventCount} events`;
    if (errorCount > 0) statusSuffix += `, ${errorCount} errors`;
    if (warningCount > 0) statusSuffix += `, ${warningCount} warnings`;
    statusSuffix += ')';

    console.log(
      colorize(statusColor, `  ${symbol} ${result.scenario}: ${validation.score}% match ${statusSuffix}`)
    );

    // SDK version warning
    if (sdkChanges?.versionChanged) {
      console.log(
        colorize('yellow', `    ⚠ SDK version changed: ${sdkChanges.from} → ${sdkChanges.to}`)
      );
      if (sdkChanges.recommendation) {
        console.log(colorize('dim', `      ${sdkChanges.recommendation}`));
      }
    }

    // Verbose output
    if (verbose) {
      // Show errors
      for (const error of validation.errors) {
        console.log(colorize('red', `    ✗ ${error}`));
      }

      // Show warnings
      for (const warning of validation.warnings) {
        console.log(colorize('yellow', `    ! ${warning}`));
      }

      // Show fixes
      if (fixes.length > 0) {
        console.log(colorize('cyan', `    Suggested fixes:`));
        for (const fix of fixes) {
          const severityIcon = fix.severity === 'critical' ? '!' : fix.severity === 'warning' ? '?' : '·';
          console.log(colorize('dim', `      ${severityIcon} ${fix.description}`));
          if (fix.suggestedPattern) {
            console.log(colorize('dim', `        → ${fix.suggestedPattern}`));
          }
        }
      }

      // Show validation details
      console.log(colorize('dim', `    Details:`));
      console.log(colorize('dim', `      Event sequence: ${validation.details.eventSequenceMatch ? '✓' : '✗'}`));
      console.log(colorize('dim', `      Required events: ${validation.details.requiredEventsPresent ? '✓' : '✗'}`));
      console.log(colorize('dim', `      Content structure: ${validation.details.contentStructureMatch ? '✓' : '✗'}`));
      console.log(colorize('dim', `      SDK version: ${validation.details.sdkVersionMatch ? '✓' : '✗'}`));
    } else if (!validation.valid) {
      // Show only critical errors in non-verbose mode
      for (const error of validation.errors.slice(0, 3)) {
        console.log(colorize('red', `    - ${error}`));
      }
      if (validation.errors.length > 3) {
        console.log(colorize('dim', `    ... and ${validation.errors.length - 3} more errors`));
      }
    }
  }

  // Summary
  console.log('\n' + '─'.repeat(60));
  console.log(colorize('bold', '  Summary'));
  console.log('─'.repeat(60));
  console.log(`  SDK Version: ${colorize('cyan', ANTHROPIC_SDK_VERSION)}`);
  console.log(`  Scenarios: ${colorize('green', String(passed))} passed, ${colorize('red', String(failed))} failed, ${colorize('dim', String(skipped))} skipped`);
  console.log('─'.repeat(60) + '\n');
}

function outputJSON(results: ScenarioResult[]): void {
  const output = {
    sdkVersion: ANTHROPIC_SDK_VERSION,
    timestamp: new Date().toISOString(),
    results: results.map(r => ({
      scenario: r.scenario,
      hasCaptured: !!r.captured,
      validation: r.validation,
      fixes: r.fixes,
      sdkChanges: r.sdkChanges,
    })),
    summary: {
      total: results.length,
      passed: results.filter(r => r.validation?.valid && (r.validation?.score ?? 0) >= 95).length,
      failed: results.filter(r => r.validation && (!r.validation.valid || (r.validation?.score ?? 0) < 95)).length,
      skipped: results.filter(r => !r.captured).length,
    },
  };

  console.log(JSON.stringify(output, null, 2));
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Get list of scenarios to validate
  const capturedFiles = listCapturedResponses();
  const scenarios = new Set<string>();

  for (const file of capturedFiles) {
    // Extract scenario name from filename (e.g., "thinking-2024-01-15.json" -> "thinking")
    const match = file.match(/^([a-z-]+)-\d{4}/);
    if (match && match[1]) {
      scenarios.add(match[1]);
    }
  }

  // Filter by specific scenario if provided
  let scenariosToValidate = Array.from(scenarios);
  if (args.scenario) {
    scenariosToValidate = scenariosToValidate.filter(s => s.includes(args.scenario!));
    if (scenariosToValidate.length === 0) {
      console.error(colorize('red', `No scenarios found matching: ${args.scenario}`));
      console.error(colorize('dim', `Available: ${Array.from(scenarios).join(', ') || 'none'}`));
      process.exit(1);
    }
  }

  // Check if any scenarios exist
  if (scenariosToValidate.length === 0) {
    if (!args.json) {
      console.log('\n' + '═'.repeat(60));
      console.log(colorize('yellow', '  No captured responses found'));
      console.log('═'.repeat(60));
      console.log('\n  Run the capture script first:');
      console.log(colorize('cyan', '    npx tsx scripts/capture-anthropic-response.ts --scenario=simple'));
      console.log(colorize('cyan', '    npx tsx scripts/capture-anthropic-response.ts --scenario=thinking'));
      console.log(colorize('cyan', '    npx tsx scripts/capture-anthropic-response.ts --scenario=thinking-tools'));
      console.log('');
    } else {
      outputJSON([]);
    }
    process.exit(0);
  }

  // Validate each scenario
  const results: ScenarioResult[] = [];

  if (!args.json) {
    console.log('\n' + colorize('dim', `Validating ${scenariosToValidate.length} scenario(s)...`));
  }

  for (const scenario of scenariosToValidate) {
    try {
      const result = await validateScenario(scenario);
      results.push({
        scenario,
        ...result,
      });
    } catch (error) {
      results.push({
        scenario,
        captured: null,
        validation: null,
        fixes: [],
        sdkChanges: null,
      });
      if (!args.json) {
        console.error(colorize('red', `  Error validating ${scenario}: ${error}`));
      }
    }
  }

  // Output results
  if (args.json) {
    outputJSON(results);
  } else {
    displayResults(results, args.verbose);
  }

  // Exit code based on results
  const anyFailed = results.some(r => r.validation && !r.validation.valid);
  process.exit(anyFailed ? 1 : 0);
}

main().catch((error) => {
  console.error(colorize('red', `Unexpected error: ${error}`));
  process.exit(1);
});
