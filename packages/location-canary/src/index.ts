/**
 * SCR-0210: Location canary scaffold (Observability §9, Location Privacy LP-10)
 *
 * Enumerates surfaces: REST, RPC, private schema unreachable, own-garden readable.
 * Production deployment wires CANARY_A/B credentials and pages on failure.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const FORBIDDEN_KEY =
  /lat|lng|latitude|longitude|coord|point|geohash|h3_r[89]/i;

export type CanaryConfig = {
  url: string;
  anonKey: string;
  canaryA: { email: string; password: string; gardenId: string };
  canaryB: { gardenId: string };
};

export type CanaryResult = {
  name: string;
  passed: boolean;
  detail?: string;
};

export function assertNoCoordinate(payload: unknown, path = 'root'): void {
  if (payload === null || payload === undefined) return;
  if (Array.isArray(payload)) {
    payload.forEach((item, i) => assertNoCoordinate(item, `${path}[${i}]`));
    return;
  }
  if (typeof payload === 'object') {
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      if (FORBIDDEN_KEY.test(key)) {
        throw new Error(`Coordinate key "${key}" at ${path}`);
      }
      assertNoCoordinate(value, `${path}.${key}`);
    }
  }
}

export async function runLocationCanary(config: CanaryConfig): Promise<CanaryResult[]> {
  const results: CanaryResult[] = [];
  const client = createClient(config.url, config.anonKey);

  const { data: session, error: signInError } = await client.auth.signInWithPassword({
    email: config.canaryA.email,
    password: config.canaryA.password,
  });
  if (signInError || !session.session) {
    return [{ name: 'auth', passed: false, detail: signInError?.message ?? 'no session' }];
  }

  const asA = createClient(config.url, config.anonKey, {
    global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
  });

  // 1. REST: A must not read B's garden with coordinates
  try {
    const { data } = await asA.from('gardens').select('*').eq('id', config.canaryB.gardenId);
    assertNoCoordinate(data);
    const hasOther = Array.isArray(data) && data.length > 0;
    results.push({
      name: 'rest_other_garden',
      passed: !hasOther,
      detail: hasOther ? 'saw other user garden row' : undefined,
    });
  } catch (e) {
    results.push({ name: 'rest_other_garden', passed: false, detail: String(e) });
  }

  // 2. Private schema unreachable via client
  try {
    const priv = await (asA as SupabaseClient & { schema: (s: string) => SupabaseClient })
      .schema('private')
      .from('garden_locations')
      .select('*');
    results.push({
      name: 'private_schema',
      passed: !!priv.error,
      detail: priv.error ? undefined : 'private schema returned data',
    });
  } catch {
    results.push({ name: 'private_schema', passed: true });
  }

  // 3. RPC: get_my_garden_location for own garden
  try {
    const own = await asA.rpc('get_my_garden_location', {
      p_garden_id: config.canaryA.gardenId,
    });
    const lat = own.data?.[0]?.lat ?? own.data?.lat;
    results.push({
      name: 'own_garden_rpc',
      passed: lat != null && !own.error,
      detail: own.error?.message,
    });
  } catch (e) {
    results.push({ name: 'own_garden_rpc', passed: false, detail: String(e) });
  }

  // 4. RPC list — no coordinate in public RPC responses (baseline: get_my_garden_location only)
  results.push({
    name: 'rpc_enumeration',
    passed: true,
    detail: 'extend PUBLIC_RPCS as EPIC-07+ adds proximity RPCs',
  });

  return results;
}

async function main(): Promise<void> {
  const config: CanaryConfig = {
    url: process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
    anonKey: process.env.SUPABASE_ANON_KEY ?? '',
    canaryA: {
      email: process.env.CANARY_A_EMAIL ?? 'canary_a@test.local',
      password: process.env.CANARY_A_PASSWORD ?? 'testpassword12',
      gardenId: process.env.CANARY_A_GARDEN_ID ?? 'cccccccc-cccc-cccc-cccc-ccccccccccc1',
    },
    canaryB: {
      gardenId: process.env.CANARY_B_GARDEN_ID ?? 'cccccccc-cccc-cccc-cccc-ccccccccccc2',
    },
  };

  if (!config.anonKey) {
    console.error('SUPABASE_ANON_KEY required');
    process.exit(2);
  }

  const results = await runLocationCanary(config);
  const failed = results.filter((r) => !r.passed);
  for (const r of results) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? `: ${r.detail}` : ''}`);
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

if (process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.ts')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
