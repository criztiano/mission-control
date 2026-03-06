#!/bin/bash
# Ralph Loop for Eden (Mission Control)
# Usage: ./loop.sh [plan|build] [max_iterations]

MODE="${1:-build}"
MAX_ITERATIONS="${2:-10}"
PROMPT_FILE="PROMPT_${MODE}.md"
ITERATION=0

if [ ! -f "$PROMPT_FILE" ]; then
  echo "Error: $PROMPT_FILE not found"
  exit 1
fi

echo "━━━ Ralph Loop: $MODE mode, max $MAX_ITERATIONS iterations ━━━"
echo "━━━ Project: Eden (Mission Control) ━━━"
echo ""

while [ $ITERATION -lt $MAX_ITERATIONS ]; do
  ITERATION=$((ITERATION + 1))
  echo "━━━ Iteration $ITERATION / $MAX_ITERATIONS ━━━"

  cat "$PROMPT_FILE" | claude -p \
    --dangerously-skip-permissions \
    --model sonnet \
    --verbose

  EXIT_CODE=$?

  # Check for completion/blocker signals
  if grep -q "^COMPLETE:" STATUS.md 2>/dev/null; then
    echo "✅ Ralph reports complete!"
    break
  fi
  if grep -q "CRITICAL BLOCKER:" STATUS.md 2>/dev/null; then
    echo "🛑 Ralph hit a blocker. Check STATUS.md"
    break
  fi

  # If claude exited with error, stop
  if [ $EXIT_CODE -ne 0 ]; then
    echo "⚠️  Claude exited with code $EXIT_CODE"
    break
  fi

  echo ""
done

echo "━━━ Ralph finished after $ITERATION iterations ━━━"
