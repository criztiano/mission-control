#!/bin/bash
set -euo pipefail

# Run 3 measurements, take median
export DATABASE_URL="postgresql://neondb_owner:npg_ydIfPt9ub3lY@ep-morning-art-al8wtphu-pooler.c-3.eu-central-1.aws.neon.tech/neondb?sslmode=require"

VERIFY_CMD='node --require tsx/cjs -e "async function main() { const { getIssues } = require(\"./src/lib/cc-db\"); const start = Date.now(); const r = await getIssues({ limit: 50 }); console.log(Date.now()-start); process.exit(0); } main();" 2>/dev/null'

r1=$(eval $VERIFY_CMD)
r2=$(eval $VERIFY_CMD)
r3=$(eval $VERIFY_CMD)

# Median of 3
median=$(echo -e "$r1\n$r2\n$r3" | sort -n | sed -n '2p')
echo "METRIC time_ms=$median"
echo "(samples: $r1, $r2, $r3)" >&2
