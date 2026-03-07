#!/bin/bash
# Ralph Loop — plan then build autonomously
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"
MAX_BUILD=${1:-12}

# Phase 1: Planning (1 iteration)
echo "=== PLANNING PHASE ==="
if ! grep -q "STATUS: COMPLETE" IMPLEMENTATION_PLAN.md 2>/dev/null; then
  cat PROMPT_plan.md | claude -p --dangerously-skip-permissions --model sonnet
  echo "--- Planning complete ---"
fi

# Phase 2: Build loop
echo "=== BUILD PHASE ==="
for i in $(seq 1 $MAX_BUILD); do
  echo "=== Build Iteration $i / $MAX_BUILD ==="
  
  if grep -q "STATUS: COMPLETE" IMPLEMENTATION_PLAN.md 2>/dev/null; then
    echo "✅ All tasks complete! Exiting loop."
    exit 0
  fi
  
  if grep -q "CRITICAL BLOCKER" STATUS.md 2>/dev/null; then
    echo "🛑 Critical blocker detected. Exiting loop."
    exit 1
  fi
  
  cat PROMPT_build.md | claude -p --dangerously-skip-permissions --model sonnet
  
  echo "--- Iteration $i complete ---"
  sleep 2
done

echo "❌ Max iterations reached. Check IMPLEMENTATION_PLAN.md and STATUS.md."
exit 1
