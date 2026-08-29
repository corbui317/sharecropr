#!/usr/bin/env bash
# Stub: grep migrations for forbidden GRANT on private schema
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if grep -rE "GRANT .+ ON (ALL TABLES IN SCHEMA|SCHEMA) private" "$ROOT/supabase/migrations" 2>/dev/null; then
  echo "FAIL: migration grants privileges on private schema" >&2
  exit 1
fi
echo "ci:assert-no-private-grants: OK"
