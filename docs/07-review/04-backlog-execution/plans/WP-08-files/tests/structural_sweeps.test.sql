BEGIN;
SELECT plan(8);

-- Structural sweeps (RLS Test Plan §5.1)
SELECT is(
  (SELECT count(*) FROM pg_tables t
     WHERE t.schemaname = 'public' AND NOT t.rowsecurity)::int,
  0, 'SWEEP: every public table has RLS enabled');

SELECT is(
  (SELECT count(*) FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v'
      AND NOT COALESCE((c.reloptions::text LIKE '%security_invoker=on%'), false))::int,
  0, 'SWEEP: every public view sets security_invoker = on');

SELECT is(
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_schema = 'private' AND grantee IN ('anon','authenticated'))::int,
  0, 'SWEEP: no client grants on schema private');

SELECT is(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public','app') AND p.prosecdef
      AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig,'{}'))
                       AS cfg WHERE cfg LIKE 'search_path=%'))::int,
  0, 'SWEEP: every SECURITY DEFINER function pins search_path');

SELECT ok((SELECT relforcerowsecurity FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = 'profiles'),
          'SWEEP: profiles has FORCE RLS');

SELECT ok((SELECT relforcerowsecurity FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = 'gardens'),
          'SWEEP: gardens has FORCE RLS');

SELECT ok((SELECT relforcerowsecurity FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = 'blocks'),
          'SWEEP: blocks has FORCE RLS');

SELECT ok(EXISTS (
  SELECT 1 FROM pg_indexes WHERE tablename = 'profiles' AND indexname = 'profiles_active_idx'
), 'SWEEP: profiles policy predicate columns indexed');

SELECT * FROM finish();
ROLLBACK;
