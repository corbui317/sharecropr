-- Deterministic test fixtures (RLS Test Plan §1.2)
-- Password for all fixture users: testpassword12

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) VALUES
  ('11111111-1111-1111-1111-111111111101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'owner@test.local', crypt('testpassword12', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Owner Gardener"}', now(), now()),
  ('11111111-1111-1111-1111-111111111102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'requester@test.local', crypt('testpassword12', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Requester"}', now(), now()),
  ('11111111-1111-1111-1111-111111111103', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'stranger@test.local', crypt('testpassword12', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Stranger"}', now(), now()),
  ('11111111-1111-1111-1111-111111111104', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'unverified@test.local', crypt('testpassword12', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Unverified"}', now(), now()),
  ('11111111-1111-1111-1111-111111111105', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'nogarden@test.local', crypt('testpassword12', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"No Garden"}', now(), now()),
  ('11111111-1111-1111-1111-111111111106', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'suspended@test.local', crypt('testpassword12', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Suspended"}', now(), now()),
  ('11111111-1111-1111-1111-111111111107', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'blocker@test.local', crypt('testpassword12', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Blocker"}', now(), now()),
  ('11111111-1111-1111-1111-111111111108', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'blocked@test.local', crypt('testpassword12', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Blocked"}', now(), now()),
  ('11111111-1111-1111-1111-111111111109', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'moderator@test.local', crypt('testpassword12', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"],"role":"moderator"}', '{"display_name":"Mod"}', now(), now()),
  ('11111111-1111-1111-1111-11111111110a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'admin@test.local', crypt('testpassword12', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"],"role":"admin"}', '{"display_name":"Admin"}', now(), now()),
  ('11111111-1111-1111-1111-11111111110b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'deleted@test.local', crypt('testpassword12', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Deleted"}', now(), now()),
  ('22222222-2222-2222-2222-222222222201', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'canary_a@test.local', crypt('testpassword12', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Canary A"}', now(), now()),
  ('22222222-2222-2222-2222-222222222202', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'canary_b@test.local', crypt('testpassword12', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Canary B"}', now(), now()),
  ('33333333-3333-3333-3333-333333333301', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'reviewer@sharecropr.app', crypt('testpassword12', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"App Reviewer"}', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Profiles created by handle_new_user trigger; patch verification/garden states
UPDATE public.verifications SET status = 'passed', is_over_18 = true, verified_at = now()
 WHERE user_id IN (
   '11111111-1111-1111-1111-111111111101',
   '11111111-1111-1111-1111-111111111102',
   '11111111-1111-1111-1111-111111111103',
   '11111111-1111-1111-1111-111111111105',
   '11111111-1111-1111-1111-111111111106',
   '11111111-1111-1111-1111-111111111107',
   '11111111-1111-1111-1111-111111111108',
   '11111111-1111-1111-1111-111111111109',
   '11111111-1111-1111-1111-11111111110a',
   '22222222-2222-2222-2222-222222222201',
   '22222222-2222-2222-2222-222222222202',
   '33333333-3333-3333-3333-333333333301'
 );

UPDATE public.profiles SET is_suspended = true
 WHERE id = '11111111-1111-1111-1111-111111111106';

UPDATE public.profiles SET deleted_at = now()
 WHERE id = '11111111-1111-1111-1111-11111111110b';

-- Owner garden (verified)
INSERT INTO public.gardens (id, owner_id, name, status)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '11111111-1111-1111-1111-111111111101', 'Owner Garden', 'verified')
ON CONFLICT DO NOTHING;

INSERT INTO private.garden_locations (garden_id, exact_point, capture_source)
VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  ST_SetSRID(ST_MakePoint(-83.7430, 42.2808), 4326)::geography,
  'device_gps'
) ON CONFLICT DO NOTHING;

-- Requester garden
INSERT INTO public.gardens (id, owner_id, name, status)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', '11111111-1111-1111-1111-111111111102', 'Requester Garden', 'verified')
ON CONFLICT DO NOTHING;

INSERT INTO private.garden_locations (garden_id, exact_point, capture_source)
VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
  ST_SetSRID(ST_MakePoint(-83.7500, 42.2750), 4326)::geography,
  'device_gps'
) ON CONFLICT DO NOTHING;

-- Canary gardens
INSERT INTO public.gardens (id, owner_id, name, status)
VALUES
  ('cccccccc-cccc-cccc-cccc-ccccccccccc1', '22222222-2222-2222-2222-222222222201', 'Canary A Garden', 'verified'),
  ('cccccccc-cccc-cccc-cccc-ccccccccccc2', '22222222-2222-2222-2222-222222222202', 'Canary B Garden', 'verified')
ON CONFLICT DO NOTHING;

INSERT INTO private.garden_locations (garden_id, exact_point, capture_source)
VALUES
  ('cccccccc-cccc-cccc-cccc-ccccccccccc1', ST_SetSRID(ST_MakePoint(-83.7400, 42.2780), 4326)::geography, 'device_gps'),
  ('cccccccc-cccc-cccc-cccc-ccccccccccc2', ST_SetSRID(ST_MakePoint(-83.7600, 42.2700), 4326)::geography, 'device_gps')
ON CONFLICT DO NOTHING;

-- Block relationship
INSERT INTO public.blocks (blocker_id, blocked_id, reason)
VALUES ('11111111-1111-1111-1111-111111111107', '11111111-1111-1111-1111-111111111108', 'test fixture')
ON CONFLICT DO NOTHING;

-- Test harness registry
INSERT INTO tests.fixtures_users (handle, id, staff_role) VALUES
  ('owner', '11111111-1111-1111-1111-111111111101', 'authenticated'),
  ('requester', '11111111-1111-1111-1111-111111111102', 'authenticated'),
  ('stranger', '11111111-1111-1111-1111-111111111103', 'authenticated'),
  ('unverified', '11111111-1111-1111-1111-111111111104', 'authenticated'),
  ('no_garden', '11111111-1111-1111-1111-111111111105', 'authenticated'),
  ('suspended', '11111111-1111-1111-1111-111111111106', 'authenticated'),
  ('blocker', '11111111-1111-1111-1111-111111111107', 'authenticated'),
  ('blocked', '11111111-1111-1111-1111-111111111108', 'authenticated'),
  ('moderator', '11111111-1111-1111-1111-111111111109', 'moderator'),
  ('admin', '11111111-1111-1111-1111-11111111110a', 'admin'),
  ('deleted', '11111111-1111-1111-1111-11111111110b', 'authenticated'),
  ('canary_a', '22222222-2222-2222-2222-222222222201', 'authenticated'),
  ('canary_b', '22222222-2222-2222-2222-222222222202', 'authenticated'),
  ('reviewer', '33333333-3333-3333-3333-333333333301', 'authenticated')
ON CONFLICT DO NOTHING;

INSERT INTO private.review_bypass_accounts (user_id, reason, expires_at)
VALUES (
  '33333333-3333-3333-3333-333333333301',
  'App Store reviewer account (SCR-0312)',
  now() + interval '45 days'
) ON CONFLICT DO NOTHING;

INSERT INTO tests.fixtures_named (name, id) VALUES
  ('owner', '11111111-1111-1111-1111-111111111101'),
  ('requester', '11111111-1111-1111-1111-111111111102'),
  ('stranger', '11111111-1111-1111-1111-111111111103'),
  ('owner_garden', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  ('requester_garden', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'),
  ('canary_a_garden', 'cccccccc-cccc-cccc-cccc-ccccccccccc1'),
  ('canary_b_garden', 'cccccccc-cccc-cccc-cccc-ccccccccccc2'),
  ('blocker', '11111111-1111-1111-1111-111111111107'),
  ('blocked', '11111111-1111-1111-1111-111111111108')
ON CONFLICT DO NOTHING;
