-- Column/table privilege matrix for client roles (ADR-0022, RLS Design §4).
-- Postgres ignores a column-level REVOKE while a table-level grant exists, so these assert
-- the EFFECTIVE privilege (has_column_privilege includes table-level grants).
-- Tags: SPEC-001-N08, SPEC-004-T23, SPEC-001-T09, SPEC-001-R11.
BEGIN;
SELECT plan(22);

-- Positive: the grants clients legitimately need.
SELECT ok(has_column_privilege('authenticated', 'public.profiles', 'handle', 'SELECT'),
  'P1: authenticated can select card-safe profiles.handle');
SELECT ok(has_column_privilege('authenticated', 'public.profiles', 'bio', 'UPDATE'),
  'P2: authenticated can update profiles.bio');
SELECT ok(has_column_privilege('authenticated', 'public.gardens', 'name', 'UPDATE'),
  'P3: authenticated can update gardens.name');
SELECT ok(has_column_privilege('authenticated', 'public.gardens', 'display_point', 'SELECT'),
  'P4: authenticated can select the fuzzed display_point');

-- profiles: owner-only / server-maintained columns are not selectable (visible rows include
-- other users', so any granted column is visible to everyone who can see the row).
SELECT is((SELECT count(*) FROM unnest(ARRAY['trust_score','cancellation_count_90d','home_h3_r7',
    'is_suspended','suspended_until','deleted_at','locale','timezone','onboarding_completed_at','updated_at']) c
    WHERE has_column_privilege('authenticated', 'public.profiles', c, 'SELECT'))::int, 0,
  'N1: no owner-only profiles column is selectable by authenticated');
SELECT is((SELECT count(*) FROM unnest(ARRAY['id','handle','trust_tier','trust_score','rating_avg',
    'rating_count','completed_exchanges','cancellation_count_90d','is_suspended','suspended_until',
    'deleted_at','city_label','home_h3_r7','created_at','updated_at']) c
    WHERE has_column_privilege('authenticated', 'public.profiles', c, 'UPDATE'))::int, 0,
  'N2: no server-maintained or immutable profiles column is updatable (incl. handle, R11)');
SELECT ok(NOT has_table_privilege('authenticated', 'public.profiles', 'INSERT'),
  'N3: no INSERT on profiles (trigger only, T09)');
SELECT ok(NOT has_table_privilege('authenticated', 'public.profiles', 'DELETE'),
  'N4: no DELETE on profiles');
SELECT ok(NOT has_column_privilege('authenticated', 'public.profiles', 'trust_score', 'SELECT')
      AND NOT has_column_privilege('anon', 'public.profiles', 'id', 'SELECT'),
  'N5: trust_score hidden from authenticated; anon sees nothing');

-- gardens
SELECT ok(NOT has_column_privilege('authenticated', 'public.gardens', 'h3_r9', 'SELECT'),
  'N6: gardens.h3_r9 is not selectable (T23)');
SELECT is((SELECT count(*) FROM unnest(ARRAY['owner_id','status','display_point','h3_r7','h3_r9',
    'verified_at','rejection_reason','deleted_at','created_at','updated_at','id']) c
    WHERE has_column_privilege('authenticated', 'public.gardens', c, 'UPDATE'))::int, 0,
  'N7: garden status and derived/review columns are RPC-only (not updatable)');
SELECT is((SELECT count(*) FROM unnest(ARRAY['status','display_point','h3_r7','h3_r9','verified_at',
    'rejection_reason','deleted_at']) c
    WHERE has_column_privilege('authenticated', 'public.gardens', c, 'INSERT'))::int, 0,
  'N8: garden status and derived columns cannot be chosen at INSERT');
SELECT ok(NOT has_table_privilege('authenticated', 'public.gardens', 'DELETE'),
  'N9: no DELETE on gardens');

-- verifications / blocks / stubs
SELECT is((SELECT count(*) FROM unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']) priv
    WHERE has_table_privilege('authenticated', 'public.verifications', priv))::int, 0,
  'N10: verifications is read-only for clients');
SELECT is((SELECT count(*) FROM unnest(ARRAY['UPDATE','DELETE','TRUNCATE']) priv
    WHERE has_table_privilege('authenticated', 'public.blocks', priv))::int, 0,
  'N11: blocks has no client UPDATE/DELETE');
SELECT is((SELECT count(*) FROM unnest(ARRAY['exchange_sessions','message_threads']) t
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) priv
    WHERE has_table_privilege('authenticated', 'public.' || t, priv)
       OR has_table_privilege('anon', 'public.' || t, priv))::int, 0,
  'N12: stub exchange tables have no client grants until EPIC-12 adds policies');
SELECT is((SELECT count(*) FROM unnest(ARRAY['INSERT','UPDATE','DELETE']) priv
    WHERE has_table_privilege('authenticated', 'public.profile_cards', priv))::int, 0,
  'N13: profile_cards is SELECT-only');
SELECT is((SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','v','p')
      AND (has_table_privilege('anon', c.oid, 'SELECT')
        OR has_table_privilege('anon', c.oid, 'INSERT')
        OR has_table_privilege('anon', c.oid, 'UPDATE')
        OR has_table_privilege('anon', c.oid, 'DELETE')))::int, 0,
  'N14: anon holds no privilege on any public table or view (no anon-readable table yet)');

-- app function surface: every EXECUTE grant here is a public RPC (app is exposed by PostgREST)
SELECT is((SELECT array_agg(p.proname::text ORDER BY p.proname)
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'app' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  ARRAY['can_transact','is_blocked_with','is_moderator','require_aal2']::text[],
  'N15: authenticated can execute exactly the caller-scoped app helpers');
SELECT is((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'app' AND has_function_privilege('anon', p.oid, 'EXECUTE'))::int, 0,
  'N16: anon can execute no app function');
SELECT ok(NOT has_function_privilege('authenticated', 'app.idempotency_probe(uuid,uuid,text,jsonb)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'app.idempotency_record(uuid,uuid,text,jsonb,jsonb)', 'EXECUTE'),
  'N17: idempotency helpers are definer-internal');
SELECT ok(NOT has_function_privilege('authenticated', 'app.is_blocked_either_way(uuid,uuid)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'app.can_transact_for(uuid)', 'EXECUTE'),
  'N18: two-argument / uuid-argument helpers are not client-callable');

SELECT * FROM finish();
ROLLBACK;
