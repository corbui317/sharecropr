// Import-seam fixtures for eslint.config.js — run by `npm run lint:fixtures` (scripts/lint-fixtures.mjs).
//
// Each case is linted AS IF it lived at `path` (the file need not exist), against the real
// eslint.config.js. `expect: 'fail'` cases MUST produce a no-restricted-imports error whose
// message contains `match`; `expect: 'pass'` cases MUST produce none. Pass cases are the
// controls that prove each exemption is narrow rather than a hole.
//
// Mobile-architecture §1/§1.1/§4.1 · AGENTS.md Invariant 11 · SCRUM-15 · SCRUM-69 · SCRUM-62 (open).

const DOMAIN = 'src/domain is platform-free';
const API = 'src/api is transport only';
const SDK = 'Exactly one file may touch the SDK';
const MAP = 'The map renderer is isolated behind MapCanvas';
const SCRUM62 = 'pending SCRUM-62';

const imp = (spec, name = 'x') => `import { ${name} } from '${spec}';\nexport const _y = ${name};\n`;

export const cases = [
  // ---- src/domain: §1.1 list, .ts AND .tsx (the old block matched only *.ts and was overridden) ----
  { id: 'domain-rn-ts', path: 'src/domain/__fixture__/a.ts', code: imp('react-native', 'Platform'), expect: 'fail', match: DOMAIN },
  { id: 'domain-rn-tsx', path: 'src/domain/__fixture__/a.tsx', code: imp('react-native', 'Platform'), expect: 'fail', match: DOMAIN },
  { id: 'domain-rn-subpath', path: 'src/domain/__fixture__/a.ts', code: imp('react-native/Libraries/Utilities/Platform'), expect: 'fail', match: DOMAIN },
  { id: 'domain-react', path: 'src/domain/__fixture__/a.ts', code: imp('react', 'useState'), expect: 'fail', match: DOMAIN },
  { id: 'domain-rn-module', path: 'src/domain/__fixture__/a.ts', code: imp('react-native-mmkv', 'createMMKV'), expect: 'fail', match: DOMAIN },
  { id: 'domain-expo', path: 'src/domain/__fixture__/a.ts', code: imp('expo-crypto', 'getRandomBytes'), expect: 'fail', match: DOMAIN },
  { id: 'domain-expo-scoped', path: 'src/domain/__fixture__/a.ts', code: imp('@expo/vector-icons'), expect: 'fail', match: DOMAIN },
  { id: 'domain-supabase', path: 'src/domain/__fixture__/a.ts', code: imp('@supabase/supabase-js', 'createClient'), expect: 'fail', match: DOMAIN },
  { id: 'domain-tanstack', path: 'src/domain/__fixture__/a.ts', code: imp('@tanstack/react-query', 'useQuery'), expect: 'fail', match: DOMAIN },
  { id: 'domain-zustand', path: 'src/domain/__fixture__/a.ts', code: imp('zustand', 'create'), expect: 'fail', match: DOMAIN },
  { id: 'domain-rel-features', path: 'src/domain/a.ts', code: imp('../features/map/x'), expect: 'fail', match: DOMAIN },
  { id: 'domain-rel-api-deep', path: 'src/domain/geo/a.ts', code: imp('../../api/supabase', 'supabase'), expect: 'fail', match: DOMAIN },
  { id: 'domain-alias-features', path: 'src/domain/geo/a.ts', code: imp('@/features/map/x'), expect: 'fail', match: DOMAIN },
  { id: 'domain-alias-api', path: 'src/domain/geo/a.ts', code: imp('@/api/supabase', 'supabase'), expect: 'fail', match: DOMAIN },
  { id: 'domain-maplibre', path: 'src/domain/geo/a.ts', code: imp('@maplibre/maplibre-react-native', 'MapView'), expect: 'fail', match: MAP },
  { id: 'domain-ok-sibling', path: 'src/domain/geo/a.ts', code: imp('@/domain/geo/types', 'x'), expect: 'pass' },
  { id: 'domain-ok-relative', path: 'src/domain/geo/a.ts', code: imp('./types', 'x'), expect: 'pass' },

  // ---- src/api: no React Native, sanctioned adapters only (§1 "src/api exceptions") ----
  { id: 'api-rn', path: 'src/api/__fixture__.ts', code: imp('react-native', 'Platform'), expect: 'fail', match: API },
  { id: 'api-rn-tsx', path: 'src/api/__fixture__.tsx', code: imp('react-native', 'Platform'), expect: 'fail', match: API },
  { id: 'api-rn-appstate', path: 'src/api/__fixture__.ts', code: imp('react-native', 'AppState'), expect: 'fail', match: API },
  { id: 'api-rn-module', path: 'src/api/__fixture__.ts', code: imp('react-native-reanimated', 'useSharedValue'), expect: 'fail', match: API },
  { id: 'api-expo-unsanctioned', path: 'src/api/__fixture__.ts', code: imp('expo-network', 'getNetworkStateAsync'), expect: 'fail', match: API },
  { id: 'api-rel-features', path: 'src/api/__fixture__.ts', code: imp('../features/auth/lib/copy'), expect: 'fail', match: API },
  { id: 'api-alias-features', path: 'src/api/__fixture__.ts', code: imp('@/features/auth/lib/copy'), expect: 'fail', match: API },
  { id: 'api-supabase', path: 'src/api/__fixture__.ts', code: imp('@supabase/supabase-js', 'createClient'), expect: 'fail', match: SDK },
  { id: 'api-maplibre', path: 'src/api/__fixture__.ts', code: imp('@maplibre/maplibre-react-native', 'MapView'), expect: 'fail', match: MAP },
  { id: 'api-ok-mmkv', path: 'src/api/__fixture__.ts', code: imp('react-native-mmkv', 'createMMKV'), expect: 'pass' },
  { id: 'api-ok-secure-store', path: 'src/api/__fixture__.ts', code: imp('expo-secure-store', 'getItemAsync'), expect: 'pass' },
  { id: 'api-ok-crypto', path: 'src/api/__fixture__.ts', code: imp('expo-crypto', 'getRandomBytes'), expect: 'pass' },
  { id: 'api-ok-domain', path: 'src/api/__fixture__.ts', code: imp('@/domain/geo/types', 'x'), expect: 'pass' },

  // ---- src/api/supabase.ts: exempt from the SDK seam only; AppState-only RN exemption (SCRUM-62, open) ----
  { id: 'sb-ok-sdk', path: 'src/api/supabase.ts', code: imp('@supabase/supabase-js', 'createClient'), expect: 'pass' },
  { id: 'sb-ok-appstate', path: 'src/api/supabase.ts', code: imp('react-native', 'AppState'), expect: 'pass' },
  { id: 'sb-rn-platform', path: 'src/api/supabase.ts', code: imp('react-native', 'Platform'), expect: 'fail', match: SCRUM62 },
  { id: 'sb-rn-namespace', path: 'src/api/supabase.ts', code: `import * as RN from 'react-native';\nexport const _y = RN;\n`, expect: 'fail', match: SCRUM62 },
  { id: 'sb-rn-module', path: 'src/api/supabase.ts', code: imp('react-native-reanimated', 'useSharedValue'), expect: 'fail', match: API },
  { id: 'sb-maplibre', path: 'src/api/supabase.ts', code: imp('@maplibre/maplibre-react-native', 'MapView'), expect: 'fail', match: MAP },
  { id: 'sb-alias-features', path: 'src/api/supabase.ts', code: imp('@/features/auth/lib/copy'), expect: 'fail', match: API },

  // ---- MapCanvas.tsx: exempt from the map-renderer seam only ----
  { id: 'mc-ok-maplibre', path: 'src/features/map/components/MapCanvas.tsx', code: imp('@maplibre/maplibre-react-native', 'MapView'), expect: 'pass' },
  { id: 'mc-supabase', path: 'src/features/map/components/MapCanvas.tsx', code: imp('@supabase/supabase-js', 'createClient'), expect: 'fail', match: SDK },

  // ---- everywhere else in src/ and app/: both seams ----
  { id: 'feat-maplibre', path: 'src/features/map/components/Other.tsx', code: imp('@maplibre/maplibre-react-native', 'MapView'), expect: 'fail', match: MAP },
  { id: 'feat-rnmaps', path: 'src/features/map/components/Other.tsx', code: imp('react-native-maps', 'Marker'), expect: 'fail', match: MAP },
  { id: 'feat-supabase', path: 'src/features/auth/hooks/x.ts', code: imp('@supabase/supabase-js', 'createClient'), expect: 'fail', match: SDK },
  { id: 'feat-supabase-type', path: 'src/features/auth/hooks/x.ts', code: `import type { Session } from '@supabase/supabase-js';\nexport type S = Session;\n`, expect: 'fail', match: SDK },
  { id: 'feat-supabase-subpkg', path: 'src/features/auth/hooks/x.ts', code: imp('@supabase/auth-js', 'processLock'), expect: 'fail', match: SDK },
  { id: 'app-maplibre', path: 'app/(tabs)/map.tsx', code: imp('@maplibre/maplibre-react-native', 'MapView'), expect: 'fail', match: MAP },
  { id: 'app-supabase', path: 'app/(tabs)/map.tsx', code: imp('@supabase/supabase-js', 'createClient'), expect: 'fail', match: SDK },
  { id: 'feat-ok-rn', path: 'src/features/auth/components/X.tsx', code: imp('react-native', 'View'), expect: 'pass' },
  { id: 'feat-ok-session-type', path: 'src/features/auth/hooks/x.ts', code: `import type { Session } from '@/api/supabase';\nexport type S = Session;\n`, expect: 'pass' },
];
