#!/bin/bash

# fetch-container-logs.sh
# Intelligent wrapper for fetching Container App logs with filtering by user, service, and level

set -euo pipefail

# Configuration
RESOURCE_GROUP="rg-BCAgentPrototype-app-dev"
APP_NAME="app-bcagent-backend-dev"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default values
TAIL_LINES=100
SINCE=""
USER_ID=""
SERVICE_FILTER=""
LEVEL_FILTER=""
OUTPUT_FORMAT="colored" # colored, json, raw

# Help message
show_help() {
  cat << EOF
Usage: $(basename "$0") [OPTIONS]

Fetch and filter Azure Container App logs for MyWorkMate backend.

OPTIONS:
  -h, --help                Show this help message
  -t, --tail NUMBER         Number of log lines to fetch (default: 100)
  -s, --since DURATION      Time range (e.g., "2h", "30m", "1d")
  -u, --user-id UUID        Filter by userId (case-insensitive)
  --service NAME            Filter by service name (e.g., FileUploadService)
  --level LEVEL             Filter by log level (debug, info, warn, error, fatal)
  -f, --format FORMAT       Output format: colored, json, raw (default: colored)
  -e, --errors-only         Show only errors and warnings (shortcut for --level error)

EXAMPLES:
  # Get last 100 logs
  $(basename "$0")

  # Get logs from last 2 hours
  $(basename "$0") --since 2h

  # Filter by user ID
  $(basename "$0") --user-id BCD5A31B-C560-40D5-972F-50E134A8389D --tail 500

  # Filter by service
  $(basename "$0") --service FileProcessingWorker --since 1h

  # Show only errors
  $(basename "$0") --errors-only --since 6h

  # Combine filters
  $(basename "$0") --user-id ABC-123 --service FileUploadService --level error

  # JSON output for further processing
  $(basename "$0") --since 1h --format json | jq '.level >= 50'

EOF
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -h|--help)
      show_help
      exit 0
      ;;
    -t|--tail)
      TAIL_LINES="$2"
      shift 2
      ;;
    -s|--since)
      SINCE="$2"
      shift 2
      ;;
    -u|--user-id)
      USER_ID="$2"
      shift 2
      ;;
    --service)
      SERVICE_FILTER="$2"
      shift 2
      ;;
    --level)
      LEVEL_FILTER="$2"
      shift 2
      ;;
    -f|--format)
      OUTPUT_FORMAT="$2"
      shift 2
      ;;
    -e|--errors-only)
      LEVEL_FILTER="error"
      shift
      ;;
    *)
      echo "Unknown option: $1"
      show_help
      exit 1
      ;;
  esac
done

# Check Azure CLI authentication
if ! az account show &>/dev/null; then
  echo -e "${RED}Error: Not authenticated to Azure. Run 'az login' first.${NC}"
  exit 1
fi

# Build az containerapp logs command
CMD="az containerapp logs show --name $APP_NAME --resource-group $RESOURCE_GROUP --tail $TAIL_LINES --format json"

if [ -n "$SINCE" ]; then
  CMD="$CMD --since $SINCE"
fi

echo -e "${CYAN}Fetching logs from Container App: $APP_NAME${NC}"
echo -e "${CYAN}Filters: tail=$TAIL_LINES${NC}"
[ -n "$SINCE" ] && echo -e "${CYAN}  since=$SINCE${NC}"
[ -n "$USER_ID" ] && echo -e "${CYAN}  userId=$USER_ID${NC}"
[ -n "$SERVICE_FILTER" ] && echo -e "${CYAN}  service=$SERVICE_FILTER${NC}"
[ -n "$LEVEL_FILTER" ] && echo -e "${CYAN}  level=$LEVEL_FILTER${NC}"
echo ""

# Fetch logs
RAW_LOGS=$(eval "$CMD" 2>&1)

# Check if logs were fetched successfully
if [ $? -ne 0 ]; then
  echo -e "${RED}Error fetching logs:${NC}"
  echo "$RAW_LOGS"
  exit 1
fi

# Parse and filter logs
FILTERED_LOGS=$(echo "$RAW_LOGS" | jq -c '
  select(
    (if $userId != "" then (.userId // "" | ascii_downcase) == ($userId | ascii_downcase) else true end) and
    (if $service != "" then (.service // "" | ascii_downcase) | contains($service | ascii_downcase) else true end) and
    (if $level != "" then
      if $level == "error" then (.level // 30) >= 50
      elif $level == "warn" then (.level // 30) >= 40
      elif $level == "info" then (.level // 30) >= 30
      elif $level == "debug" then (.level // 30) >= 20
      else true end
    else true end)
  )' \
  --arg userId "$USER_ID" \
  --arg service "$SERVICE_FILTER" \
  --arg level "$LEVEL_FILTER")

# Count filtered logs
LOG_COUNT=$(echo "$FILTERED_LOGS" | wc -l)

if [ "$LOG_COUNT" -eq 0 ]; then
  echo -e "${YELLOW}No logs found matching the filters.${NC}"
  exit 0
fi

echo -e "${GREEN}Found $LOG_COUNT matching log entries${NC}"
echo ""

# Output based on format
if [ "$OUTPUT_FORMAT" = "json" ]; then
  # JSON output
  echo "$FILTERED_LOGS"

elif [ "$OUTPUT_FORMAT" = "raw" ]; then
  # Raw output (no colors)
  echo "$FILTERED_LOGS" | jq -r '"\(.time) [\(.level)] [\(.service // "unknown")] \(.msg // .message // "")"'

else
  # Colored output (default)
  echo "$FILTERED_LOGS" | while IFS= read -r line; do
    # Parse JSON log entry
    TIMESTAMP=$(echo "$line" | jq -r '.time // .timestamp // "N/A"')
    LEVEL=$(echo "$line" | jq -r '.level // 30')
    LEVEL_NAME=$(echo "$line" | jq -r '.levelName // "INFO"')
    SERVICE=$(echo "$line" | jq -r '.service // "unknown"')
    MESSAGE=$(echo "$line" | jq -r '.msg // .message // ""')
    USER_ID_LOG=$(echo "$line" | jq -r '.userId // ""')
    SESSION_ID=$(echo "$line" | jq -r '.sessionId // ""')
    ERROR_MSG=$(echo "$line" | jq -r '.error.message // ""')
    ERROR_STACK=$(echo "$line" | jq -r '.error.stack // ""')

    # Color based on level
    if [ "$LEVEL" -ge 50 ]; then
      LEVEL_COLOR=$RED
      LEVEL_SYMBOL="❌"
    elif [ "$LEVEL" -ge 40 ]; then
      LEVEL_COLOR=$YELLOW
      LEVEL_SYMBOL="⚠️ "
    elif [ "$LEVEL" -ge 30 ]; then
      LEVEL_COLOR=$GREEN
      LEVEL_SYMBOL="ℹ️ "
    else
      LEVEL_COLOR=$BLUE
      LEVEL_SYMBOL="🔍"
    fi

    # Format timestamp (convert from ISO to readable)
    FORMATTED_TIME=$(date -d "$TIMESTAMP" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || echo "$TIMESTAMP")

    # Print log entry
    echo -e "${LEVEL_COLOR}${LEVEL_SYMBOL} [$FORMATTED_TIME] [$LEVEL_NAME] ${CYAN}[$SERVICE]${NC}"
    echo -e "  ${MESSAGE}"

    # Add context if available
    [ -n "$USER_ID_LOG" ] && echo -e "  ${MAGENTA}User:${NC} $USER_ID_LOG"
    [ -n "$SESSION_ID" ] && echo -e "  ${MAGENTA}Session:${NC} $SESSION_ID"

    # Print error details if present
    if [ -n "$ERROR_MSG" ]; then
      echo -e "  ${RED}Error:${NC} $ERROR_MSG"
    fi
    if [ -n "$ERROR_STACK" ] && [ "$ERROR_STACK" != "null" ]; then
      echo -e "  ${RED}Stack:${NC}"
      echo "$ERROR_STACK" | head -10 | sed 's/^/    /'
    fi

    echo "" # Blank line between entries
  done
fi

echo ""
echo -e "${CYAN}=== End of logs ===${NC}"
echo ""
echo "Tips:"
echo "  - Use --format json for programmatic processing"
echo "  - Use --errors-only to quickly find issues"
echo "  - Combine with jq for advanced filtering: $(basename "$0") --format json | jq '.level >= 50'"
