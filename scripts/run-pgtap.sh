#!/usr/bin/env bash
# Run pgTAP tests against local Supabase Postgres (SCR-0205)
# Fails (non-zero) when the Supabase CLI is missing, so `npm run db:test` can never pass
# silently without running anything. Opt out explicitly with SKIP_DB_TESTS=1.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "${SKIP_DB_TESTS:-}" == "1" ]]; then
  echo "db:test SKIPPED (SKIP_DB_TESTS=1) — pgTAP did NOT run" >&2
  exit 0
fi

if ! command -v supabase >/dev/null 2>&1; then
  echo "ERROR: db:test cannot run: the Supabase CLI is not installed (or not on PATH)." >&2
  echo "       Install it (https://supabase.com/docs/guides/local-development/cli/getting-started)" >&2
  echo "       or set SKIP_DB_TESTS=1 to skip deliberately." >&2
  exit 1
fi

if ! supabase status >/dev/null 2>&1; then
  echo "Starting Supabase..."
  supabase start
fi

supabase db test
