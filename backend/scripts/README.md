# Backend Scripts

This directory contains utility scripts for development, diagnostics, and maintenance.

## diagnose-claude-response.ts

A diagnostic script that captures raw Claude API events without any transformation. This is used for analyzing the exact structure of API responses and debugging streaming behavior.

### Usage

```bash
# Basic usage
npx tsx backend/scripts/diagnose-claude-response.ts

# With extended thinking
npx tsx backend/scripts/diagnose-claude-response.ts --thinking

# With tools
npx tsx backend/scripts/diagnose-claude-response.ts --tools

# Combined options
npx tsx backend/scripts/diagnose-claude-response.ts --thinking --tools --prompt "Your question here"

# With custom output directory
npx tsx backend/scripts/diagnose-claude-response.ts --output ./my-captures/

# Test vision capabilities (requires image file)
npx tsx backend/scripts/diagnose-claude-response.ts --vision ./test-image.png

# Test citations (document processing)
npx tsx backend/scripts/diagnose-claude-response.ts --citations

# Test interleaved thinking (requires beta header)
npx tsx backend/scripts/diagnose-claude-response.ts --interleaved
```

### Available Options

| Option | Description |
|--------|-------------|
| `--thinking` | Enables extended thinking mode with 10,000 token budget |
| `--tools` | Includes a simple `get_current_time` tool for testing tool_use |
| `--web-search` | Placeholder for web search tool (requires special setup) |
| `--vision <path>` | Includes an image from the specified file path |
| `--citations` | Includes a sample document with citations enabled |
| `--interleaved` | Adds the beta header for interleaved thinking |
| `--output <dir>` | Output directory (default: `../docs/plans/phase-0/captured-events/`) |
| `--prompt <text>` | Custom prompt (default: "Explain the concept of recursion...") |

### Output Format

The script generates JSON files with the following structure:

```json
{
  "startTime": 1765930125574,
  "endTime": 1765930128438,
  "model": "claude-sonnet-4-20250514",
  "options": {
    "thinking": true,
    "tools": false,
    "webSearch": false,
    "vision": false,
    "citations": false,
    "interleaved": false
  },
  "prompt": "What is 2+2?",
  "events": [
    {
      "timestamp": 1765930127585,
      "eventType": "message_start",
      "index": 0,
      "rawEvent": { /* Complete raw event from Anthropic SDK */ }
    }
  ],
  "finalMessage": { /* Final message object */ },
  "usage": {
    "input_tokens": 43,
    "output_tokens": 45
  }
}
```

### Event Types Captured

The script captures ALL event types from the Anthropic streaming API:

- `message_start` - Message begins
- `content_block_start` - New content block (text, thinking, or tool_use)
- `content_block_delta` - Incremental chunks (text_delta, thinking_delta, or input_json_delta)
- `content_block_stop` - Content block completed
- `message_delta` - Token usage and stop_reason updates
- `message_stop` - Full message completed

### Agentic Loop Support

When using `--tools`, the script implements a full agentic loop:

1. Claude responds with tool_use
2. Script executes the tool locally
3. Script sends tool_result back to Claude
4. Claude continues with a new response
5. Loop continues until Claude doesn't request tools (max 10 turns)

### Notes

- Requires `ANTHROPIC_API_KEY` in `backend/.env`
- Uses model: `claude-sonnet-4-20250514`
- Max tokens: 16,000 (must be greater than thinking budget)
- Thinking budget: 10,000 tokens (when enabled)
- Output files are named: `{timestamp}-{mode}-diagnostic.json`
- The script does NOT transform or filter data - it captures raw events only

### Use Cases

1. **Debugging thinking events**: Verify thinking blocks are emitted correctly
2. **Tool execution flow**: Analyze tool_use and tool_result sequences
3. **Stream timing**: Examine exact timing of event deltas
4. **API response structure**: Document exact structure of Anthropic responses
5. **Comparison**: Compare raw events vs transformed events in application

### Related Files

- Phase 0 README: `docs/plans/phase-0/README.md`
- Captured events: `docs/plans/phase-0/captured-events/`
- StreamAdapter (transformation layer): `backend/src/core/langchain/StreamAdapter.ts`

---

## capture-anthropic-response.ts

A capture script that records real Anthropic API responses for E2E test mock validation. This script captures streaming events, final responses, and timing data to help validate that `FakeAnthropicClient` matches real API behavior.

### Usage

```bash
# Use predefined scenario
npx tsx scripts/capture-anthropic-response.ts --scenario=thinking-tools

# Custom message with thinking
npx tsx scripts/capture-anthropic-response.ts --message="List 5 customers" --thinking

# Custom message with tools
npx tsx scripts/capture-anthropic-response.ts --message="Get customer data" --tools

# Show help
npx tsx scripts/capture-anthropic-response.ts --help

# Or use npm script
npm run capture:anthropic -- --scenario=simple
```

### Available Options

| Option | Description |
|--------|-------------|
| `--scenario=<name>` | Use predefined scenario (simple, thinking, thinking-tools, tools-only, multi-tool) |
| `--message=<text>` | Custom message to send to Claude |
| `--thinking` | Enable extended thinking mode |
| `--thinking-budget=N` | Set thinking budget in tokens (default: 5000) |
| `--tools` | Enable BC tools from MCP server (loads first 10 tools) |
| `--output=<dir>` | Output directory (default: `src/__tests__/fixtures/captured`) |
| `--help, -h` | Show help message |

### Predefined Scenarios

| Scenario | Description | Thinking | Tools |
|----------|-------------|----------|-------|
| `simple` | Basic text response | No | No |
| `thinking` | Extended thinking only | Yes (5000 tokens) | No |
| `thinking-tools` | Thinking + BC tools | Yes (5000 tokens) | Yes |
| `tools-only` | BC tools without thinking | No | Yes |
| `multi-tool` | Multiple tool calls | No | Yes |

### Output Format

Captured responses are saved as JSON files in `src/__tests__/fixtures/captured/`:

```json
{
  "metadata": {
    "capturedAt": "2025-12-18T12:30:00.000Z",
    "scenario": "thinking-tools",
    "model": "claude-sonnet-4-20250514",
    "scriptVersion": "1.0.0",
    "request": {
      "message": "List the first 3 customers",
      "thinking": true,
      "thinkingBudget": 5000,
      "toolsEnabled": true,
      "toolCount": 10
    }
  },
  "finalResponse": {
    "id": "msg_abc123",
    "content": [
      { "type": "thinking", "thinking": "..." },
      { "type": "text", "text": "..." },
      { "type": "tool_use", "id": "...", "name": "...", "input": {} }
    ],
    "stopReason": "end_turn",
    "usage": {
      "inputTokens": 1234,
      "outputTokens": 567
    }
  },
  "streamingEvents": [
    {
      "index": 0,
      "type": "raw:message_start",
      "data": { /* complete event */ },
      "timestampMs": 123
    }
  ],
  "eventTimings": [
    { "type": "message_start", "deltaMs": 0 },
    { "type": "content_block_start", "deltaMs": 50 }
  ],
  "contentSummary": {
    "thinkingBlocks": 1,
    "textBlocks": 1,
    "toolUseBlocks": 1
  }
}
```

### Events Captured

The script captures multiple event types:

**High-level events** (from SDK listeners):
- `message` - Full message object
- `text` - Text content delta
- `contentBlock` - Content block start
- `inputJson` - Tool input JSON

**Raw streaming events** (from async iterator):
- `raw:message_start` - Message begins
- `raw:content_block_start` - New content block
- `raw:content_block_delta` - Incremental content
- `raw:content_block_stop` - Content block complete
- `raw:message_delta` - Usage/stop_reason updates
- `raw:message_stop` - Message complete

### Use Cases

1. **Mock Validation**: Compare captured responses with `FakeAnthropicClient` output
2. **E2E Test Fixtures**: Create realistic test data from real API responses
3. **API Behavior Documentation**: Document exact event sequences and timing
4. **Regression Testing**: Detect API changes by comparing captured responses over time
5. **Performance Benchmarking**: Analyze response timing and token usage

### Business Central Tools

When `--tools` is enabled, the script loads BC entity tools from `mcp-server/data/v1.0/entities/`. This includes tools like:
- `customer` - List/query customers
- `item` - List/query items
- `salesOrder` - List/query sales orders
- `vendor` - List/query vendors
- And 100+ more BC entities

The script limits to the first 10 tools to keep capture manageable.

### Requirements

- `ANTHROPIC_API_KEY` must be set in `backend/.env`
- Uses model: `claude-sonnet-4-20250514`
- Max tokens: 4096
- Requires `dotenv` package for environment loading

### Example Workflow

```bash
# 1. Capture simple response
npm run capture:anthropic -- --scenario=simple

# 2. Capture thinking response
npm run capture:anthropic -- --scenario=thinking

# 3. Capture tool usage with thinking
npm run capture:anthropic -- --scenario=thinking-tools

# 4. Capture custom scenario
npm run capture:anthropic -- --message="Calculate 2+2" --thinking

# 5. Review captured files
ls src/__tests__/fixtures/captured/
```

### Output Files

Files are named with the pattern: `{scenario}-{timestamp}.json`

Example:
```
thinking-tools-2025-12-18T12-30-45.json
simple-2025-12-18T12-31-22.json
custom-2025-12-18T12-32-01.json
```

### Notes

- Script does NOT implement agentic loop - captures single turn only
- Tool execution is NOT performed - only tool_use requests are captured
- Thinking budget defaults to 5000 tokens when enabled
- All timestamps are relative to request start (in milliseconds)
- Output is formatted with 2-space indentation for readability

### Related Files

- FakeAnthropicClient: `backend/src/services/agent/FakeAnthropicClient.ts`
- AnthropicResponseFactory: `backend/src/__tests__/fixtures/AnthropicResponseFactory.ts`
- E2E Test Setup: `backend/src/__tests__/e2e/setup.e2e.ts`
- Captured Fixtures: `backend/src/__tests__/fixtures/captured/`
