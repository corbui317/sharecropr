#!/usr/bin/env bash
# SCR-0206: Fail if any pgTAP test file has positives >= negatives
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TESTS_DIR="$ROOT/supabase/tests"
FAILED=0

for file in "$TESTS_DIR"/*.test.sql; do
  [[ -f "$file" ]] || continue
  positives=$(grep -cE "'P[0-9]+:" "$file" 2>/dev/null || true)
  negatives=$(grep -cE "'N[0-9]+:|'LP-[0-9]+:|'LP:" "$file" 2>/dev/null || true)

  if [[ "$positives" -eq 0 && "$negatives" -eq 0 ]]; then
    echo "SKIP: $(basename "$file") (structural only)"
    continue
  fi

  if [[ "$negatives" -eq 0 ]]; then
    echo "FAIL: $file has no negative assertions (P=$positives)" >&2
    FAILED=1
  elif [[ "$positives" -ge "$negatives" ]]; then
    echo "FAIL: $file positives ($positives) >= negatives ($negatives)" >&2
    FAILED=1
  else
    echo "OK: $(basename "$file") P=$positives N=$negatives"
  fi
done

exit "$FAILED"
