#!/usr/bin/env bash
# Run pgTAP tests against local Supabase Postgres (SCR-0205)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v supabase >/dev/null 2>&1; then
  echo "supabase CLI not found — skipping db:test (SQL migrations committed for CI)" >&2
  exit 0
fi

if ! supabase status >/dev/null 2>&1; then
  echo "Starting Supabase..."
  supabase start
fi

supabase db test
