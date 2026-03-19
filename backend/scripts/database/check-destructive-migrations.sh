#!/usr/bin/env bash
# ============================================================
# Destructive Migration Scanner
# ============================================================
# Scans new/modified Prisma migration SQL files for destructive
# patterns. Blocks PRs unless explicitly approved.
#
# Usage:
#   bash backend/scripts/database/check-destructive-migrations.sh
#
# Bypass:
#   - PR label: migration:destructive-approved
#   - Commit message: [destructive-migration]
#
# Exit codes:
#   0 = clean (no destructive SQL found, or bypass active)
#   1 = destructive SQL detected without approval
# ============================================================

set -euo pipefail

# ── Configuration ────────────────────────────────────────────

MIGRATION_PATH="backend/prisma/migrations"

# Patterns to detect (case-insensitive, one per line)
# Only match actual DDL, not comments or rollback files
DESTRUCTIVE_PATTERNS=(
  'DROP[[:space:]]+TABLE'
  'DROP[[:space:]]+COLUMN'
  'ALTER[[:space:]]+TABLE[[:space:]]+.*DROP'
  'TRUNCATE[[:space:]]+TABLE'
  'DELETE[[:space:]]+FROM[[:space:]]+[^;]*;'
  'ALTER[[:space:]]+TABLE[[:space:]]+.*ALTER[[:space:]]+COLUMN'
)

# ── Find changed migration files ────────────────────────────

# Determine base ref for diff
if [ -n "${GITHUB_BASE_REF:-}" ]; then
  # PR context
  BASE="origin/${GITHUB_BASE_REF}"
elif [ -n "${GITHUB_EVENT_NAME:-}" ] && [ "${GITHUB_EVENT_NAME}" = "push" ]; then
  # Push context — compare with parent
  BASE="HEAD~1"
else
  # Local testing — compare with main
  BASE="origin/main"
fi

echo "Scanning for destructive migration SQL..."
echo "Base ref: ${BASE}"
echo ""

# Find new or modified migration.sql files (exclude rollback.sql and ROLLBACK_TEMPLATE.sql)
CHANGED_FILES=$(git diff --name-only --diff-filter=AM "${BASE}...HEAD" -- "${MIGRATION_PATH}" 2>/dev/null || \
                git diff --name-only --diff-filter=AM "${BASE}" -- "${MIGRATION_PATH}" 2>/dev/null || \
                echo "")

# Filter to only migration.sql files (not rollback.sql)
MIGRATION_FILES=""
for f in $CHANGED_FILES; do
  basename=$(basename "$f")
  if [ "$basename" = "migration.sql" ]; then
    MIGRATION_FILES="${MIGRATION_FILES} ${f}"
  fi
done

MIGRATION_FILES=$(echo "$MIGRATION_FILES" | xargs)

if [ -z "$MIGRATION_FILES" ]; then
  echo "No new or modified migration files found."
  exit 0
fi

echo "Changed migration files:"
for f in $MIGRATION_FILES; do
  echo "  - $f"
done
echo ""

# ── Scan for destructive patterns ────────────────────────────

FOUND_ISSUES=0
ISSUES=""

for file in $MIGRATION_FILES; do
  if [ ! -f "$file" ]; then
    continue
  fi

  line_num=0
  while IFS= read -r line || [ -n "$line" ]; do
    line_num=$((line_num + 1))

    # Skip SQL comments
    trimmed=$(echo "$line" | sed 's/^[[:space:]]*//')
    if [[ "$trimmed" == --* ]]; then
      continue
    fi

    for pattern in "${DESTRUCTIVE_PATTERNS[@]}"; do
      if echo "$line" | grep -iEq "$pattern"; then
        FOUND_ISSUES=$((FOUND_ISSUES + 1))
        ISSUES="${ISSUES}  ${file}:${line_num}: ${trimmed}\n    Pattern: ${pattern}\n\n"
        break  # One match per line is enough
      fi
    done
  done < "$file"
done

if [ "$FOUND_ISSUES" -eq 0 ]; then
  echo "No destructive SQL patterns detected."
  exit 0
fi

# ── Check for bypass ─────────────────────────────────────────

echo "Found ${FOUND_ISSUES} destructive SQL pattern(s)."
echo ""

# Check commit message bypass
COMMIT_MSG=$(git log -1 --format="%s %b" 2>/dev/null || echo "")
if echo "$COMMIT_MSG" | grep -q '\[destructive-migration\]'; then
  echo "Bypass: [destructive-migration] found in commit message."
  echo "Proceeding with approval."
  exit 0
fi

# Check PR label bypass (requires gh CLI and GH_TOKEN)
if [ -n "${GH_TOKEN:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ] && command -v gh &>/dev/null; then
  PR_NUMBER=$(gh pr view --json number --jq '.number' 2>/dev/null || echo "")
  if [ -n "$PR_NUMBER" ]; then
    LABELS=$(gh pr view "$PR_NUMBER" --json labels --jq '.labels[].name' 2>/dev/null || echo "")
    if echo "$LABELS" | grep -q 'migration:destructive-approved'; then
      echo "Bypass: migration:destructive-approved label found on PR #${PR_NUMBER}."
      echo "Proceeding with approval."
      exit 0
    fi
  fi
fi

# ── Report and fail ──────────────────────────────────────────

echo "============================================================"
echo "DESTRUCTIVE MIGRATION SQL DETECTED"
echo "============================================================"
echo ""
echo -e "$ISSUES"
echo "This PR modifies migration files with destructive SQL patterns."
echo "Destructive changes require two-phase migrations."
echo ""
echo "Documentation: backend/prisma/CLAUDE.md (Two-Phase Destructive Migrations)"
echo ""
echo "To approve this change, use ONE of:"
echo "  1. Add PR label: migration:destructive-approved"
echo "  2. Include [destructive-migration] in the commit message"
echo ""
echo "============================================================"
exit 1
