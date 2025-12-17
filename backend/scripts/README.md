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
