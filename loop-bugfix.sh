#!/bin/bash
# Ralph Bugfix Loop — autonomous iteration until solved
# Usage: ./loop-bugfix.sh [max_iterations]

MAX=${1:-10}
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

for i in $(seq 1 $MAX); do
  echo "=== Iteration $i / $MAX ==="
  
  # Check if already solved
  if grep -q "STATUS: COMPLETE" BUGFIX_NOTES.md 2>/dev/null; then
    echo "✅ Bug fixed! Exiting loop."
    exit 0
  fi
  
  # Run Cody with the prompt (reads BUGFIX_NOTES.md inside)
  cat PROMPT_build.md | claude -p --dangerously-skip-permissions --model sonnet
  
  echo "--- Iteration $i complete ---"
  sleep 2
done

echo "❌ Max iterations reached without fix. Check BUGFIX_NOTES.md for attempted solutions."
exit 1
